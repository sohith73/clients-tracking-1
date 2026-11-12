// Jobs Added — per client, per day: how many jobs JobRight, HiringCafe, Indeed
// and Glassdoor added, and one plain line wherever a platform added nothing.
//
// Counts are read from the jobs themselves, so they are right for any past
// day. The reasons ("Glassdoor daily limit used", "Not needed - JobRight gave
// 24") come from the Flashfire Autopilot, which runs on a laptop and checks in
// every ~45 s while it works. That is also what drives the banner: open this
// page at 6 AM during a 1 AM run and it says jobs are still being added, and
// refreshes itself until the run is done. If the laptop stops checking in
// (asleep, offline) the banner says so instead of pretending all is well.
// Server side: GET /api/job-add-report, utils/jobAddReport.js.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, isAbortError } from '../utils/apiClient';

const PLATFORMS = [
  { key: 'jobright', label: 'JobRight' },
  { key: 'hiringcafe', label: 'HiringCafe' },
  { key: 'indeed', label: 'Indeed' },
  { key: 'glassdoor', label: 'Glassdoor' },
];

const TONE = {
  good: 'text-emerald-700',
  live: 'text-blue-700',
  bad: 'text-red-700',
  warn: 'text-amber-700',
  skip: 'text-slate-500',
  muted: 'text-slate-400',
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'under', label: 'Under 5' },
  { key: 'live', label: 'Adding now' },
  { key: 'problem', label: 'Problems' },
  { key: 'europe', label: 'Europe' },
];

const REFRESH_MS = 60 * 1000;

function shiftDay(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function fmtTime(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function prettyDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function RunBanner({ run, isToday }) {
  if (!run) return null;
  const progress = run.total ? `${run.done} of ${run.total} clients done` : '';
  const now = run.current && run.current.length ? ` · now on ${run.current.join(', ')}` : '';
  if (run.state === 'live') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <span className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-600" />
        </span>
        <div>
          <p className="font-semibold">Jobs are being added right now - these numbers are not final yet.</p>
          <p className="mt-0.5 text-blue-700">
            {progress}{now}. Started {fmtTime(run.startedAt)}, last update {fmtTime(run.heartbeatAt)}. This page refreshes every minute.
          </p>
        </div>
      </div>
    );
  }
  if (run.state === 'stalled') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-semibold">The job run has paused - no update for {run.minutesSinceUpdate} min.</p>
        <p className="mt-0.5">
          {progress}. The laptop running it may be asleep or offline. Numbers below are what was added before it stopped.
        </p>
      </div>
    );
  }
  if (run.state === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span className="font-semibold">Job run finished</span>
        {run.finishedAt ? ` at ${fmtTime(run.finishedAt)}` : ''}
        {run.total ? ` · ${run.total} clients worked on` : ''}. Numbers below are final for the run (the team may still add more by hand).
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
      {isToday
        ? 'No Autopilot job run has started for this day yet. Numbers below are jobs added so far by anyone.'
        : 'No Autopilot run was recorded for this day. Counts are still exact; reasons are filled in from the rules.'}
    </div>
  );
}

function Cell({ cell }) {
  if (!cell) return <td className="px-3 py-2.5" />;
  const live = cell.state === 'running' || cell.state === 'queued';
  return (
    <td className="px-3 py-2.5 align-top">
      {cell.count ? (
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-bold text-emerald-700 tabular-nums">{cell.count}</span>
          {live ? <span className="text-[11px] font-medium text-blue-700">adding…</span> : null}
        </div>
      ) : null}
      {cell.text && !(cell.count && live) ? (
        <p className={`text-xs leading-snug ${cell.count ? 'text-slate-500' : TONE[cell.tone] || TONE.muted}`}>
          {live && !cell.count ? <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600 align-middle" /> : null}
          {cell.text}
        </p>
      ) : null}
    </td>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

export default function JobsAddedReport() {
  const [day, setDay] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  // Paused/inactive clients with nothing added are hidden by default: dozens
  // of rows that say "Client paused" four times bury the ones that matter.
  const [showPaused, setShowPaused] = useState(false);
  const abortRef = useRef(null);

  const load = useCallback(async (which, quiet = false) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    if (!quiet) setLoading(true);
    try {
      const q = which ? `?date=${encodeURIComponent(which)}` : '';
      const res = await apiFetch(`/api/job-add-report${q}`, { signal: ctl.signal });
      setData(res);
      setError('');
      if (!which) setDay(res.day);
    } catch (e) {
      if (!isAbortError(e)) setError(e.message || 'Could not load the report');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { load(day || ''); }, [day, load]);

  const isToday = data && data.day === data.today;
  const live = data?.run?.state === 'live';

  // Today's page keeps itself current; a past day never changes.
  useEffect(() => {
    if (!isToday) return undefined;
    const t = setInterval(() => load(data.day, true), live ? REFRESH_MS : REFRESH_MS * 3);
    return () => clearInterval(t);
  }, [isToday, live, data?.day, load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const rows = useMemo(() => {
    const all = data?.rows || [];
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (!showPaused && r.paused && !r.total) return false;
      if (q && !r.email.includes(q) && !(r.name || '').toLowerCase().includes(q)) return false;
      const cells = Object.values(r.cells);
      if (filter === 'under') return !r.paused && r.total < 5;
      if (filter === 'live') return cells.some((c) => c.state === 'running' || c.state === 'queued');
      if (filter === 'problem') return cells.some((c) => c.tone === 'bad' || c.tone === 'warn');
      if (filter === 'europe') return String(r.country).toLowerCase() === 'europe';
      return true;
    });
  }, [data, query, filter, showPaused]);

  const totals = useMemo(() => {
    const all = (data?.rows || []).filter((r) => !r.paused);
    const sum = (k) => all.reduce((n, r) => n + (r.cells[k]?.count || 0), 0);
    return {
      clients: all.length,
      jobs: all.reduce((n, r) => n + r.total, 0),
      under: all.filter((r) => r.total < 5).length,
      ...Object.fromEntries(PLATFORMS.map((p) => [p.key, sum(p.key)])),
    };
  }, [data]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Jobs Added</h1>
          <p className="mt-1 text-sm text-slate-500">
            Jobs each platform added per client. A day runs 10 PM to 10 PM IST, the same as the daily cap.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => day && setDay(shiftDay(day, -1))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50" aria-label="Previous day">‹</button>
          <input type="date" value={day} max={data?.today || undefined}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          <button type="button" disabled={!day || (data && day >= data.today)}
            onClick={() => setDay(shiftDay(day, 1))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40" aria-label="Next day">›</button>
          <button type="button" disabled={isToday} onClick={() => data && setDay(data.today)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Today</button>
          <button type="button" onClick={() => load(day)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Refresh</button>
        </div>
      </div>

      {data ? <p className="mt-3 text-sm font-medium text-slate-700">{prettyDay(data.day)}{isToday ? ' · today' : ''}</p> : null}

      <div className="mt-3"><RunBanner run={data?.run} isToday={isToday} /></div>

      {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      {data ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Active clients" value={totals.clients} />
          <Stat label="Jobs added" value={totals.jobs} />
          <Stat label="Under 5 jobs" value={totals.under} />
          {PLATFORMS.map((p) => <Stat key={p.key} label={p.label} value={totals[p.key]} />)}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === f.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showPaused} onChange={(e) => setShowPaused(e.target.checked)} />
          Show paused ({(data?.rows || []).filter((r) => r.paused && !r.total).length})
        </label>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email or name"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-64" />
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Client</th>
              <th className="px-3 py-2.5">Country</th>
              {PLATFORMS.map((p) => <th key={p.key} className="px-3 py-2.5">{p.label}</th>)}
              <th className="px-3 py-2.5 min-w-[260px]">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No clients match.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.email} className={r.paused ? 'bg-slate-50/60 text-slate-400' : ''}>
                <td className="px-3 py-2.5 align-top">
                  <p className="font-medium text-slate-900">{r.email}</p>
                  <p className="text-xs text-slate-500">{r.name}{r.paused ? ' · paused/inactive' : ''}</p>
                </td>
                <td className="px-3 py-2.5 align-top text-slate-700">{r.country || '—'}</td>
                {PLATFORMS.map((p) => <Cell key={p.key} cell={r.cells[p.key]} />)}
                <td className="px-3 py-2.5 align-top text-xs leading-snug text-slate-700">
                  <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${r.total >= 5 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{r.total}</span>
                  {r.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data ? <p className="mt-2 text-xs text-slate-400">{rows.length} of {data.rows.length} clients shown{loading ? ' · refreshing…' : ''}</p> : null}
    </div>
  );
}
