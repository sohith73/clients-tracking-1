// Notifications (admin only): every reminder delivery attempt across all
// clients, plus a coverage check ("is every active client being notified?").
//
// The log is written by the dashboard backend (reminderdeliveries) and read
// here through GET /api/notifications/deliveries and /summary. Filters live in
// the URL query string so a view can be shared or reloaded. Server side:
// utils/notificationsLog.js.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { apiFetch, isAbortError } from '../utils/apiClient';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'sent', label: 'Sent' },
  { key: 'partial', label: 'Partial' },
  { key: 'failed', label: 'Failed' },
  { key: 'skipped', label: 'Skipped' },
];

const ITEM_LABEL = { daily_summary: 'Daily summary', inactivity_alert: 'Inactivity alert' };
const TRIGGER_LABEL = { cron: 'Scheduled', 'auto-threshold': 'Auto threshold', manual: 'Send now' };

const RESULT = {
  sent: { label: 'Sent', cls: 'bg-emerald-100 text-emerald-800' },
  partial: { label: 'Partial', cls: 'bg-amber-100 text-amber-800' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
  skipped: { label: 'Skipped', cls: 'bg-slate-100 text-slate-600' },
};

const COVERAGE_REASON = {
  no_config: 'No reminder settings yet',
  switched_off: 'Daily summary switched off',
  unsubscribed: 'Client unsubscribed',
};

const FIELD = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';

function fmtDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  return {
    day: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
  };
}

/** Plain-language reason. The raw reason is kept for failures because it holds the error. */
function humanReason(row) {
  const r = String(row.reason || '');
  if (r === 'ok') return 'Delivered';
  if (r === 'nothing_added') return 'No roles added, so nothing to send';
  return r || (row.status === 'skipped' ? 'Nothing to send' : '');
}

function ChannelCell({ ch, showTo }) {
  if (!ch || !ch.attempted) {
    // "no_payment_email" / "no_webhook_url" is the answer to "why didn't they get it".
    const why = ch?.error ? String(ch.error).replace(/_/g, ' ') : '';
    return <span className="text-xs text-slate-400">{why ? `Not sent: ${why}` : 'Not sent'}</span>;
  }
  if (ch.ok) {
    return (
      <div>
        <span className="text-xs font-semibold text-emerald-700">Delivered</span>
        {showTo && ch.to ? <p className="break-all text-xs text-slate-500">{ch.to}</p> : null}
      </div>
    );
  }
  return (
    <div>
      <span className="text-xs font-semibold text-red-700">Failed</span>
      {showTo && ch.to ? <p className="break-all text-xs text-slate-500">{ch.to}</p> : null}
      {ch.error ? <p className="break-words text-xs text-red-600">{ch.error}</p> : null}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function CoverageCard({ summary, error, onRetry }) {
  const [open, setOpen] = useState(false);
  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load coverage: {error}{' '}
        <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button>
      </div>
    );
  }
  if (!summary) return <div className="h-28 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />;
  const { coverage, today } = summary;
  const missing = coverage.notCovered.length;
  const full = missing === 0;
  return (
    <section aria-labelledby="coverage-title" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 id="coverage-title" className="text-sm font-semibold text-slate-500">Coverage</h2>
          <p className={`mt-1 text-lg font-bold ${full ? 'text-emerald-700' : 'text-slate-900'}`}>
            Daily summary reaches {coverage.covered} of {coverage.activeClients} active clients
          </p>
          {full ? (
            <p className="mt-0.5 text-sm text-emerald-700">Every active client is covered.</p>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="not-covered-list"
              className="mt-1 text-sm font-semibold text-blue-700 hover:underline"
            >
              {open ? 'Hide' : 'Show'} {missing} not covered
            </button>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500">Today (IST)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Sent" value={today.sent} tone="text-emerald-700" />
            <Stat label="Partial" value={today.partial} tone="text-amber-700" />
            <Stat label="Failed" value={today.failed} tone={today.failed ? 'text-red-700' : 'text-slate-900'} />
            <Stat label="Skipped" value={today.skipped} tone="text-slate-700" />
          </div>
        </div>
      </div>
      {open && !full ? (
        <ul id="not-covered-list" className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {coverage.notCovered.map((c) => (
            <li key={c.email} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="font-medium text-slate-900">{c.name || c.email}</span>
                {c.clientNumber != null ? <span className="ml-1.5 text-xs text-slate-400">#{c.clientNumber}</span> : null}
                {c.name ? <span className="block break-all text-xs text-slate-500">{c.email}</span> : null}
              </span>
              <span className={`text-xs font-semibold ${c.reason === 'switched_off' ? 'text-amber-700' : c.reason === 'unsubscribed' ? 'text-rose-700' : 'text-slate-600'}`}>
                {COVERAGE_REASON[c.reason] || c.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SkeletonRows() {
  return Array.from({ length: 6 }).map((_, i) => (
    <tr key={i} aria-hidden="true">
      {Array.from({ length: 7 }).map((__, j) => (
        <td key={j} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-slate-100" /></td>
      ))}
    </tr>
  ));
}

function Row({ row }) {
  const when = fmtDate(row.at);
  const res = RESULT[row.status] || { label: row.status || 'Unknown', cls: 'bg-slate-100 text-slate-600' };
  const failed = row.status === 'failed';
  const stats = row.stats || {};
  return (
    <tr className={failed ? 'bg-red-50/70' : 'hover:bg-slate-50'}>
      <td className={`whitespace-nowrap px-3 py-2.5 align-top ${failed ? 'border-l-4 border-red-500' : 'border-l-4 border-transparent'}`}>
        <p className="text-sm font-medium text-slate-900">{when.day}</p>
        <p className="text-xs text-slate-500">{when.time}</p>
      </td>
      <td className="px-3 py-2.5 align-top">
        <p className="text-sm font-medium text-slate-900">{row.clientName || row.clientEmail}</p>
        {row.clientName ? <p className="break-all text-xs text-slate-500">{row.clientEmail}</p> : null}
      </td>
      <td className="px-3 py-2.5 align-top">
        <p className="text-sm text-slate-900">{ITEM_LABEL[row.itemKey] || row.itemKey}</p>
        <p className="text-xs text-slate-500">{TRIGGER_LABEL[row.trigger] || row.trigger}</p>
      </td>
      <td className="px-3 py-2.5 align-top">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${res.cls}`}>{res.label}</span>
        {/* Sent, partial and failed rows already show each channel's outcome and
            error in the Email and Mattermost columns; only a skip needs its why. */}
        {row.status === 'skipped' ? (
          <p className="mt-1 max-w-[16rem] break-words text-xs text-slate-500">{humanReason(row)}</p>
        ) : null}
      </td>
      <td className="px-3 py-2.5 align-top"><ChannelCell ch={row.email} showTo /></td>
      <td className="px-3 py-2.5 align-top"><ChannelCell ch={row.mattermost} /></td>
      <td className="whitespace-nowrap px-3 py-2.5 align-top text-sm tabular-nums text-slate-700">
        {row.itemKey === 'daily_summary' ? `${stats.added ?? 0} / ${stats.applied ?? 0}` : <span className="text-slate-400">n/a</span>}
      </td>
    </tr>
  );
}

function NotificationsView() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'all';
  const itemKey = params.get('itemKey') || '';
  const trigger = params.get('trigger') || '';
  const channel = params.get('channel') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const q = params.get('q') || '';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);

  const [searchText, setSearchText] = useState(q);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const listAbort = useRef(null);
  const sumAbort = useRef(null);

  // Any filter change goes through here so the page always resets to 1.
  const setFilter = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v); else next.delete(k);
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  // Debounce typing into the URL; keep the box in step when the URL changes elsewhere (Clear, back button).
  useEffect(() => {
    if (searchText.trim() === q) return undefined;
    const t = setTimeout(() => setFilter({ q: searchText.trim() }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchText, q, setFilter]);
  useEffect(() => { setSearchText(q); }, [q]);

  const loadList = useCallback(async () => {
    listAbort.current?.abort();
    const ctl = new AbortController();
    listAbort.current = ctl;
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (status !== 'all') qs.set('status', status);
    if (itemKey) qs.set('itemKey', itemKey);
    if (trigger) qs.set('trigger', trigger);
    if (channel) qs.set('channel', channel);
    if (q) qs.set('search', q);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    try {
      const res = await apiFetch(`/api/notifications/deliveries?${qs}`, { signal: ctl.signal });
      setData(res);
      setError('');
    } catch (e) {
      if (!isAbortError(e)) setError(e.message || 'Could not load notifications');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [page, status, itemKey, trigger, channel, q, from, to]);

  const loadSummary = useCallback(async () => {
    sumAbort.current?.abort();
    const ctl = new AbortController();
    sumAbort.current = ctl;
    setSummaryError('');
    try {
      setSummary(await apiFetch('/api/notifications/summary', { signal: ctl.signal }));
    } catch (e) {
      if (!isAbortError(e)) setSummaryError(e.message || 'Request failed');
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => () => { listAbort.current?.abort(); sumAbort.current?.abort(); }, []);

  const counts = data?.counts || { sent: 0, partial: 0, failed: 0, skipped: 0 };
  const chipCount = {
    all: counts.sent + counts.partial + counts.failed + counts.skipped,
    delivered: counts.sent + counts.partial,
    ...counts,
  };
  const filtered = status !== 'all' || itemKey || trigger || channel || q || from || to;
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const logEmpty = data && chipCount.all === 0 && !filtered;

  const clear = () => { setSearchText(''); setParams({}, { replace: true }); };
  const goPage = (p) => setFilter({ page: p > 1 ? String(p) : '' });

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every reminder email and Mattermost message sent to clients, and whether it arrived. Times are IST.
      </p>

      <div className="mt-4"><CoverageCard summary={summary} error={summaryError} onRetry={loadSummary} /></div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="n-search" className="mb-1 block text-xs font-semibold text-slate-600">Client</label>
          <input id="n-search" type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search name or email" className={`${FIELD} w-full`} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="n-item" className="mb-1 block text-xs font-semibold text-slate-600">Report</label>
          <select id="n-item" value={itemKey} onChange={(e) => setFilter({ itemKey: e.target.value })} className={FIELD}>
            <option value="">All reports</option>
            <option value="daily_summary">Daily summary</option>
            <option value="inactivity_alert">Inactivity alert</option>
          </select>
        </div>
        <div>
          <label htmlFor="n-trigger" className="mb-1 block text-xs font-semibold text-slate-600">Trigger</label>
          <select id="n-trigger" value={trigger} onChange={(e) => setFilter({ trigger: e.target.value })} className={FIELD}>
            <option value="">Any trigger</option>
            <option value="cron">Scheduled</option>
            <option value="auto-threshold">Auto threshold</option>
            <option value="manual">Send now</option>
          </select>
        </div>
        <div>
          <label htmlFor="n-channel" className="mb-1 block text-xs font-semibold text-slate-600">Channel</label>
          <select id="n-channel" value={channel} onChange={(e) => setFilter({ channel: e.target.value })} className={FIELD}>
            <option value="">Any channel</option>
            <option value="email_failed">Email failed</option>
            <option value="mattermost_failed">Mattermost failed</option>
          </select>
        </div>
        <div>
          <label htmlFor="n-from" className="mb-1 block text-xs font-semibold text-slate-600">From</label>
          <input id="n-from" type="date" value={from} max={to || undefined} onChange={(e) => setFilter({ from: e.target.value })} className={FIELD} />
        </div>
        <div>
          <label htmlFor="n-to" className="mb-1 block text-xs font-semibold text-slate-600">To</label>
          <input id="n-to" type="date" value={to} min={from || undefined} onChange={(e) => setFilter({ to: e.target.value })} className={FIELD} />
        </div>
        <button type="button" onClick={clear} disabled={!filtered && !searchText}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40">
          Clear
        </button>
      </div>

      <div role="group" aria-label="Filter by result" className="mt-3 flex flex-wrap gap-1.5">
        {STATUS_CHIPS.map((c) => (
          <button key={c.key} type="button" aria-pressed={status === c.key} onClick={() => setFilter({ status: c.key === 'all' ? '' : c.key })}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${status === c.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {c.label}{data ? <span className="ml-1.5 tabular-nums opacity-70">{chipCount[c.key]}</span> : null}
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={loadList} className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700">Retry</button>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm" aria-busy={loading}>
        <table className="w-full min-w-[960px] border-collapse text-left">
          <caption className="sr-only">Reminder delivery history</caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {['When', 'Client', 'Report', 'Result', 'Email', 'Mattermost', 'Added / applied'].map((h) => (
                <th key={h} scope="col" className="px-3 py-2.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data ? <SkeletonRows /> : rows.map((r) => <Row key={r._id} row={r} />)}
          </tbody>
        </table>
        {!loading && !error && data && rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            {logEmpty ? (
              <>
                <p className="font-semibold text-slate-700">No notifications logged yet</p>
                <p className="mt-1 text-sm text-slate-500">The log starts filling once the dashboard backend update is deployed.</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-slate-700">No notifications match these filters</p>
                <button type="button" onClick={clear} className="mt-2 text-sm font-semibold text-blue-700 hover:underline">Clear filters</button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className={`mt-3 flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between ${loading && data ? 'opacity-60' : ''}`}>
        <p aria-live="polite">{data ? (total === 0 ? "Showing 0 of 0" : `Showing ${first}-${last} of ${total}`) : ''}</p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page <= 1 || loading} onClick={() => goPage(page - 1)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40">Previous</button>
          <span className="tabular-nums">Page {page} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => goPage(page + 1)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  let role = '';
  try {
    role = JSON.parse(localStorage.getItem('user') || '{}').role;
  } catch (e) {
    console.warn('[Notifications] could not read the saved user', e);
  }
  // The API enforces admin too; this just keeps other roles off an empty page.
  if (role !== 'admin') return <Navigate to="/" replace />;
  return <NotificationsView />;
}
