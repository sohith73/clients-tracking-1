// Notifications (admin only): every email Flashfire sends a client, in one
// list: the daily activity summary, the onboarding sequence (résumé, cover
// letter, LinkedIn), plan milestones and inbox alerts (interview, assessment,
// offer), plus the team's own no-activity alert. Also what is scheduled next,
// and a coverage check ("does every active client get the daily summary?").
//
// Read through GET /api/notifications/deliveries and /summary (server side:
// applications_monitor_backend/utils/notificationsLog.js). Filters live in the
// URL so a view can be shared or reloaded. The date filter defaults to today
// in IST; "All dates" is an explicit choice (?dates=all).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { apiFetch, isAbortError } from '../utils/apiClient';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_CHIPS = [
  { key: 'all', label: 'All sent' },
  { key: 'sent', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'scheduled', label: 'Scheduled' },
];

const KIND_OPTIONS = [
  { value: 'daily_summary', label: 'Daily activity summary' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'milestone', label: 'Plan milestones' },
  { value: 'inbox_alert', label: 'Inbox alerts' },
  { value: 'inactivity_alert', label: 'No-activity alert (team)' },
];

const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((o) => [o.value, o.label]));

// The specific email inside each kind.
const ITEM_LABEL = {
  daily_summary: 'Daily activity summary',
  inactivity_alert: 'No-activity alert (to the team)',
  base_resume: 'Base résumé is ready',
  cover_letter: 'Cover letter is ready',
  linkedin: 'LinkedIn optimisation done',
  started: 'Applications have started',
  count_250: '250 applications sent',
  count_350: '350 applications sent',
  count_700: '700 applications sent',
  completed: 'Plan completed',
  interview: 'Interview invite',
  assessment: 'Assessment received',
  assignment: 'Assignment received',
  offer: 'Offer received',
};

const RESULT = {
  sent: { label: 'Delivered', cls: 'bg-emerald-100 text-emerald-800' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
  skipped: { label: 'Skipped', cls: 'bg-slate-100 text-slate-600' },
  scheduled: { label: 'Scheduled', cls: 'bg-sky-100 text-sky-800' },
};

// Machine reasons in plain words. Anything unknown is shown as-is, because a
// raw SMTP error is still more useful than a vague label.
const REASON = {
  nothing_added: 'No roles added that day, so nothing to report',
  client_is_active: 'Client was active, so no alert',
  only_if_roles_added: 'Goes out only if roles were added that day',
  no_payment_email: 'No payment email on file',
  'email: no_payment_email': 'No payment email on file',
  no_internal_email: 'No team inbox configured',
  'email: no_internal_email': 'No team inbox configured',
  smtp_not_configured: 'Mail account not configured on the server',
  'email: smtp_not_configured': 'Mail account not configured on the server',
  stale_digest: 'The recruiter mail was too old to alert on',
  inbox_alerts_off: 'Client turned inbox alerts off',
  unverified_pre_verifier_digest: 'Not verified as a real milestone, held back',
  stats_unavailable: 'Could not read the client\'s activity',
};

const COVERAGE_REASON = {
  switched_off: 'Daily summary switched off',
  unsubscribed: 'Client unsubscribed',
  no_payment_email: 'No payment email on file',
};

const FIELD = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';

/** "YYYY-MM-DD" of the IST day containing `d`. */
function istDay(d = new Date()) {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDay(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function fmtDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  return {
    day: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
  };
}

function humanReason(reason) {
  const r = String(reason || '');
  if (!r || r === 'ok') return '';
  if (r.startsWith('retrying: ')) return `Retrying after an error: ${r.slice(10)}`;
  if (r.startsWith('forced_over_')) return 'Sent by hand on a quiet day';
  return REASON[r] || r.replace(/^email: /, '');
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
          <h2 id="coverage-title" className="text-sm font-semibold text-slate-500">Daily summary coverage</h2>
          <p className={`mt-1 text-lg font-bold ${full ? 'text-emerald-700' : 'text-slate-900'}`}>
            Reaches {coverage.covered} of {coverage.activeClients} active clients
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            Every active, unpaused client gets it by email at 21:30 IST on days roles were added.
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
          <p className="mb-1 text-xs font-semibold text-slate-500">Today (IST), all client emails</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Delivered" value={today.sent} tone="text-emerald-700" />
            <Stat label="Failed" value={today.failed} tone={today.failed ? 'text-red-700' : 'text-slate-900'} />
            <Stat label="Skipped" value={today.skipped} tone="text-slate-700" />
            <Stat label="Still to send" value={today.scheduled} tone="text-sky-700" />
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
              <span className={`text-xs font-semibold ${c.reason === 'unsubscribed' ? 'text-rose-700' : 'text-amber-700'}`}>
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
      {Array.from({ length: 6 }).map((__, j) => (
        <td key={j} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-slate-100" /></td>
      ))}
    </tr>
  ));
}

function Details({ row }) {
  if (row.kind === 'daily_summary' && row.status !== 'scheduled') {
    return <span>{row.added ?? 0} added</span>;
  }
  if (row.kind === 'milestone' && Number.isFinite(row.applied)) {
    return <span>{row.applied} applied</span>;
  }
  if (row.kind === 'inbox_alert' && row.subject) {
    return <span className="line-clamp-2 text-xs text-slate-600" title={row.subject}>About: {row.subject}</span>;
  }
  return <span className="text-slate-400">-</span>;
}

function Row({ row }) {
  const when = fmtDate(row.at);
  const res = RESULT[row.status] || { label: row.status || 'Unknown', cls: 'bg-slate-100 text-slate-600' };
  const failed = row.status === 'failed';
  const reason = humanReason(row.reason);
  const title = ITEM_LABEL[row.item] || row.item || KIND_LABEL[row.kind] || row.kind;
  // The group line only when it adds something: "Onboarding" under "Cover
  // letter is ready", not "Daily activity summary" twice.
  const kindLabel = KIND_LABEL[row.kind] || row.kind;
  const group = kindLabel && !title.startsWith(kindLabel.replace(/ \(team\)$/, '')) ? kindLabel : '';
  return (
    <tr className={failed ? 'bg-red-50/70' : 'hover:bg-slate-50'}>
      <td className={`whitespace-nowrap px-3 py-2.5 align-top ${failed ? 'border-l-4 border-red-500' : 'border-l-4 border-transparent'}`}>
        <p className="text-sm font-medium text-slate-900">{when.day}</p>
        <p className="text-xs text-slate-500">{when.time}</p>
      </td>
      <td className="px-3 py-2.5 align-top">
        <p className="text-sm font-medium text-slate-900">{row.clientName || row.clientEmail}</p>
        {row.clientName ? <p className="truncate text-xs text-slate-500" title={row.clientEmail}>{row.clientEmail}</p> : null}
      </td>
      <td className="px-3 py-2.5 align-top">
        <p className="text-sm text-slate-900">{title}</p>
        {group || row.trigger === 'manual' ? (
          <p className="text-xs text-slate-500">
            {[group, row.trigger === 'manual' ? 'sent by hand' : ''].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2.5 align-top">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${res.cls}`}>{res.label}</span>
        {row.status === 'scheduled' && row.dueNow ? (
          <span className="ml-1.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Due now</span>
        ) : null}
        {reason ? (
          <p className={`mt-1 break-words text-xs ${failed ? 'text-red-700' : 'text-slate-500'}`}>{reason}</p>
        ) : null}
      </td>
      <td className="px-3 py-2.5 align-top">
        {row.to ? <p className="truncate text-xs text-slate-700" title={row.to}>{row.to}</p> : <span className="text-xs text-slate-400">No address</span>}
      </td>
      <td className="px-3 py-2.5 align-top text-sm tabular-nums text-slate-700"><Details row={row} /></td>
    </tr>
  );
}

function NotificationsView() {
  const [params, setParams] = useSearchParams();
  const today = istDay();
  const status = params.get('status') || 'all';
  const kind = params.get('kind') || '';
  const trigger = params.get('trigger') || '';
  const allDates = params.get('dates') === 'all';
  // No dates in the URL means today: the tab opens on what went out today.
  const hasDates = params.has('from') || params.has('to');
  const from = allDates ? '' : hasDates ? params.get('from') || '' : today;
  const to = allDates ? '' : hasDates ? params.get('to') || '' : today;
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
        if (v === null || v === undefined || v === false) next.delete(k);
        else next.set(k, v);
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  // Dates are always written as a pair, so an emptied box means "open-ended",
  // not "fall back to today".
  const setDates = useCallback((nextFrom, nextTo) => {
    setFilter({ from: nextFrom, to: nextTo, dates: null });
  }, [setFilter]);

  // Debounce typing into the URL; keep the box in step when the URL changes elsewhere (Clear, back button).
  useEffect(() => {
    if (searchText.trim() === q) return undefined;
    const t = setTimeout(() => setFilter({ q: searchText.trim() || null }), SEARCH_DEBOUNCE_MS);
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
    if (kind) qs.set('kind', kind);
    if (trigger) qs.set('trigger', trigger);
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
  }, [page, status, kind, trigger, q, from, to]);

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

  const counts = data?.counts || { sent: 0, failed: 0, skipped: 0, scheduled: 0 };
  const chipCount = { all: counts.sent + counts.failed + counts.skipped, ...counts };
  const isDefault = status === 'all' && !kind && !trigger && !q && !allDates && from === today && to === today;
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  const rangeText = allDates || (!from && !to)
    ? 'all dates'
    : from === to
      ? (from === today ? 'today' : fmtDay(from))
      : `${from ? fmtDay(from) : 'the start'} to ${to ? fmtDay(to) : 'now'}`;

  const clear = () => { setSearchText(''); setParams({}, { replace: true }); };
  const goPage = (p) => setFilter({ page: p > 1 ? String(p) : null });

  const presets = [
    { label: 'Today', active: !allDates && from === today && to === today, apply: () => setDates(today, today) },
    { label: 'Yesterday', active: !allDates && from === shiftDay(today, -1) && to === shiftDay(today, -1), apply: () => setDates(shiftDay(today, -1), shiftDay(today, -1)) },
    { label: 'Last 7 days', active: !allDates && from === shiftDay(today, -6) && to === today, apply: () => setDates(shiftDay(today, -6), today) },
    { label: 'All dates', active: allDates, apply: () => setFilter({ dates: 'all', from: null, to: null }) },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every email sent to clients: daily summaries, onboarding, plan milestones and inbox alerts, plus what is scheduled next. Times are IST.
      </p>

      <div className="mt-4"><CoverageCard summary={summary} error={summaryError} onRetry={loadSummary} /></div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="n-search" className="mb-1 block text-xs font-semibold text-slate-600">Client</label>
          <input id="n-search" type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search name or email" className={`${FIELD} w-full`} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="n-kind" className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
          <select id="n-kind" value={kind} onChange={(e) => setFilter({ kind: e.target.value || null })} className={FIELD}>
            <option value="">All emails</option>
            {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="n-trigger" className="mb-1 block text-xs font-semibold text-slate-600">Sent by</label>
          <select id="n-trigger" value={trigger} onChange={(e) => setFilter({ trigger: e.target.value || null })} className={FIELD}>
            <option value="">Anyone</option>
            <option value="auto">Automatic</option>
            <option value="manual">An operator, by hand</option>
          </select>
        </div>
        <div>
          <label htmlFor="n-from" className="mb-1 block text-xs font-semibold text-slate-600">From</label>
          <input id="n-from" type="date" value={from} max={to || undefined}
            onChange={(e) => setDates(e.target.value, to)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="n-to" className="mb-1 block text-xs font-semibold text-slate-600">To</label>
          <input id="n-to" type="date" value={to} min={from || undefined}
            onChange={(e) => setDates(from, e.target.value)} className={FIELD} />
        </div>
        <button type="button" onClick={clear} disabled={isDefault && !searchText}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40">
          Reset
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Filter by result" className="flex flex-wrap gap-1.5">
          {STATUS_CHIPS.map((c) => (
            <button key={c.key} type="button" aria-pressed={status === c.key} onClick={() => setFilter({ status: c.key === 'all' ? null : c.key })}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${status === c.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {c.label}{data ? <span className="ml-1.5 tabular-nums opacity-70">{chipCount[c.key]}</span> : null}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Date range" className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.label} type="button" aria-pressed={p.active} onClick={p.apply}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${p.active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={loadList} className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700">Retry</button>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm" aria-busy={loading}>
        <table className="w-full min-w-[1080px] table-fixed border-collapse text-left">
          <caption className="sr-only">Client emails, {rangeText}</caption>
          <colgroup>
            <col className="w-[8.5rem]" />
            <col className="w-[19%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[19%]" />
            <col />
          </colgroup>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {[status === 'scheduled' ? 'Goes out' : 'When', 'Client', 'Email', 'Result', 'Sent to', 'Details'].map((h) => (
                <th key={h} scope="col" className="px-3 py-2.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data ? <SkeletonRows /> : rows.map((r) => <Row key={r.id} row={r} />)}
          </tbody>
        </table>
        {!loading && !error && data && rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            {status === 'scheduled' ? (
              <p className="font-semibold text-slate-700">Nothing scheduled for {rangeText}</p>
            ) : (
              <p className="font-semibold text-slate-700">No client emails for {rangeText}{kind || trigger || q || status !== 'all' ? ' with these filters' : ''}</p>
            )}
            {!isDefault ? (
              <button type="button" onClick={clear} className="mt-2 text-sm font-semibold text-blue-700 hover:underline">Back to today</button>
            ) : chipCount.scheduled > 0 ? (
              <button type="button" onClick={() => setFilter({ status: 'scheduled' })} className="mt-2 text-sm font-semibold text-blue-700 hover:underline">
                See the {chipCount.scheduled} scheduled for later
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={`mt-3 flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between ${loading && data ? 'opacity-60' : ''}`}>
        <p aria-live="polite">{data ? (total === 0 ? 'Showing 0 of 0' : `Showing ${first}-${last} of ${total}`) : ''}</p>
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
