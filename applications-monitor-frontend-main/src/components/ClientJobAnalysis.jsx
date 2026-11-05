import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Layout from './Layout';
import toast from 'react-hot-toast';
import JobrightCredsBody from './JobrightCredsBody.jsx';
import ClientAppPasswordModal from './ClientAppPasswordModal.jsx';
import { Link } from 'react-router-dom';
import { Pencil, X, Loader2, Play, Square, CheckCircle2, XCircle, Clock, SkipForward, AlertTriangle, ChevronDown, ChevronRight, BellOff } from 'lucide-react';
import {
  buildDashboardManagerSelectOptions,
  selectValueMatchingOption
} from '../utils/dashboardManagerSelect.js';
import { fetchDashboardManagerFullNames } from '../utils/fetchDashboardManagerCatalog.js';
import { apiFetch, getCached, invalidateCache } from '../utils/apiClient';
import { rowDeliveryKeys, matchesDeliveryFilter, countDeliveryStates } from '../utils/deliveryStatus';

const API_BASE = import.meta.env.VITE_BASE || 'https://clients-tracking-backend.onrender.com';
// Scraper backend (local internal tool at DASH/scraper). Configurable via
// VITE_SCRAPER_BASE — default is the dev port. The Scrape column is
// admin-only and talks to this service directly.
const SCRAPER_BASE = import.meta.env.VITE_SCRAPER_BASE || 'http://localhost:8092';
const AUTH_HEADERS = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`
});

/**
 * Present an operator name: "sonali" -> "Sonali", "priya sharma" -> "Priya Sharma".
 *
 * Was first-letter-only plus .toLowerCase() on everything after it, which
 * capitalised the first word and then actively DAMAGED the rest: a correctly
 * stored "Priya Sharma" came out as "Priya sharma". Each word is handled on its
 * own now.
 *
 * The tail of a word is only lowercased when the word carries no deliberate
 * casing of its own, so "SATHYA" still becomes "Sathya" while "McDonald" and
 * "O'Brien" survive intact.
 */
function capitalizeOperatorName(name) {
  if (!name || typeof name !== 'string') return '';
  const t = name.trim();
  if (!t) return '';
  return t.split(/\s+/).map((w) => {
    if (!w) return w;
    const rest = w.slice(1);
    const flatten = /^[a-z]*$/.test(rest) || /^[A-Z]+$/.test(w);
    return w.charAt(0).toUpperCase() + (flatten ? rest.toLowerCase() : rest);
  }).join(' ');
}

/** Format client display as number-name-plan (e.g. 5711-akrati-executive). Optimal: single pass, handles missing fields. */
function formatClientLabel(row) {
  const num = row.clientNumber != null && row.clientNumber !== '' ? String(row.clientNumber) : '';
  const nameRaw = row.name || row.email || '';
  const nameSlug = (nameRaw.split(/\s+/)[0] || nameRaw.split('@')[0] || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || 'unknown';
  const plan = (row.planType || '').toLowerCase().replace(/\s+/g, '') || 'unknown';
  const parts = num ? [num, nameSlug, plan] : [nameSlug, plan];
  return parts.join('-') || nameRaw || row.email || '-';
}

// Per-row derived values (cap math, status normalization). Depends ONLY on the
// row data, so we compute it once per data change in the processedRows memo
// instead of re-running it for every row on every render (typing in the scrape
// box, toggling sort, etc. used to recompute this for all 500+ rows).
const WARN_OFFSET = 50;
// Row classification shared by the header filters and the cells that render
// them. Kept in one place on purpose: the filter and the badge must agree, and
// they diverge the moment either side re-derives the rule inline.
function rowClientStatus(r) {
  const s = r.status;
  if (s === undefined || s === null || String(s).trim() === '') return 'active';
  return String(s).toLowerCase().trim() === 'inactive' ? 'inactive' : 'active';
}
// Tri-state shown in the Pause/Unpause/New column. onboardingPhase wins over
// isPaused — a client still onboarding reads as "New", never "Paused".
function rowPhase(r) {
  return r.onboardingPhase ? 'new' : r.isPaused ? 'paused' : 'unpaused';
}

// Canonical plan bucket for the PLAN column filter. Deliberately uses the same
// substring matching as computeRowDerived's cap math, so a row can never be
// hidden by a filter that disagrees with the limit printed on it. Anything that
// matches nothing lands in 'other' rather than being quietly folded into a real
// plan. An unrecognised value is a data problem worth being able to select.
function rowPlanKey(r) {
  const plan = String(r.planType || '').trim().toLowerCase();
  if (!plan) return 'blank';
  if (plan.includes('prime')) return 'prime';
  if (plan.includes('ignite')) return 'ignite';
  if (plan.includes('professional')) return 'professional';
  if (plan.includes('executive')) return 'executive';
  return 'other';
}

// One dropdown for every filterable column header. Written once so every filter
// stays visually identical and the next one is a two-line change. The clear
// button only appears once a value is chosen, matching the original
// "Last applied by" control this was factored out of.
// Attention alerts. Codes and severities are decided on the server
// (utils/clientAlerts.js) so the panel, the row badges and any future digest
// can never disagree; the client only supplies presentation.
const ALERT_CODES = {
  stripe_mismatch: {
    title: 'Plan mismatch',
    blurb: 'Client registered on a different plan than what they paid for on Stripe.',
    tint: 'text-red-700 bg-red-50 border-red-200',
    chip: 'border-red-300 bg-red-50 text-red-800'
  },
  no_adds: {
    title: 'No jobs added',
    blurb: 'Active clients with nothing added in the last operator window or longer.',
    tint: 'text-rose-700 bg-rose-50 border-rose-200',
    chip: 'border-rose-300 bg-rose-50 text-rose-800'
  },
  not_applied: {
    title: 'Saved but not applied',
    blurb: 'Active clients with job cards waiting and nothing applied today.',
    tint: 'text-amber-800 bg-amber-50 border-amber-200',
    chip: 'border-amber-300 bg-amber-50 text-amber-900'
  }
};
const ALERT_ORDER = ['stripe_mismatch', 'no_adds', 'not_applied'];

// Columns rendered by the table below. Every row — header, data, skeleton and
// the two full-width placeholders — must agree on this number. It used to be
// written inline as `isAdmin ? 19 : 18`, but no column is admin-conditional
// (isAdmin only gates the summary strip and the Scrape All button), so the
// non-admin branch silently centred the "No data" and "Loading more" rows
// against the wrong width.
const TABLE_COLUMN_COUNT = 20;

function HeaderFilter({ label, value, onChange, options, title, width = 'w-[104px]' }) {
  return (
    // Stacked, not side by side: a label+select on one line forced every
    // filtered column to roughly double width, which pushed the count columns
    // off screen. The select sits under its own title and is width-capped, so
    // a long operator name can't stretch the column either.
    <div className="flex flex-col items-start gap-1">
      <span className="whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-1">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={`${width} max-w-full px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 truncate`}
          title={title}
        >
          <option value="">All</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {value && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="px-1 py-0.5 text-[10px] leading-none text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded border border-gray-300"
            title="Clear filter"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// Duration since a client's first application, rendered in months.
//
// Uses the average month (30.4375 days = 365.25/12) rather than 30, so a full
// calendar quarter reads "3 months" instead of drifting to 3.5. Rounded to the
// nearest half so the column stays scannable: 1 month, 1.5 months, 3 months.
//
// Under 30 days it falls back to days. Everything in that range would round to
// "0 months" or "0.5 months", which tells an operator nothing about a client
// who started last week.
const AVG_DAYS_PER_MONTH = 30.4375;
const AVG_DAYS_PER_YEAR = 365.25;
// Drop the ".0" so a whole unit reads "3 months", not "3.0 months".
const halfStep = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
// "Updated 12s ago". Owns its own 5s timer so the tick re-renders only this
// label, never the whole table. Staleness is spelled out in text (not just
// colour or a tooltip) so keyboard and touch users get it too.
const STALE_AFTER_MS = 3 * 60_000;
const VERY_STALE_AFTER_MS = 10 * 60_000;
function DataAgeLabel({ updatedAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const ageMs = Math.max(0, now - updatedAt);
  const sec = Math.floor(ageMs / 1000);
  const min = Math.floor(sec / 60);
  const label = sec < 10 ? 'just now'
    : sec < 60 ? `${sec}s ago`
    : min < 60 ? `${min}m ago`
    : `${Math.floor(min / 60)}h ${min % 60}m ago`;
  const stale = ageMs > STALE_AFTER_MS;
  const tone = ageMs > VERY_STALE_AFTER_MS ? 'text-red-600 font-semibold'
    : stale ? 'text-amber-600 font-semibold'
    : 'text-gray-500';
  return (
    <time
      dateTime={new Date(updatedAt).toISOString()}
      title={`Data computed ${new Date(updatedAt).toLocaleString()}. Auto-refreshes every minute.`}
      className={`text-xs whitespace-nowrap ${tone}`}
    >
      Updated {label}{stale ? ', may be stale' : ''}
    </time>
  );
}

function formatSinceFirstApply(days) {
  if (days == null || !Number.isFinite(days)) return null;
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`;
  const months = Math.round((days / AVG_DAYS_PER_MONTH) * 2) / 2;
  if (months < 12) return `${halfStep(months)} ${months === 1 ? 'month' : 'months'}`;
  // Switch on ROUNDED months, not on a raw day count: 360 days rounds to 12
  // months, so showing "12 months" there while 365 shows "1 year" would read as
  // a jump. Anything that rounds to a full year is expressed in years.
  const years = Math.round((days / AVG_DAYS_PER_YEAR) * 2) / 2;
  return `${halfStep(years)} ${years === 1 ? 'year' : 'years'}`;
}

function computeRowDerived(r) {
  const totalApplications =
    Number(r.saved || 0) + Number(r.applied || 0) + Number(r.interviewing || 0) +
    Number(r.offer || 0) + Number(r.rejected || 0);
  const plan = String(r.planType || '').trim().toLowerCase();
  const isPrime = plan.includes('prime');
  const planLimit = isPrime ? 160
    : plan.includes('ignite') ? 250
    : plan.includes('professional') ? 500
    : plan.includes('executive') ? 1200
    : Infinity;
  const addonLimit = Number(r.addonLimit || 0);
  const referralBonus = Number(r.referralApplicationsAdded || 0);
  const totalLimit = planLimit + addonLimit + referralBonus;
  const exceeded = totalLimit !== Infinity && totalApplications >= totalLimit;
  const warnThreshold = (totalLimit === Infinity || isPrime) ? null : Math.max(1, totalLimit - WARN_OFFSET);
  const nearCap = !exceeded && warnThreshold != null && totalApplications >= warnThreshold;
  const normalizedClientStatus = rowClientStatus(r);
  const isClientRowActive = normalizedClientStatus === 'active';
  const isActiveWithNoSaved = isClientRowActive && Number(r.saved || 0) === 0;
  return {
    totalApplications, addonLimit, referralBonus, totalLimit, exceeded,
    warnThreshold, nearCap, normalizedClientStatus, isClientRowActive, isActiveWithNoSaved,
  };
}

// How many table rows to mount per chunk. Rows render incrementally as the
// sentinel scrolls into view — keeps initial paint fast and DOM/RAM bounded.
const ROW_CHUNK = 80;

export default function ClientJobAnalysis() {
  const [date, setDate] = useState('');
  const [rows, setRows] = useState([]);
  // Mattermost readiness per client email (for the "Mattermost" column).
  // Loaded separately from the heavy analysis endpoint; refreshed on load + Refresh.
  //   withWebhook   - a webhook URL is saved for this client
  //   failing       - saved, but its last real delivery attempt errored
  //   noPaymentEmail- no payment email on file, so the email half cannot send
  const [mmConn, setMmConn] = useState({
    withWebhook: new Set(),
    failing: new Set(),
    noPaymentEmail: new Set()
  });
  // Google-mail connection, shown as a small second dot in the same cell. It is
  // a different question from "can we reach them": this is whether we can still
  // READ their inbox, which is what produces the interview and offer alerts in
  // the first place. Losing sight of it was how a dead token could go unnoticed.
  const [mailConn, setMailConn] = useState({ connected: new Set(), reconnect: new Set(), appPassword: new Set() });
  // Client whose Gmail app password popup is open ({ email, name }) or null.
  const [appPwFor, setAppPwFor] = useState(null);
  // Column legend, opened from the header. Closed by default so it costs no space.
  const [deliveryLegendOpen, setDeliveryLegendOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sortDir, setSortDir] = useState('desc');
  // Sort on "Since 1st Apply": null = default ordering (active first, then
  // client number). Cycles null -> desc -> asc -> null so an operator can get
  // back to the default without reloading.
  const [sinceSortDir, setSinceSortDir] = useState(null);
  const [dashboardManagerNames, setDashboardManagerNames] = useState([]);
  const [savingDashboardManager, setSavingDashboardManager] = useState(new Set());
  const [savingStatus, setSavingStatus] = useState(new Set());
  const [savingPause, setSavingPause] = useState(new Set());
  const [savingCountry, setSavingCountry] = useState(new Set());
  const [savingJobright, setSavingJobright] = useState(new Set());
  // The autopilot credentials behind a "Yes", keyed by email. Flipping the
  // toggle provisions them, but the toast that said so is long gone by the
  // next page load - so a manager had no way to confirm the account details
  // actually landed. Fetched on demand, one client at a time: these are real
  // passwords and there is no reason to pull 300 of them to render a table.
  const [credsByEmail, setCredsByEmail] = useState({});
  const [credsOpenFor, setCredsOpenFor] = useState('');
  const [credsLoading, setCredsLoading] = useState('');

  const loadJobrightCreds = async (email) => {
    // Second click closes the popover rather than refetching.
    if (credsOpenFor === email) { setCredsOpenFor(''); return; }
    setCredsOpenFor(email);
    if (credsByEmail[email]) return;
    setCredsLoading(email);
    try {
      const resp = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(email)}/jobright-creds`, {
        headers: AUTH_HEADERS(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Failed to load credentials');
      setCredsByEmail((prev) => ({ ...prev, [email]: data }));
    } catch (e) {
      toast.error(e.message || 'Failed to load JobRight credentials');
      setCredsOpenFor('');
    } finally {
      setCredsLoading('');
    }
  };
  // Per-client scrape counts, loaded from the scraper service on mount. The
  // per-row Scrape column that used to edit them is gone; these now only seed
  // the "Scrape All" modal, where each count is still editable before running.
  const [scrapeCountByEmail, setScrapeCountByEmail] = useState({});
  // Batch ("Scrape All") modal state.
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchConfirmEligible, setBatchConfirmEligible] = useState([]); // [{email,name,count}]
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchState, setBatchState] = useState(null); // snapshot from SSE
  const batchSourceRef = useRef(null); // active EventSource
  const [userRole, setUserRole] = useState(null);
  const [lastAppliedByFilter, setLastAppliedByFilter] = useState(''); // Filter for "Last applied by" operator name
  const [statusFilter, setStatusFilter] = useState('');   // '' | active | inactive
  const [phaseFilter, setPhaseFilter] = useState('');     // '' | new | paused | unpaused
  const [addFilter, setAddFilter] = useState('');         // '' | under | stale | met
  const [countryFilter, setCountryFilter] = useState(''); // '' | USA | Canada | UK | Australia | Europe | blank
  const [dashboardMgrFilter, setDashboardMgrFilter] = useState('');
  // '' | prime | ignite | professional | executive | blank | other | mismatch.
  // 'mismatch' is not a plan: the ⚠ Payment mismatch badge renders in this same
  // column and had no way to be filtered on, so it belongs in this dropdown.
  const [planFilter, setPlanFilter] = useState('');
  // '' | yes | no. Whether a JobRight account has been created for the client,
  // set by GET /scripts/jobrightsync. The whole point of the red J is finding
  // the clients still waiting on one, so the column needs a way to list them.
  const [jobrightFilter, setJobrightFilter] = useState('');
  // Delivery column: '' | mail_ok | mail_reconnect | mail_none
  //                     | hook_ok | hook_failing | hook_missing
  //                     | no_payment_email
  const [deliveryFilter, setDeliveryFilter] = useState('');
  const [addSortDir, setAddSortDir] = useState(null);     // null | 'worst' | 'best'
  const [alertFilter, setAlertFilter] = useState('');     // '' | stripe_mismatch | no_adds | not_applied
  const [alertsOpen, setAlertsOpen] = useState(false);    // expanded client list
  // Hidden for the rest of this browser session only. Deliberately sessionStorage
  // and not localStorage: an operator who dismisses this on Monday must still be
  // shown Tuesday's problems, otherwise the panel quietly stops working and
  // nobody notices it stopped.
  const [alertsMuted, setAlertsMuted] = useState(() => {
    try { return sessionStorage.getItem('cja_alerts_muted') === '1'; } catch { return false; }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [editingClientNumberEmail, setEditingClientNumberEmail] = useState(null);
  const [editingClientNumberValue, setEditingClientNumberValue] = useState('');
  const [savingClientNumber, setSavingClientNumber] = useState(false);
  const [summaryCounts, setSummaryCounts] = useState({
    active: 0, inactive: 0, new: 0, paused: 0, unpaused: 0,
    // Jobs-added rollup for the live 22:00 IST window. underTarget counts only
    // clients we actually owe work to (active, unpaused, not onboarding), so it
    // never inflates with clients who legitimately get nothing added.
    underTarget: 0, addedToday: 0, staleClients: 0
  });
  const lastAppliedRef = useRef({}); // Canonical lastAppliedOperatorName from initial (no-date) load
  // Freshness + background refresh bookkeeping. Refs, not state, so the poll
  // timer never restarts and a tick never re-renders the table.
  const reqSeqRef = useRef(0);          // id of the newest request started
  const appliedSeqRef = useRef(0);      // id of the newest response applied
  const inFlightRef = useRef(0);        // requests currently running
  const loadingCountRef = useRef(0);    // visible (non-silent) requests running
  const lastOkAtRef = useRef(0);        // client time of last successful fetch
  const silentFailsRef = useRef(0);     // consecutive background failures
  const dateRef = useRef('');           // latest picked date, read by the poll
  // When the data on screen was computed (server `generatedAt`, else the
  // client fetch time) and a ticking "now" so the label ages without a fetch.
  const [dataUpdatedAt, setDataUpdatedAt] = useState(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setUserRole(user?.role || null);
  }, []);

  const convertToDMY = useCallback((iso) => {
    if (!iso) return '';
    const dt = new Date(iso);
    const d = dt.getDate();
    const m = dt.getMonth() + 1;
    const y = dt.getFullYear();
    return `${d}/${m}/${y}`;
  }, []);

  // `silent` is for background polling: no loading flag (the table keeps its
  // rows, scroll, filters and edits), and failures keep the last good data.
  const fetchAnalysis = useCallback(async (selected, force = false, silent = false) => {
    const seq = ++reqSeqRef.current;
    inFlightRef.current += 1;
    if (!silent) {
      loadingCountRef.current += 1;
      setLoading(true);
    }
    try {
      const dateKey = selected ? convertToDMY(selected) : '';
      // `force` bypasses the BROWSER cache; `refresh: true` tells the server to
      // skip its own stale-while-revalidate path too. Without it, Refresh could
      // be answered from the server's persistent cache with an arbitrarily old
      // payload — the button would look like it worked and change nothing.
      const body = {
        ...(dateKey ? { date: dateKey } : {}),
        ...(force ? { refresh: true } : {})
      };
      // Shared cache key with the board + modal; `force` for explicit refresh
      // and post-mutation reloads.
      const data = await getCached(
        `analysis:${dateKey || '__all__'}`,
        () => apiFetch('/api/analytics/client-job-analysis', { method: 'POST', body }),
        { ttl: 30_000, force: force || silent }
      );
      // An older response must never overwrite a newer one that already landed.
      // A background poll is also dropped when ANY newer request has started,
      // not only landed: an edit's forced refetch is newer than the poll, and a
      // poll arriving first would briefly revert the optimistic row.
      if (seq < appliedSeqRef.current || (silent && seq !== reqSeqRef.current)) return;
      appliedSeqRef.current = seq;
      const newRows = data.rows || [];

      if (!selected) {
        // Initial load (no date filter): capture canonical lastAppliedOperatorName
        const map = {};
        newRows.forEach(r => { map[r.email] = r.lastAppliedOperatorName || ''; });
        lastAppliedRef.current = map;
        setRows(newRows);
      } else {
        // Date-filtered refresh: preserve lastAppliedOperatorName from initial load
        setRows(newRows.map(r => ({
          ...r,
          lastAppliedOperatorName: lastAppliedRef.current[r.email] ?? r.lastAppliedOperatorName ?? ''
        })));
      }

      if (data.summary) setSummaryCounts(data.summary);
      const gen = data.generatedAt ? Date.parse(data.generatedAt) : NaN;
      setDataUpdatedAt(Number.isFinite(gen) ? gen : Date.now());
      lastOkAtRef.current = Date.now();
      silentFailsRef.current = 0;
    } catch {
      if (!silent) {
        toast.error('Failed to load client job analysis');
      } else {
        // Keep the last good data; speak up once after repeated failures.
        silentFailsRef.current += 1;
        if (silentFailsRef.current === 3) {
          toast.error('Auto-refresh is failing. Showing the last loaded data.');
        }
      }
    } finally {
      inFlightRef.current -= 1;
      // Counted, not toggled: a dropped older response must not clear the
      // spinner of a newer visible fetch that is still running.
      if (!silent) {
        loadingCountRef.current -= 1;
        if (loadingCountRef.current <= 0) setLoading(false);
      }
    }
  }, [convertToDMY]);

  // Load Mattermost readiness AND Google-mail connection (separate, lightweight
  // endpoints, fetched together). Non-blocking and independent: if one fails the
  // other still renders, rather than blanking the whole column.
  const loadMailConnection = useCallback(async () => {
    const toSet = (v) => new Set((v || []).map((e) => String(e).toLowerCase()));

    const [mm, gm] = await Promise.allSettled([
      fetch(`${API_BASE}/api/clients/mattermost-status`, { headers: AUTH_HEADERS() }),
      fetch(`${API_BASE}/api/clients/mail-connection`, { headers: AUTH_HEADERS() })
    ]);

    try {
      if (mm.status === 'fulfilled' && mm.value.ok) {
        const data = await mm.value.json().catch(() => ({}));
        setMmConn({
          withWebhook: toSet(data.withWebhook),
          failing: toSet(data.failing),
          noPaymentEmail: toSet(data.noPaymentEmail)
        });
      }
    } catch {
      /* non-blocking */
    }

    try {
      if (gm.status === 'fulfilled' && gm.value.ok) {
        const data = await gm.value.json().catch(() => ({}));
        setMailConn({
          connected: toSet(data.connected),
          reconnect: toSet(data.reconnect),
          appPassword: toSet(data.appPassword)
        });
      }
    } catch {
      /* non-blocking */
    }
  }, []);

  const handleSaveClientNumber = useCallback(async () => {
    if (!editingClientNumberEmail || userRole !== 'admin') return;
    const val = String(editingClientNumberValue || '').trim();
    setSavingClientNumber(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(editingClientNumberEmail)}/client-number`, {
        method: 'PATCH',
        headers: AUTH_HEADERS(),
        body: JSON.stringify({ clientNumber: val ? parseInt(val, 10) : null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      toast.success('Client number updated');
      setEditingClientNumberEmail(null);
      setEditingClientNumberValue('');
      invalidateCache('analysis:');
      fetchAnalysis(date, true);
    } catch (e) {
      toast.error(e.message || 'Failed');
    } finally {
      setSavingClientNumber(false);
    }
  }, [editingClientNumberEmail, editingClientNumberValue, userRole, date, fetchAnalysis]);

  useEffect(() => {
    (async () => {
      try {
        const names = await fetchDashboardManagerFullNames(API_BASE, AUTH_HEADERS);
        setDashboardManagerNames(names);
      } catch (e) {
        console.error('Failed to load dashboard managers (same source as Manager Dashboard):', e);
      }
    })();
  }, []);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  useEffect(() => { dateRef.current = date; }, [date]);

  // Auto-refresh: one 60s timer while the tab is visible, plus an immediate
  // refetch when the tab comes back and the data is older than 30s. Never
  // overlaps a request that is still running.
  useEffect(() => {
    const AUTO_MS = 60_000;
    const RESUME_STALE_MS = 30_000;
    const run = () => {
      if (document.visibilityState !== 'visible' || inFlightRef.current > 0) return;
      fetchAnalysis(dateRef.current || undefined, false, true);
    };
    const id = setInterval(run, AUTO_MS);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastOkAtRef.current > RESUME_STALE_MS) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchAnalysis]);

  // Load mail-connection status on mount (refreshed alongside the Refresh button).
  useEffect(() => {
    loadMailConnection();
  }, [loadMailConnection]);

  // One-time bulk load of saved scrape counts from the scraper service.
  // Failures here never block the page — the Scrape column just starts
  // with empty inputs, and the admin can still type + save.
  useEffect(() => {
    if (userRole !== 'admin') return;
    (async () => {
      try {
        const res = await fetch(`${SCRAPER_BASE}/api/client-settings`);
        if (!res.ok) return;
        const data = await res.json();
        const map = {};
        (data.settings || []).forEach((s) => {
          if (s.email && Number.isInteger(s.scrapeCount)) {
            map[s.email] = String(s.scrapeCount);
          }
        });
        if (Object.keys(map).length) {
          setScrapeCountByEmail((prev) => ({ ...map, ...prev }));
        }
      } catch {
        /* scraper offline is not fatal */
      }
    })();
  }, [userRole]);


  const dashboardSelectOptions = useMemo(
    () =>
      buildDashboardManagerSelectOptions(
        dashboardManagerNames,
        rows.map((r) => r.dashboardTeamLeadName)
      ),
    [dashboardManagerNames, rows]
  );

  const onRefresh = () => { invalidateCache('analysis:'); fetchAnalysis(date, true); loadMailConnection(); };

  const findAppliedOnDate = useCallback(async () => {
    if (!date) {
      toast.error('Pick a date first');
      return;
    }
    try {
      const body = { date: convertToDMY(date) };
      const resp = await fetch(`${API_BASE}/api/analytics/applied-by-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!resp.ok) throw new Error('Failed');
      const data = await resp.json();
      const map = data.counts || {};
      // Merge counts into current rows optimally without extra fetch
      setRows(prev => (prev || []).map(r => ({ ...r, appliedOnDate: Number(map[r.email] || 0) })));
      toast.success(`Updated applied-on-date for ${Object.keys(map).length} client(s)`);
    } catch {
      toast.error('Failed to fetch applied-on-date');
    }
  }, [date, convertToDMY]);

  const handleDashboardManagerChange = async (email, dashboardTeamLeadName) => {
    if (userRole !== 'admin') {
      toast.error('Only admins can change Dashboard Manager');
      return;
    }
    setSavingDashboardManager(prev => new Set(prev).add(email));
    try {
      const resp = await fetch(`${API_BASE}/api/clients/update-dashboard-team-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, dashboardTeamLeadName })
      });
      if (!resp.ok) throw new Error('Failed to save');
      const data = await resp.json();
      if (data.success) {
        // Update the row in state
        setRows(prev => prev.map(r =>
          r.email === email ? { ...r, dashboardTeamLeadName } : r
        ));
        invalidateCache('analysis:');
        toast.success('Dashboard Manager updated successfully');
      }
    } catch {
      toast.error('Failed to update dashboard manager');
    } finally {
      setSavingDashboardManager(prev => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
    }
  };

  const handleStatusChange = async (email, status) => {
    if (userRole !== 'admin') {
      toast.error('Only admins can change client status');
      return;
    }

    setSavingStatus(prev => new Set(prev).add(email));
    try {
      const resp = await fetch(`${API_BASE}/api/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, status, currentPath: window.location.pathname })
      });
      if (!resp.ok) throw new Error('Failed to save');
      const data = await resp.json();
      if (data.message || data.updatedClientsTracking) {
        setRows(prev => prev.map(r =>
          r.email === email ? { ...r, status } : r
        ));
        invalidateCache('analysis:');
        fetchAnalysis(undefined, true);
        toast.success('Client status updated successfully');
      }
    } catch {
      toast.error('Failed to update client status');
    } finally {
      setSavingStatus(prev => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
    }
  }

  /** value: 'new' | 'paused' | 'unpaused'. New = onboarding phase (no reminders); Paused = paused; Unpaused = active reminders. */
  const handlePhasePauseChange = async (email, value) => {
    if (userRole !== 'admin') {
      toast.error('Only admins can change client phase/pause status');
      return;
    }
    const onboardingPhase = value === 'new';
    const isPaused = value === 'new' || value === 'paused';

    setSavingPause(prev => new Set(prev).add(email));
    try {
      const resp = await fetch(`${API_BASE}/api/clients`, {
        method: 'POST',
        headers: AUTH_HEADERS(),
        body: JSON.stringify({ email, isPaused, onboardingPhase, currentPath: window.location.pathname })
      });
      if (!resp.ok) throw new Error('Failed to save');
      const data = await resp.json();
      if (data.message || data.updatedClientsTracking) {
        setRows(prev => prev.map(r =>
          r.email === email ? { ...r, isPaused, onboardingPhase } : r
        ));
        invalidateCache('analysis:');
        fetchAnalysis(undefined, true);
        const msg = value === 'new' ? 'Client set to New (onboarding phase)' : value === 'paused' ? 'Client paused' : 'Client unpaused';
        toast.success(msg);
      }
    } catch {
      toast.error('Failed to update phase/pause status');
    } finally {
      setSavingPause(prev => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
    }
  };

  const handleCountryChange = async (email, clientCountry) => {
    if (userRole !== 'admin') {
      toast.error('Only admins can change country');
      return;
    }
    setSavingCountry((prev) => new Set(prev).add(email));
    try {
      const body =
        clientCountry === '' || clientCountry == null
          ? { clientCountry: null }
          : { clientCountry };
      const resp = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(email)}/client-country`, {
        method: 'PATCH',
        headers: AUTH_HEADERS(),
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Failed to save');
      const next =
        ['USA', 'Canada', 'UK', 'Australia', 'Europe'].includes(data.clientCountry)
          ? data.clientCountry
          : null;
      setRows((prev) =>
        prev.map((r) => (r.email === email ? { ...r, clientCountry: next } : r)),
      );
      invalidateCache('analysis:');
      toast.success('Country updated');
    } catch (e) {
      toast.error(e.message || 'Failed to update country');
    } finally {
      setSavingCountry((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(email);
        return nextSet;
      });
    }
  };


  // Toggle whether a JobRight account exists for this client. The bulk seed is
  // GET /scripts/jobrightsync; this is the per-client correction afterwards.
  const handleJobrightChange = async (email, value) => {
    const jobrightCreated = value === 'yes';
    // Mirrors verifyJobrightToggle on the server, which is the real gate.
    // Marking Yes is the team lead's own job as they onboard a client;
    // reverting to No hides the client from every "still needs an account"
    // view, so that direction stays with admins.
    if (userRole !== 'admin') {
      if (userRole !== 'team_lead') {
        toast.error('Only admins and team leads can change JobRight status');
        return;
      }
      if (!jobrightCreated) {
        toast.error('Only admins can change JobRight back to No');
        return;
      }
    }
    setSavingJobright((prev) => new Set(prev).add(email));
    try {
      const resp = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(email)}/jobright`, {
        method: 'PATCH',
        headers: AUTH_HEADERS(),
        body: JSON.stringify({ jobrightCreated }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Failed to save');
      // Trust the server's echo rather than the local guess, so a row can never
      // display a value the database did not accept.
      setRows((prev) =>
        prev.map((r) => (r.email === email ? { ...r, jobrightCreated: data.jobrightCreated === true } : r)),
      );
      invalidateCache('analysis:');
      // Saying Yes also provisions the client's JobRight credentials for the
      // autopilot. Report what actually happened rather than a flat success:
      // a failed provision still saves the flag, and an operator who is not
      // told will assume the client is ready to scrape when it is not.
      const creds = data.autopilotCreds;
      if (!data.jobrightCreated) {
        toast.success('JobRight marked as not created');
      } else if (!creds) {
        toast.success('JobRight marked as created');
      } else if (!creds.provisioned) {
        toast.error(`JobRight saved, but autopilot credentials were not created: ${creds.reason}`, { duration: 8000 });
      } else if (creds.created) {
        toast.success('JobRight marked as created - autopilot credentials added');
      } else if (creds.filled?.length) {
        toast.success(`JobRight marked as created - filled ${creds.filled.join(' and ')}`);
      } else {
        toast.success('JobRight marked as created - autopilot credentials already on file');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to update JobRight status');
    } finally {
      setSavingJobright((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(email);
        return nextSet;
      });
    }
  };

  // --- Scrape All (batch) handlers --------------------------------------

  // Eligible for batch: Active + Unpaused (NOT new, NOT paused). Inactive
  // clients are always skipped; new/paused are skipped per admin's ask.
  const computeBatchEligible = useCallback(() => {
    const eligibleRows = rows.filter((r) => {
      const status = String(r.status || 'active').toLowerCase();
      if (status !== 'active') return false;
      if (r.isPaused) return false;
      if (r.onboardingPhase) return false;
      return true;
    });
    return eligibleRows.map((r) => {
      const raw = scrapeCountByEmail[r.email];
      const parsed = Number.parseInt(raw, 10);
      const count = Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : 10;
      return { email: r.email, name: r.name || '', count };
    });
  }, [rows, scrapeCountByEmail]);

  const openBatchConfirm = useCallback(() => {
    if (userRole !== 'admin') {
      toast.error('Admins only');
      return;
    }
    const eligible = computeBatchEligible();
    if (!eligible.length) {
      toast.error('No eligible (Active + Unpaused) clients');
      return;
    }
    setBatchConfirmEligible(eligible);
    setBatchState(null);
    setBatchModalOpen(true);
  }, [userRole, computeBatchEligible]);

  const updateBatchItemCount = useCallback((email, value) => {
    const n = Number.parseInt(value, 10);
    setBatchConfirmEligible((prev) =>
      prev.map((item) =>
        item.email === email
          ? { ...item, count: Number.isInteger(n) && n >= 1 && n <= 50 ? n : item.count }
          : item,
      ),
    );
  }, []);

  const subscribeBatch = useCallback((batchId) => {
    // Close any stale source first.
    if (batchSourceRef.current) {
      try { batchSourceRef.current.close(); } catch { /* ignore */ }
      batchSourceRef.current = null;
    }
    const es = new EventSource(`${SCRAPER_BASE}/api/batches/${batchId}/events`);
    batchSourceRef.current = es;
    es.addEventListener('state', (evt) => {
      try {
        const state = JSON.parse(evt.data);
        setBatchState(state);
        if (state.status && state.status !== 'running') {
          try { es.close(); } catch { /* ignore */ }
          if (batchSourceRef.current === es) batchSourceRef.current = null;
        }
      } catch {
        /* ignore malformed events */
      }
    });
    es.onerror = () => {
      // Browser auto-retries; nothing to do unless we closed already.
    };
  }, []);

  const startBatch = useCallback(async () => {
    if (userRole !== 'admin' || !batchConfirmEligible.length) return;
    setBatchStarting(true);
    try {
      const res = await fetch(`${SCRAPER_BASE}/api/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clients: batchConfirmEligible }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.batch?.id) {
        toast.error(data?.message || data?.error || `Start failed (HTTP ${res.status})`);
        return;
      }
      setBatchState(data.batch);
      subscribeBatch(data.batch.id);
    } catch (e) {
      toast.error(/failed to fetch/i.test(e.message) ? 'Scraper offline' : e.message);
    } finally {
      setBatchStarting(false);
    }
  }, [userRole, batchConfirmEligible, subscribeBatch]);

  const cancelBatch = useCallback(async () => {
    if (!batchState?.id) return;
    try {
      await fetch(`${SCRAPER_BASE}/api/batches/${batchState.id}/cancel`, { method: 'POST' });
    } catch { /* ignore */ }
  }, [batchState]);

  const closeBatchModal = useCallback(() => {
    if (batchSourceRef.current) {
      try { batchSourceRef.current.close(); } catch { /* ignore */ }
      batchSourceRef.current = null;
    }
    setBatchModalOpen(false);
    setBatchState(null);
    setBatchConfirmEligible([]);
    // Refresh the table — pushed jobs should now appear in counters.
    fetchAnalysis(date);
  }, [date, fetchAnalysis]);

  // Cleanup SSE on unmount.
  useEffect(() => {
    return () => {
      if (batchSourceRef.current) {
        try { batchSourceRef.current.close(); } catch { /* ignore */ }
        batchSourceRef.current = null;
      }
    };
  }, []);

  // Memoize unique operator names for filter dropdown
  const uniqueOperatorNames = useMemo(
    () => [...new Set(rows.map(r => r.lastAppliedOperatorName).filter(Boolean))].sort(),
    [rows]
  );

  // Get sorting number (same logic as Client Onboarding)
  const getSortingNumber = useCallback((r) => {
    if (r.clientNumber != null) return Number(r.clientNumber);
    const name = r.name || '';
    const m = name.match(/^(\d{4,})/);
    if (m) return parseInt(m[1], 10);
    const m2 = name.match(/^(\d+)/);
    if (m2) return parseInt(m2[1], 10);
    return 0;
  }, []);

  // Country counts computed from all rows (not filtered) so the badges always show totals
  const countryCounts = useMemo(() => {
    const counts = { USA: 0, Canada: 0, UK: 0, Australia: 0, Europe: 0, blank: 0 };
    for (const r of rows) {
      if (r.clientCountry === 'USA') counts.USA++;
      else if (r.clientCountry === 'Canada') counts.Canada++;
      else if (r.clientCountry === 'UK') counts.UK++;
      else if (r.clientCountry === 'Australia') counts.Australia++;
      else if (r.clientCountry === 'Europe') counts.Europe++;
      else counts.blank++;
    }
    return counts;
  }, [rows]);

  const planCounts = useMemo(() => {
    const counts = { prime: 0, ignite: 0, professional: 0, executive: 0, blank: 0, other: 0, mismatch: 0 };
    for (const r of rows) {
      counts[rowPlanKey(r)]++;
      if (r.planMismatch) counts.mismatch++;
    }
    return counts;
  }, [rows]);

  const jobrightCounts = useMemo(() => {
    let yes = 0;
    for (const r of rows) if (r.jobrightCreated === true) yes++;
    return { yes, no: rows.length - yes };
  }, [rows]);

  // Depends on mmConn/mailConn as well as rows: those two Sets load from a
  // separate, lighter endpoint than the analysis payload, so the counts have to
  // recompute when they arrive or the dropdown would read all-zero on first paint.
  const deliveryCounts = useMemo(
    () => countDeliveryStates(rows, mmConn, mailConn),
    [rows, mmConn, mailConn],
  );

  // Memoize filtered + sorted rows: active first, then by clientNumber ascending (same as Client Onboarding)
  const processedRows = useMemo(() => {
    let filtered = rows;
    if (lastAppliedByFilter) {
      const filterLower = lastAppliedByFilter.toLowerCase();
      filtered = rows.filter(r => (r.lastAppliedOperatorName || '').toLowerCase() === filterLower);
    }
    if (statusFilter) filtered = filtered.filter(r => rowClientStatus(r) === statusFilter);
    if (phaseFilter) filtered = filtered.filter(r => rowPhase(r) === phaseFilter);
    // 'under'  — below the daily add target, and we owe this client work
    // 'stale'  — under target AND nothing added for a full window or more
    // 'met'    — hit the target today
    if (addFilter === 'under') filtered = filtered.filter(r => r.isUnderTarget);
    else if (addFilter === 'stale') filtered = filtered.filter(r => r.isUnderTarget && (r.daysSinceLastAdd ?? 0) >= 1);
    else if (addFilter === 'met') filtered = filtered.filter(r => !r.isUnderTarget);
    if (alertFilter) filtered = filtered.filter(r => (r.alerts || []).some(a => a.code === alertFilter));
    if (countryFilter === 'blank') filtered = filtered.filter(r => !r.clientCountry);
    else if (countryFilter) filtered = filtered.filter(r => r.clientCountry === countryFilter);
    if (dashboardMgrFilter) {
      const filterLower = dashboardMgrFilter.toLowerCase();
      filtered = filtered.filter(r => (r.dashboardTeamLeadName || '').toLowerCase() === filterLower);
    }
    if (planFilter === 'mismatch') filtered = filtered.filter(r => !!r.planMismatch);
    else if (planFilter) filtered = filtered.filter(r => rowPlanKey(r) === planFilter);
    if (jobrightFilter === 'yes') filtered = filtered.filter(r => r.jobrightCreated === true);
    else if (jobrightFilter === 'no') filtered = filtered.filter(r => r.jobrightCreated !== true);
    if (deliveryFilter) filtered = filtered.filter(r => matchesDeliveryFilter(r, deliveryFilter, mmConn, mailConn));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(r => {
        const num = r.clientNumber != null ? String(r.clientNumber) : '';
        const name = (r.name || '').toLowerCase();
        const email = (r.email || '').toLowerCase();
        const label = formatClientLabel(r).toLowerCase();
        return num.includes(q) || name.includes(q) || email.includes(q) || label.includes(q);
      });
    }
    const sorted = [...filtered].sort((a, b) => {
      // An explicit click on "Since 1st Apply" outranks everything, including
      // the date-driven Applied-on-date sort. Clients who have never applied
      // sort last in both directions — they have no duration to compare, and
      // burying them at one end is more useful than letting them lead.
      if (sinceSortDir) {
        const av = a?.daysSinceFirstApplication;
        const bv = b?.daysSinceFirstApplication;
        const aNull = av == null, bNull = bv == null;
        if (aNull || bNull) {
          if (aNull && bNull) return 0;
          return aNull ? 1 : -1;
        }
        if (av !== bv) return sinceSortDir === 'asc' ? av - bv : bv - av;
      }
      // Sorting by add shortfall outranks the date-driven Applied sort but not
      // an explicit "Since 1st Apply" click, matching how sinceSortDir already
      // wins: the most recently clicked header is the one the operator meant.
      if (addSortDir) {
        const av = Number(a?.addShortfall ?? 0);
        const bv = Number(b?.addShortfall ?? 0);
        if (av !== bv) return addSortDir === 'worst' ? bv - av : av - bv;
        // Tie-break on silence, so two clients both 30 short are ordered by how
        // long they have been ignored rather than arbitrarily.
        const ad = a?.daysSinceLastAdd ?? 0;
        const bd = b?.daysSinceLastAdd ?? 0;
        if (ad !== bd) return addSortDir === 'worst' ? bd - ad : ad - bd;
      }
      if (date) {
        const av = Number(a?.appliedOnDate || 0);
        const bv = Number(b?.appliedOnDate || 0);
        const cmp = sortDir === 'asc' ? av - bv : bv - av;
        if (cmp !== 0) return cmp;
      }
      const statusOrder = { 'active': 0, 'inactive': 1 };
      const statusA = statusOrder[a.status] ?? 2;
      const statusB = statusOrder[b.status] ?? 2;
      if (statusA !== statusB) return statusA - statusB;
      const numA = getSortingNumber(a);
      const numB = getSortingNumber(b);
      return numA - numB;
    });
    // Attach derived cap/status math once per data change so per-render row
    // output stays cheap.
    return sorted.map((r) => ({ ...r, _d: computeRowDerived(r) }));
  }, [rows, date, sortDir, sinceSortDir, addSortDir, lastAppliedByFilter, statusFilter, phaseFilter, addFilter, alertFilter, countryFilter, dashboardMgrFilter, planFilter, jobrightFilter, deliveryFilter, mmConn, mailConn, searchQuery, getSortingNumber]);

  // ── Chunked rendering: mount ROW_CHUNK rows at a time, growing as a sentinel
  // scrolls into view. Bounds initial paint cost + DOM size for big tables. ──
  const [visibleCount, setVisibleCount] = useState(ROW_CHUNK);
  const loadMoreRef = useRef(null);
  // Reset the window whenever the underlying row set changes (refresh, filter, sort).
  useEffect(() => { setVisibleCount(ROW_CHUNK); }, [processedRows]);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleCount((c) => Math.min(c + ROW_CHUNK, processedRows.length));
      }
    }, { rootMargin: '600px' });
    io.observe(node);
    return () => io.disconnect();
  }, [processedRows.length, visibleCount]);
  const visibleRows = useMemo(
    () => processedRows.slice(0, visibleCount),
    [processedRows, visibleCount]
  );

  const isAdmin = userRole === 'admin';
  // Same people who manage JobRight credentials; the backend enforces it too.
  const canManageAppPassword = userRole === 'admin' || userRole === 'team_lead';

  // Flagged clients, computed from the UNFILTERED row set on purpose. If this
  // read from processedRows, narrowing the table with any filter would make the
  // headline count fall — which looks exactly like the problem going away.
  const alertRows = useMemo(() => {
    const flagged = (rows || []).filter((r) => (r.alerts || []).length > 0);
    // Critical first, then most alerts, then longest silence. An operator reads
    // the top of this list and stops, so the top has to be the worst.
    const weight = (r) => (r.alerts || []).reduce((n, a) => n + (a.severity === 'critical' ? 10 : 1), 0);
    return flagged.sort((a, b) =>
      (weight(b) - weight(a)) ||
      ((b.daysSinceLastAdd ?? 0) - (a.daysSinceLastAdd ?? 0)) ||
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  }, [rows]);

  const alertCounts = useMemo(() => {
    const out = { total: 0, critical: 0, stripe_mismatch: 0, no_adds: 0, not_applied: 0 };
    for (const r of alertRows) {
      for (const a of r.alerts || []) {
        out.total += 1;
        if (a.severity === 'critical') out.critical += 1;
        if (a.code in out) out[a.code] += 1;
      }
    }
    return out;
  }, [alertRows]);

  const muteAlerts = useCallback((next) => {
    setAlertsMuted(next);
    try { sessionStorage.setItem('cja_alerts_muted', next ? '1' : '0'); } catch { /* private mode */ }
  }, []);

  // Jump straight to one client: search narrows the table to them and the panel
  // collapses so the row is actually on screen.
  const focusClient = useCallback((email) => {
    setSearchQuery(email);
    setAlertFilter('');
    setAlertsOpen(false);
  }, []);

  return (
    <Layout>
      <div className="p-6 w-full">

        {/* Summary from DB (dashboardtrackings): Active, Inactive, New, Paused, Unpaused */}
        {isAdmin && (
          <div className="px-4 py-2 flex items-center gap-6 flex-wrap">
            <span className="text-sm font-medium text-gray-700">
              <span className="text-green-600 font-semibold">{summaryCounts.active}</span> Active
            </span>
            <span className="text-sm font-medium text-gray-700">
              <span className="text-red-600 font-semibold">{summaryCounts.inactive}</span> Inactive
            </span>
            <span className="text-sm font-medium text-gray-700">
              <span className="text-slate-600 font-semibold">{summaryCounts.new}</span> New
            </span>
            <span className="text-sm font-medium text-gray-700">
              <span className="text-yellow-600 font-semibold">{summaryCounts.paused}</span> Paused
            </span>
            <span className="text-sm font-medium text-gray-700">
              <span className="text-emerald-600 font-semibold">{summaryCounts.unpaused}</span> Unpaused
            </span>
            {/* Jobs-added rollup for the live 22:00 IST window. Clickable so the
                headline number and the table filter can never disagree. */}
            <span className="h-4 w-px bg-gray-300" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setAddFilter((prev) => (prev === 'under' ? '' : 'under'))}
              title="Active, unpaused clients below their daily add target in the current 22:00 IST window. Click to filter the table."
              className={`text-sm font-medium rounded-md px-2 py-0.5 border transition-colors ${
                addFilter === 'under'
                  ? 'border-red-400 bg-red-50 text-red-800'
                  : 'border-transparent text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="text-red-600 font-semibold">{summaryCounts.underTarget ?? 0}</span> Under target
            </button>
            <button
              type="button"
              onClick={() => setAddFilter((prev) => (prev === 'stale' ? '' : 'stale'))}
              title="Under target AND nothing added for a full window or more. Click to filter the table."
              className={`text-sm font-medium rounded-md px-2 py-0.5 border transition-colors ${
                addFilter === 'stale'
                  ? 'border-red-400 bg-red-50 text-red-800'
                  : 'border-transparent text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="text-red-700 font-semibold">{summaryCounts.staleClients ?? 0}</span> No adds 1d+
            </button>
            <span className="text-sm font-medium text-gray-700">
              <span className="text-indigo-600 font-semibold">{summaryCounts.addedToday ?? 0}</span> Added today
            </span>
            <span className="h-4 w-px bg-gray-300" aria-hidden="true" />
            {[
              { key: 'USA', label: 'USA', color: 'text-blue-600' },
              { key: 'Canada', label: 'Canada', color: 'text-red-500' },
              { key: 'UK', label: 'UK', color: 'text-purple-600' },
              { key: 'Australia', label: 'Australia', color: 'text-emerald-600' },
              { key: 'Europe', label: 'Europe', color: 'text-amber-600' },
              { key: 'blank', label: 'Blank', color: 'text-gray-400' },
            ].map(({ key, label, color }) => (
              <button
                key={key}
                type="button"
                onClick={() => setCountryFilter((prev) => (prev === key ? '' : key))}
                className={`text-sm font-medium rounded-md px-2 py-0.5 border transition-colors ${
                  countryFilter === key
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-800'
                    : 'border-transparent text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className={`font-semibold ${color}`}>{countryCounts[key]}</span> {label}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-gray-900">Client Job Analysis</h1>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, #, email…"
                className="pl-7 pr-7 py-1 text-xs border border-gray-300 rounded-md w-52 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
            <label className="text-xs text-gray-700">Select Date:</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md"
            />
            <button
              onClick={findAppliedOnDate}
              className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              Find Applied
            </button>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            {dataUpdatedAt && <DataAgeLabel updatedAt={dataUpdatedAt} />}
            {isAdmin && (
              <button
                type="button"
                onClick={openBatchConfirm}
                title="Scrape N jobs for every Active + Unpaused client (sequentially)."
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 inline-flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> Scrape All
              </button>
            )}
            {/* <Link to="/call-scheduler" className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Call Scheduler</Link> */}
          </div>
        </div>
        {/* ── Attention panel ──────────────────────────────────────────────
            Answers two questions the table could not: which active clients had
            nothing added in the last day, and which have job cards sitting in
            the saved column with nothing applied today. Rendered for every role,
            not just admins — the operators are the ones who can act on it. */}
        {alertRows.length > 0 && !alertsMuted && (
          <div className={`mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50/60 overflow-hidden transition-opacity ${loading ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-3 px-3 py-2 flex-wrap">
              <button
                type="button"
                onClick={() => setAlertsOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-900 hover:text-rose-700"
                title={alertsOpen ? 'Collapse the client list' : 'Show which clients are affected'}
              >
                {alertsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <AlertTriangle className="w-4 h-4" />
                {alertRows.length} client{alertRows.length === 1 ? '' : 's'} need attention
              </button>

              {ALERT_ORDER.filter((code) => alertCounts[code] > 0).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setAlertFilter((prev) => (prev === code ? '' : code))}
                  title={`${ALERT_CODES[code].blurb} Click to filter the table.`}
                  className={`px-2 py-0.5 text-xs font-medium rounded-full border transition-colors ${
                    alertFilter === code
                      ? ALERT_CODES[code].chip
                      : 'border-transparent bg-white/70 text-slate-700 hover:bg-white'
                  }`}
                >
                  {alertCounts[code]} {ALERT_CODES[code].title}
                </button>
              ))}

              {alertCounts.critical > 0 && (
                <span
                  className="text-xs text-rose-800"
                  title="Alerts that have already survived a full day of reminders without anyone acting."
                >
                  {alertCounts.critical} critical
                </span>
              )}

              <button
                type="button"
                onClick={() => muteAlerts(true)}
                title="Hide this panel until you next open the browser. It comes back on a new session so a dismissal can never turn it off permanently."
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
              >
                <BellOff className="w-3.5 h-3.5" /> Hide for this session
              </button>
            </div>

            {alertsOpen && (
              <div className="max-h-72 overflow-y-auto border-t border-rose-200 bg-white/70 divide-y divide-rose-100">
                {alertRows
                  .filter((r) => !alertFilter || (r.alerts || []).some((a) => a.code === alertFilter))
                  .map((r) => (
                    <button
                      key={r.email}
                      type="button"
                      onClick={() => focusClient(r.email)}
                      title="Show only this client in the table"
                      className="w-full text-left px-3 py-1.5 hover:bg-rose-50 flex items-start gap-3"
                    >
                      <span className="min-w-[190px] shrink-0">
                        <span className="block text-xs font-semibold text-slate-800 truncate">
                          {r.clientNumber != null ? `${r.clientNumber} · ` : ''}{r.name || r.email}
                        </span>
                        <span className="block text-[10px] text-slate-500 truncate">{r.email}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5 pt-0.5">
                        {(r.alerts || []).map((a) => (
                          <span
                            key={a.code}
                            title={a.detail}
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${ALERT_CODES[a.code]?.tint || 'text-slate-700 bg-slate-50 border-slate-200'} ${
                              a.severity === 'critical' ? 'ring-1 ring-inset ring-rose-300' : ''
                            }`}
                          >
                            {a.label}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Muted: leave one quiet line so the panel can be brought back without
            a reload, and so a hidden problem is never fully invisible. */}
        {alertRows.length > 0 && alertsMuted && (
          <div className="mx-4 mt-3 text-[11px] text-slate-500 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            {alertRows.length} client{alertRows.length === 1 ? '' : 's'} need attention.
            <button type="button" onClick={() => muteAlerts(false)} className="underline hover:text-slate-700">
              Show
            </button>
          </div>
        )}

        {/* Delivery legend. Collapsed by default so the table keeps its space;
            opened from the "?" in the Delivery header. Spelling the states out
            in one place beats a tooltip per badge that nobody hovers. */}
        {deliveryLegendOpen && (
          <div className="mx-4 mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold uppercase tracking-wide text-slate-600">
                What the Delivery column means
              </span>
              <button
                type="button"
                onClick={() => setDeliveryLegendOpen(false)}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Close legend"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 font-semibold text-slate-600">
                  Badge - can we REACH the client?
                </div>
                <ul className="space-y-1">
                  <li className="flex items-start gap-2">
                    <span className="mt-px inline-flex shrink-0 items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Yes</span>
                    <span>Mattermost webhook saved, and its last delivery actually worked.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-px inline-flex shrink-0 items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Hook only</span>
                    <span>Webhook works, but there is no payment email, so the email half cannot send.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-px inline-flex shrink-0 items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Reconnect</span>
                    <span>A webhook is saved but its last real delivery failed. Re-check the URL in Operations &gt; Client Reminders.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-px inline-flex shrink-0 items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">No hook</span>
                    <span>No Mattermost webhook. Email still reaches them.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-px inline-flex shrink-0 items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">None</span>
                    <span><strong>Nothing can reach this client.</strong> No webhook and no payment email.</span>
                  </li>
                </ul>
              </div>

              <div>
                <div className="mb-1 font-semibold text-slate-600">
                  Dot - can we READ their inbox?
                </div>
                <p className="mb-1.5 text-slate-600">
                  This is what detects interviews, assignments and offers. It is a different
                  question from whether we can reach them.
                </p>
                <ul className="space-y-1">
                  <li className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-green-500" />
                    <span>Mail connected, by Gmail app password or Google sign-in.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span><strong>Reconnect needed.</strong> The Google token expired or Gmail refused the app password, so we have stopped seeing their mail.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-red-400" />
                    <span>Never connected. We cannot detect their interviews or offers at all.</span>
                  </li>
                </ul>
                {canManageAppPassword && (
                  <p className="mt-1.5 text-slate-600">
                    Click a client's dot to connect or replace their Gmail app password.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="px-4 py-3 overflow-x-auto">
          <table className="w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-slate-50">
              <tr className="align-top">
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">Client</th>
                <th className="px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 w-[126px] leading-tight">
                  <HeaderFilter
                    width="w-[118px]"
                    label={
                      <span className="inline-flex items-center gap-1">
                        <span>Delivery</span>
                        <button
                          type="button"
                          onClick={() => setDeliveryLegendOpen((v) => !v)}
                          aria-expanded={deliveryLegendOpen}
                          aria-label="What do these badges mean?"
                          title="What do these badges mean?"
                          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-400 text-[9px] font-bold leading-none text-slate-500 hover:border-slate-600 hover:text-slate-700"
                        >
                          ?
                        </button>
                      </span>
                    }
                    value={deliveryFilter}
                    onChange={setDeliveryFilter}
                    title="Filter by what we can reach this client on. Mail = the small G dot (can we READ their inbox). Hook = the Mattermost badge (can we SEND to them)."
                    options={[
                      { value: 'mail_none', label: `Mail: not connected (${deliveryCounts.mail_none})` },
                      { value: 'mail_reconnect', label: `Mail: reconnect (${deliveryCounts.mail_reconnect})` },
                      { value: 'mail_ok', label: `Mail: connected (${deliveryCounts.mail_ok})` },
                      { value: 'hook_missing', label: `Hook: missing (${deliveryCounts.hook_missing})` },
                      { value: 'hook_failing', label: `Hook: failing (${deliveryCounts.hook_failing})` },
                      { value: 'hook_ok', label: `Hook: working (${deliveryCounts.hook_ok})` },
                      { value: 'no_payment_email', label: `No payment email (${deliveryCounts.no_payment_email})` },
                    ]}
                  />
                </th>
                <th className="px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 w-[96px]">
                  <HeaderFilter
                    label="Status"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    title="Filter by client status"
                    options={[
                      { value: 'active', label: 'Active' },
                      { value: 'inactive', label: 'Inactive' }
                    ]}
                  />
                </th>
                <th className="px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 w-[86px] leading-tight">
                  <HeaderFilter
                    label="Country"
                    value={countryFilter}
                    onChange={setCountryFilter}
                    options={[
                      { value: 'USA', label: `USA (${countryCounts.USA})` },
                      { value: 'Canada', label: `Canada (${countryCounts.Canada})` },
                      { value: 'UK', label: `UK (${countryCounts.UK})` },
                      { value: 'Australia', label: `Australia (${countryCounts.Australia})` },
                      { value: 'Europe', label: `Europe (${countryCounts.Europe})` },
                      { value: 'blank', label: `Blank (${countryCounts.blank})` },
                    ]}
                  />
                </th>
                <th className="px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 w-[98px]">
                  <HeaderFilter
                    label="Pause / Unpause / New"
                    value={phaseFilter}
                    onChange={setPhaseFilter}
                    title="Filter by onboarding / pause phase. A paused client shows how long they have been paused directly under the control, so there is no separate Paused column."
                    options={[
                      { value: 'new', label: 'New' },
                      { value: 'paused', label: 'Paused' },
                      { value: 'unpaused', label: 'Unpaused' }
                    ]}
                  />
                </th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 w-[118px]">
                  <HeaderFilter
                    label="Plan"
                    value={planFilter}
                    onChange={setPlanFilter}
                    title="Filter by plan, or isolate the clients whose plan disagrees with the payment on their record"
                    options={[
                      { value: 'prime', label: `Prime (${planCounts.prime})` },
                      { value: 'ignite', label: `Ignite (${planCounts.ignite})` },
                      { value: 'professional', label: `Professional (${planCounts.professional})` },
                      { value: 'executive', label: `Executive (${planCounts.executive})` },
                      { value: 'blank', label: `Blank (${planCounts.blank})` },
                      // Only worth offering when such rows exist. An always-on
                      // "Other (0)" is noise in a dropdown this narrow.
                      ...(planCounts.other > 0 ? [{ value: 'other', label: `Other (${planCounts.other})` }] : []),
                      ...(planCounts.mismatch > 0 ? [{ value: 'mismatch', label: `⚠ Payment mismatch (${planCounts.mismatch})` }] : []),
                    ]}
                  />
                </th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  <HeaderFilter
                    label="Last applied by"
                    value={lastAppliedByFilter}
                    onChange={setLastAppliedByFilter}
                    title="Filter by operator"
                    options={uniqueOperatorNames.map((name) => ({
                      value: name,
                      label: capitalizeOperatorName(name)
                    }))}
                  />
                </th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  <HeaderFilter
                    label="Dashboard Mgr"
                    value={dashboardMgrFilter}
                    onChange={setDashboardMgrFilter}
                    title="Filter by dashboard manager"
                    options={dashboardSelectOptions.map((name) => ({ value: name, label: name }))}
                  />
                </th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">Total Apps</th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">Saved</th>
                <th
                  className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-indigo-700 border-l border-indigo-200"
                  title="Job cards ADDED for this client in the live operator window, against their daily target (targetJobCount, else 30 — the same number the push cap enforces as a ceiling). The window runs 22:00 IST to 22:00 IST, NOT midnight to midnight, so this always agrees with the counter the extension shows the operator. Ignores the date picker: the picker filters appliedDate, and there is no reliable per-day added history to filter on."
                >
                  <div className="flex flex-col items-start gap-1">
                    <span className="whitespace-nowrap">Added Today</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setAddSortDir((prev) => (prev === null ? 'worst' : prev === 'worst' ? 'best' : null))
                        }
                        title={
                          addSortDir === null
                            ? 'Sort by biggest shortfall first'
                            : addSortDir === 'worst'
                              ? 'Sorted biggest shortfall first — click for smallest'
                              : 'Sorted smallest shortfall first — click to clear'
                        }
                        className={`px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal rounded-md border ${
                          addSortDir
                            ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {addSortDir === 'best' ? '▲ Best' : addSortDir === 'worst' ? '▼ Worst' : '↕ Sort'}
                      </button>
                      {/* Inlined rather than <HeaderFilter>: that component stacks
                          its own label above the select, and an empty label would
                          leave a blank line pushing this select out of alignment
                          with the sort button beside it. Styling is copied so the
                          two controls still read as one set. */}
                      <select
                        value={addFilter}
                        onChange={(e) => setAddFilter(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        title="Filter by whether this client hit their daily add target"
                        className="w-[104px] max-w-full px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 truncate"
                      >
                        <option value="">All</option>
                        <option value="under">Under target</option>
                        <option value="stale">No adds for 1d+</option>
                        <option value="met">Target met</option>
                      </select>
                      {addFilter && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setAddFilter(''); }}
                          className="px-1 py-0.5 text-[10px] leading-none text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded border border-gray-300"
                          title="Clear filter"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </th>
                {/* Yday — HIDDEN. Job cards added in the PREVIOUS 22:00 IST
                    window, i.e. the day-over-day comparison against Added Today:
                    a client at 28 yesterday and 3 today is a different problem
                    from one at 3 on both days. Commented out to save width, not
                    removed. The backend still returns `addedYesterday` on every
                    row, so restoring it is uncommenting these three blocks
                    (header, cell, skeleton) and putting TABLE_COLUMN_COUNT back
                    to 21. Search "Yday — HIDDEN" to find all three.
                <th
                  className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700"
                  title="Job cards added in the PREVIOUS 22:00 IST window."
                >
                  Yday
                </th>
                */}
                <th
                  className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 border-r border-indigo-200"
                  title="Average job cards added per day across the last 7 CLOSED windows. Today is excluded on purpose — a window that is two hours old would drag the average down and make every client look like they are falling behind every morning."
                >
                  7d Avg
                </th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">Applied</th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">Interview</th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">Offer</th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">Rejected</th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">Removed</th>
                {/* JobRight, in the slot the "Removed by AI" column used to
                    occupy. The flag is written only by GET /scripts/jobrightsync
                    off data/jobrightClients.js; nothing on this screen edits it. */}
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700 w-[104px]">
                  <HeaderFilter
                    label="JobRight"
                    value={jobrightFilter}
                    onChange={setJobrightFilter}
                    title="Whether a JobRight account has been created for this client. Seeded in bulk by /scripts/jobrightsync; admins can correct any row from its dropdown."
                    options={[
                      { value: 'no', label: `No (${jobrightCounts.no})` },
                      { value: 'yes', label: `Yes (${jobrightCounts.yes})` },
                    ]}
                  />
                </th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  <div className="flex flex-col items-start gap-1">
                    <span
                      className="whitespace-nowrap"
                      title="Time elapsed since this client's FIRST application was submitted: days for the first month, then months, then years. Blank when they have never applied."
                    >
                      Since 1st Apply
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSinceSortDir((prev) => (prev === null ? 'desc' : prev === 'desc' ? 'asc' : null))
                      }
                      title={
                        sinceSortDir === null
                          ? 'Sort by longest running first'
                          : sinceSortDir === 'desc'
                            ? 'Sorted longest first — click for shortest first'
                            : 'Sorted shortest first — click to clear'
                      }
                      className={`px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal rounded-md border ${
                        sinceSortDir
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {sinceSortDir === 'asc' ? '▲ Shortest' : sinceSortDir === 'desc' ? '▼ Longest' : '↕ Sort'}
                    </button>
                  </div>
                </th>
                <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-semibold"
                      title={date
                        ? 'Applications stamped with the selected date.'
                        : 'Applications stamped with today\'s IST date. With no date picked this column used to read 0 for every client, which was not a fact about anyone — it is the number the "saved but not applied" alert fires on.'}
                    >
                      {date ? `Applied on ${convertToDMY(date)}` : 'Applied Today'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))}
                      title={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
                      className="px-1.5 py-0.5 text-[10px] border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                    >
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-gray-100 ${loading && processedRows.length > 0 ? 'opacity-50 pointer-events-none' : ''}`}>
              {loading && processedRows.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skel-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-2 py-2"><div className="space-y-1.5"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-28" /><div className="h-2.5 bg-gray-100 rounded animate-pulse w-36" /></div></td>
                    <td className="px-2 py-2"><div className="h-5 bg-gray-200 rounded animate-pulse w-12" /></td>
                    <td className="px-2 py-2"><div className="h-5 bg-gray-200 rounded animate-pulse w-16" /></td>
                    <td className="px-2 py-2"><div className="h-5 bg-gray-200 rounded animate-pulse w-14" /></td>
                    <td className="px-2 py-2"><div className="h-5 bg-gray-200 rounded animate-pulse w-20" /></td>
                    <td className="px-2 py-2"><div className="h-5 bg-gray-200 rounded animate-pulse w-16" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-20" /></td>
                    <td className="px-2 py-2"><div className="h-5 bg-gray-200 rounded animate-pulse w-24" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-10 ml-auto" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-8 ml-auto" /></td>
                    {/* Added Today / 7d Avg — the jobs-added columns. */}
                    <td className="px-2 py-2"><div className="h-5 bg-indigo-200/70 rounded-full animate-pulse w-12 ml-auto" /></td>
                    {/* Yday — HIDDEN. See the matching note in the header.
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-8 ml-auto" /></td>
                    */}
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-8 ml-auto" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-8 ml-auto" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-8 ml-auto" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-8 ml-auto" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-8 ml-auto" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-8 ml-auto" /></td>
                    {/* JobRight. */}
                    <td className="px-2 py-2"><div className="h-5 w-12 bg-gray-200 rounded-md animate-pulse" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-14 ml-auto" /></td>
                    <td className="px-2 py-2"><div className="h-3.5 bg-gray-200 rounded animate-pulse w-10 ml-auto" /></td>
                  </tr>
                ))
              ) : processedRows.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLUMN_COUNT} className="px-2 py-8 text-center text-gray-500 text-sm">
                    {searchQuery.trim()
                      ? `No clients match "${searchQuery}"`
                      : (lastAppliedByFilter || statusFilter || phaseFilter || addFilter || alertFilter || countryFilter || dashboardMgrFilter || planFilter || jobrightFilter || deliveryFilter)
                        ? 'No clients match the selected filters'
                        : 'No data'}
                  </td>
                </tr>
              ) : visibleRows.map((r, idx) => {
                // Cap math + status normalization precomputed in processedRows (see computeRowDerived).
                const {
                  totalApplications, addonLimit, referralBonus, totalLimit,
                  exceeded, warnThreshold, nearCap,
                  normalizedClientStatus, isClientRowActive, isActiveWithNoSaved,
                } = r._d;

                let rowColor;
                if (exceeded) {
                  rowColor = 'bg-red-200';
                } else if (nearCap) {
                  // Distinct from exceeded (red) — amber = "almost there".
                  rowColor = 'bg-amber-100';
                } else if (isActiveWithNoSaved) {
                  rowColor = 'bg-orange-100';
                } else {
                  rowColor = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                }

                return (
                  <tr key={r.email + idx} className={rowColor}>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1.5 max-w-[180px]">
                        {/* The panel above is the summary; this is the same
                            signal at the row, so a flagged client stays obvious
                            once you scroll past the header. */}
                        {(r.alerts || []).length > 0 && (
                          // Wrapped in a span rather than putting title on the
                          // icon: `title` on an inline <svg> is not a reliable
                          // tooltip across browsers, SVG wants a <title> child.
                          <span
                            className="shrink-0 leading-none"
                            title={(r.alerts || []).map((a) => `${a.label} — ${a.detail}`).join('\n')}
                          >
                            <AlertTriangle
                              className={`w-3.5 h-3.5 ${
                                (r.alerts || []).some((a) => a.severity === 'critical') ? 'text-rose-600' : 'text-amber-500'
                              }`}
                            />
                          </span>
                        )}
                        <div className="text-gray-900 font-medium truncate min-w-0 flex-1" title={r.email}>
                          {formatClientLabel(r)}
                        </div>
                      </div>
                      <div className="text-gray-500 text-[10px] truncate max-w-[180px]">{r.email}</div>
                    </td>
                    <td className="px-2 py-1">
                      {(() => {
                        // TWO signals in one cell, because they answer two
                        // different questions and losing either one hides a real
                        // failure:
                        //   the word badge - can we REACH this client (Mattermost
                        //     webhook + payment email)
                        //   the G dot      - can we still READ their inbox, which
                        //     is what produces the interview and offer alerts
                        // The dot is 8px, so the second signal costs no width.
                        // Same helper the Delivery dropdown filters on, so a
                        // row can never be hidden by a selection that disagrees
                        // with the badge printed in it.
                        const dk = rowDeliveryKeys(r.email, mmConn, mailConn);
                        const hasHook = dk.hook !== 'missing';
                        const isFailing = dk.hook === 'failing';
                        const noPay = dk.noPay;
                        const cls = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold';

                        let badge;
                        if (hasHook && !isFailing) {
                          badge = <span className={`${cls} bg-green-100 text-green-700`} title={noPay ? 'Mattermost webhook connected and working. No payment email on file, so the email half cannot send.' : 'Mattermost webhook connected and its last delivery succeeded.'}>{noPay ? 'Hook only' : 'Yes'}</span>;
                        } else if (hasHook && isFailing) {
                          badge = <span className={`${cls} bg-amber-100 text-amber-700`} title="A webhook is saved but its last real delivery failed. Re-check the URL in Operations > Client Reminders.">Reconnect</span>;
                        } else if (noPay) {
                          badge = <span className={`${cls} bg-red-100 text-red-700`} title="No Mattermost webhook AND no payment email. Nothing we send can reach this client at all.">None</span>;
                        } else {
                          badge = <span className={`${cls} bg-red-100 text-red-700`} title="No Mattermost webhook saved. Email still works.">No hook</span>;
                        }

                        const gConnected = dk.mail === 'ok';
                        const gReconnect = dk.mail === 'reconnect';
                        const gTone = gConnected
                          ? 'bg-green-500'
                          : gReconnect
                            ? 'bg-amber-500'
                            : 'bg-red-400';
                        const viaAppPw = mailConn.appPassword?.has(String(r.email || '').toLowerCase());
                        const gTitle = (gConnected
                          ? viaAppPw
                            ? 'Mail connected by Gmail app password. We can read this inbox for interview, assignment and offer mails.'
                            : 'Google mail connected. We can read this inbox for interview, assignment and offer mails.'
                          : gReconnect
                            ? viaAppPw
                              ? 'Gmail refused the saved app password. REPLACE it, or we stop seeing their interview and offer mails.'
                              : 'Google mail was connected but the token expired. RECONNECT needed, or we stop seeing their interview and offer mails.'
                            : 'No mail connected. We cannot detect interviews, assignments or offers for this client.')
                          + (canManageAppPassword ? ' Click to set the Gmail app password.' : '');
                        const dot = <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${gTone}`} aria-hidden="true" />;

                        return (
                          <span className="inline-flex items-center gap-1">
                            {badge}
                            {canManageAppPassword ? (
                              <button
                                type="button"
                                onClick={() => setAppPwFor({ email: r.email, name: r.name || '' })}
                                title={gTitle}
                                aria-label={gTitle}
                                className="-m-1 inline-flex items-center justify-center rounded-full p-1 hover:ring-2 hover:ring-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                              >
                                {dot}
                              </button>
                            ) : (
                              <span className="inline-flex" title={gTitle} aria-label={gTitle} role="img">{dot}</span>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1">
                      {userRole === 'admin' ? (
                        <select
                          value={normalizedClientStatus}
                          onChange={(e) => handleStatusChange(r.email, e.target.value)}
                          disabled={savingStatus.has(r.email)}
                          className={`px-1.5 py-0.5 text-[11px] border rounded-md font-semibold shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed ${isClientRowActive ? 'bg-green-100 text-green-700 border-green-300' :
                            'bg-red-100 text-red-700 border-red-300'
                            }`}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      ) : r.status !== undefined && r.status !== null && String(r.status).trim() !== '' ? (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${isClientRowActive ? 'bg-green-100 text-green-700' :
                          'bg-red-100 text-red-700'
                          }`}>
                          {isClientRowActive ? 'Active' : 'Inactive'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {userRole === 'admin' ? (
                        <select
                          value={
                            ['USA', 'Canada', 'UK', 'Australia', 'Europe'].includes(r.clientCountry)
                              ? r.clientCountry
                              : ''
                          }
                          onChange={(e) => handleCountryChange(r.email, e.target.value)}
                          disabled={savingCountry.has(r.email)}
                          className="px-1.5 py-0.5 text-[11px] border border-slate-300 rounded-md bg-white shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Client region"
                        >
                          <option value="">—</option>
                          <option value="USA">USA</option>
                          <option value="Canada">Canada</option>
                          <option value="UK">UK</option>
                          <option value="Australia">Australia</option>
                          <option value="Europe">Europe</option>
                        </select>
                      ) : (
                        <span className="text-[11px] text-slate-700">
                          {['USA', 'Canada', 'UK', 'Australia', 'Europe'].includes(r.clientCountry)
                            ? r.clientCountry
                            : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {/* Phase control with the paused duration stacked under it.
                          This used to be two columns — the control here and a
                          separate "Paused" column repeating the same word plus a
                          day count — which cost a full column of width to say
                          "Paused" twice. The duration is the only part that was
                          not already on screen, so only the duration survives. */}
                      <div className="flex flex-col items-start gap-0.5">
                      {(() => {
                        const phaseValue = r.onboardingPhase ? 'new' : r.isPaused ? 'paused' : 'unpaused';
                        const phaseLabel = phaseValue === 'new' ? 'New' : phaseValue === 'paused' ? 'Paused' : 'Unpaused';
                        return userRole === 'admin' ? (
                          <select
                            value={phaseValue}
                            onChange={(e) => handlePhasePauseChange(r.email, e.target.value)}
                            disabled={savingPause.has(r.email)}
                            className={`px-1.5 py-0.5 text-[11px] border rounded-md font-semibold shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed ${phaseValue === 'new' ? 'bg-slate-100 text-slate-700 border-slate-300' :
                              phaseValue === 'paused' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                                'bg-green-50 text-green-700 border-green-200'
                              }`}
                          >
                            <option value="new">New</option>
                            <option value="paused">Paused</option>
                            <option value="unpaused">Unpaused</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${phaseValue === 'new' ? 'bg-slate-100 text-slate-700' :
                            phaseValue === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-green-50 text-green-700'
                            }`}>
                            {phaseLabel}
                          </span>
                        );
                      })()}
                      {/* Duration only, and only while actually paused. An
                          onboarding client reads as "New" above, so showing a
                          paused age for them would contradict the control. */}
                      {r.isPaused && !r.onboardingPhase && (
                        loading ? (
                          <div className="h-3 w-10 rounded bg-amber-100 animate-pulse" />
                        ) : (
                          <span
                            className="text-[10px] font-semibold text-amber-800"
                            title={[
                              r.pausedAt ? `Paused on ${new Date(r.pausedAt).toLocaleDateString()}` : null,
                              r.pausedDays != null ? `${r.pausedDays} day${r.pausedDays === 1 ? '' : 's'} paused` : 'Pause date unknown'
                            ].filter(Boolean).join(' · ')}
                          >
                            {r.pausedDays != null ? `${r.pausedDays}d paused` : 'paused'}
                          </span>
                        )
                      )}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      {r.planType ? (
                        <div className="flex flex-col gap-1">
                          {/* The plan badge and the payment on the same client
                              document have to agree. When they don't, say so on
                              the row — a silent badge is how an Executive label
                              sat on top of a Professional payment. */}
                          {r.planMismatch && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-100 border border-red-300 px-1.5 py-0.5 rounded"
                              title={`Plan does not match the payment on this client: ${r.planMismatch}`}
                            >
                              ⚠ Payment mismatch
                            </span>
                          )}
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold ${r.planType.toLowerCase() === 'executive' ? 'bg-purple-100 text-purple-700' :
                            r.planType.toLowerCase() === 'professional' ? 'bg-blue-100 text-blue-700' :
                              r.planType.toLowerCase() === 'ignite' ? 'bg-orange-100 text-orange-700' :
                                r.planType.toLowerCase() === 'prime' ? 'bg-green-100 text-green-700' :
                                  'bg-gray-100 text-gray-700'
                            }`}>
                            {r.planType.charAt(0).toUpperCase() + r.planType.slice(1)}
                          </span>
                          <div className="flex flex-col gap-0.5">
                            {r.planPrice != null && (
                              <span className={`text-[10px] font-medium ${r.planMismatch ? 'text-red-700' : 'text-slate-500'}`}>
                                Plan price: {r.planPrice}
                                {r.planPriceExpected != null && r.planPriceExpected !== r.planPrice
                                  ? ` (expected ${r.planPriceExpected})`
                                  : ''}
                              </span>
                            )}
                            {addonLimit > 0 && (
                              <span className="text-[10px] text-blue-600 font-medium">
                                Addon: +{addonLimit}
                              </span>
                            )}
                            {Array.isArray(r.upgradePayments) && r.upgradePayments.filter(p => p.for?.startsWith('addon_')).length > 0 && (
                              <span className="text-[10px] text-purple-600 font-medium">
                                Addon Paid: {r.upgradePayments.filter(p => p.for?.startsWith('addon_')).map(p => `${p.currency} ${p.amount}`).join(', ')}
                              </span>
                            )}
                            {Array.isArray(r.upgradePayments) && r.upgradePayments.filter(p => p.for?.startsWith('plan_upgrade')).length > 0 && (
                              <span className="text-[10px] text-indigo-600 font-medium">
                                Upgrade Paid: {r.upgradePayments.filter(p => p.for?.startsWith('plan_upgrade')).map(p => `${p.currency} ${p.amount}`).join(', ')}
                              </span>
                            )}
                            {referralBonus > 0 && (
                              <span className="text-[10px] text-emerald-700 font-medium">
                                Referrals: +{referralBonus}
                              </span>
                            )}
                            {exceeded && (
                              <span className="text-[10px] text-red-700 font-bold uppercase tracking-wider bg-red-100 border border-red-300 px-1.5 py-0.5 rounded">
                                Excluded · {totalApplications}/{totalLimit}
                              </span>
                            )}
                            {nearCap && (
                              <span className="text-[10px] text-amber-800 font-semibold bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded" title={`Approaching cap (warning at ${warnThreshold} of ${totalLimit})`}>
                                Near cap · {totalApplications}/{totalLimit}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-[11px] text-slate-700 truncate max-w-[120px] block" title={r.lastAppliedOperatorName || ''}>
                        {r.lastAppliedOperatorName ? capitalizeOperatorName(r.lastAppliedOperatorName) : '-'}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      {userRole === 'admin' ? (
                        <select
                          value={selectValueMatchingOption(r.dashboardTeamLeadName, dashboardSelectOptions)}
                          onChange={(e) => handleDashboardManagerChange(r.email, e.target.value)}
                          disabled={savingDashboardManager.has(r.email)}
                          className="px-2 py-1 text-[11px] border border-slate-300 rounded-full bg-white shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="">Not assigned</option>
                          {dashboardSelectOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[11px] text-slate-700">
                          {r.dashboardTeamLeadName || 'Not assigned'}
                        </span>
                      )}
                    </td>
                    <td className={`px-2 py-1 text-right font-semibold ${exceeded ? 'text-red-600' : ''}`}>
                      {totalApplications}
                      {exceeded && <span className="text-[10px] block text-red-500">Exceeded</span>}
                    </td>
                    <td className="px-2 py-1 text-right">{r.saved}</td>
                    <td className="px-2 py-1 text-right border-l border-indigo-100">
                      {/* THREE states, not two. A paused, inactive or onboarding
                          client is owed no jobs, so they have no target to miss
                          — but they still read as isUnderTarget:false, which
                          used to paint them the same green as a client who
                          actually hit thirty. Green now means earned; grey means
                          the target does not apply. */}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                          !r.addTargetTracked
                            ? 'bg-slate-100 border border-slate-300 text-slate-500'
                            : r.isUnderTarget
                              ? 'bg-red-100 border border-red-300 text-red-700'
                              : 'bg-emerald-100 border border-emerald-300 text-emerald-700'
                        }`}
                        title={[
                          !r.addTargetTracked
                            ? `No daily target applies — this client is ${r.status !== 'active' ? 'inactive' : r.onboardingPhase ? 'still onboarding' : 'paused'}.`
                            : null,
                          `${r.addedToday ?? 0} of ${r.dailyTarget ?? 30} added this window (${r.addFulfillmentPct ?? 0}%)`,
                          r.isDefaultTarget ? 'No explicit target set for this client — using the default of 25' : null,
                          !r.addTargetTracked ? null : r.addShortfall ? `${r.addShortfall} short` : 'Target met',
                          r.addedTodayBy?.length ? `Added today by: ${r.addedTodayBy.join(', ')}` : 'Nobody has added for this client today',
                          r.lastAddedAt ? `Last add ${new Date(r.lastAddedAt).toLocaleString()}` : 'No job card has ever been added'
                        ].filter(Boolean).join(' · ')}
                      >
                        {r.addedToday ?? 0}/{r.addTargetTracked ? (r.dailyTarget ?? 30) : '—'}
                      </span>
                      {/* Nothing added for a full window or more. This is the
                          "no job cards for a day" case, and it is the one signal
                          on this screen that used to be completely invisible. */}
                      {r.isUnderTarget && (r.daysSinceLastAdd == null || r.daysSinceLastAdd >= 1) && (
                        <span
                          className={`block mt-0.5 text-[10px] font-semibold ${
                            r.daysSinceLastAdd == null ? 'text-rose-700' : 'text-red-600'
                          }`}
                          title={
                            r.daysSinceLastAdd == null
                              ? 'No job card has ever been added for this client'
                              : `Nothing added for ${r.daysSinceLastAdd} day${r.daysSinceLastAdd === 1 ? '' : 's'}`
                          }
                        >
                          {/* daysSinceLastAdd is null for a client who has NEVER
                              had a card added — the worst case on this screen.
                              The old guard read `(r.daysSinceLastAdd ?? 0) >= 1`,
                              so null collapsed to 0 and the badge never rendered
                              for exactly those clients. The tooltip below it
                              already had a branch for null, which could not run. */}
                          {r.daysSinceLastAdd == null
                            ? 'NEVER ADDED'
                            : r.daysSinceLastAdd === 1
                              ? 'STALE 1d'
                              : `STALE ${r.daysSinceLastAdd}d`}
                        </span>
                      )}
                    </td>
                    {/* Yday — HIDDEN. See the matching note in the header.
                    <td className="px-2 py-1 text-right text-slate-600">{r.addedYesterday ?? 0}</td>
                    */}
                    <td className="px-2 py-1 text-right text-slate-500 border-r border-indigo-100">{r.added7dAvg ?? 0}</td>
                    <td className="px-2 py-1 text-right">{r.applied}</td>
                    <td className="px-2 py-1 text-right">{r.interviewing}</td>
                    <td className="px-2 py-1 text-right">{r.offer}</td>
                    <td className="px-2 py-1 text-right">{r.rejected}</td>
                    <td className="px-2 py-1 text-right">{r.removed}</td>
                    <td className="px-2 py-1">
                      {/* Colour lives on the control's own text, not on a badge
                          beside it: option elements cannot be styled reliably
                          across browsers, but the closed select shows the chosen
                          value, so a column of red "No"s still reads at a glance. */}
                      {(userRole === 'admin' || userRole === 'team_lead') ? (
                        <select
                          value={r.jobrightCreated === true ? 'yes' : 'no'}
                          onChange={(e) => handleJobrightChange(r.email, e.target.value)}
                          // A team lead looking at a row that is already Yes has
                          // no move left, so the control is disabled outright
                          // rather than offering a No that the server refuses.
                          disabled={
                            savingJobright.has(r.email) ||
                            (userRole === 'team_lead' && r.jobrightCreated === true)
                          }
                          className={`px-1.5 py-0.5 text-[11px] font-semibold border rounded-md bg-white shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                            r.jobrightCreated === true
                              ? 'border-emerald-300 text-emerald-700'
                              : 'border-red-300 text-red-700'
                          }`}
                          title={
                            userRole === 'team_lead' && r.jobrightCreated === true
                              ? 'Already marked Yes. Only an admin can change it back to No.'
                              : 'Whether a JobRight account has been created for this client'
                          }
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      ) : (
                        <span
                          className={`text-[11px] font-semibold ${r.jobrightCreated === true ? 'text-emerald-700' : 'text-red-700'}`}
                          title={r.jobrightCreated === true ? 'JobRight account created' : 'No JobRight account yet'}
                        >
                          {r.jobrightCreated === true ? 'Yes' : 'No'}
                        </span>
                      )}
                      {/* Proof the toggle did its second job. Only for the roles
                          that may read a password, and only once the account is
                          marked as created - before that there is nothing to
                          have provisioned. */}
                      {r.jobrightCreated === true && (userRole === 'admin' || userRole === 'team_lead') && (
                        <div className="relative inline-block ml-1 align-middle">
                          <button
                            type="button"
                            onClick={() => loadJobrightCreds(r.email)}
                            className="text-[10px] px-1 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-100"
                            title="Show the autopilot login saved for this client"
                          >
                            {credsLoading === r.email ? '…' : 'creds'}
                          </button>
                          {credsOpenFor === r.email && credsByEmail[r.email] && (
                            <div className="absolute z-30 right-0 mt-1 w-72 p-2 bg-white border border-slate-300 rounded-lg shadow-lg text-left">
                              <JobrightCredsBody data={credsByEmail[r.email]} />
                              <button
                                type="button"
                                onClick={() => setCredsOpenFor('')}
                                className="mt-1 text-[10px] text-slate-500 hover:text-slate-800"
                              >
                                Close
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {r.daysSinceFirstApplication == null ? (
                        <span className="text-slate-400" title="No application submitted yet">—</span>
                      ) : (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-slate-100 border border-slate-300 text-slate-700 whitespace-nowrap"
                          title={[
                            r.firstAppliedAt ? `First applied ${new Date(r.firstAppliedAt).toLocaleDateString()}` : null,
                            `${r.daysSinceFirstApplication} day${r.daysSinceFirstApplication === 1 ? '' : 's'}`
                          ].filter(Boolean).join(' · ')}
                        >
                          {formatSinceFirstApply(r.daysSinceFirstApplication)}
                        </span>
                      )}
                    </td>
                    <td className={`px-2 py-1 font-semibold text-right ${date ? (r.appliedOnDate > 0 ? 'text-blue-800' : 'text-slate-500') : ''}`}>
                      {date ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] ${r.appliedOnDate > 0 ? 'bg-blue-100 border border-blue-300' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>
                          {r.appliedOnDate}
                        </span>
                      ) : (
                        // Zero applications with a non-empty saved column is the
                        // condition the alert fires on, so it is called out here
                        // too rather than reading as an unremarkable 0.
                        <span
                          className={r.appliedToday === 0 && r.saved > 0 ? 'text-amber-700' : 'text-slate-700'}
                          title={
                            r.daysSinceLastApply == null
                              ? `No application in the last ${r.applyLookbackDays ?? 14} days`
                              : r.daysSinceLastApply === 0
                                ? 'Applied today'
                                : `Last application ${r.daysSinceLastApply} day${r.daysSinceLastApply === 1 ? '' : 's'} ago`
                          }
                        >
                          {r.appliedToday ?? 0}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {/* Sentinel: when scrolled near, mount the next chunk of rows. */}
              {visibleRows.length < processedRows.length && (
                <tr ref={loadMoreRef}>
                  <td colSpan={TABLE_COLUMN_COUNT} className="px-2 py-3 text-center text-[11px] text-gray-400">
                    Loading more… ({visibleRows.length}/{processedRows.length})
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {appPwFor && (
        <ClientAppPasswordModal
          apiBase={API_BASE}
          authHeaders={AUTH_HEADERS}
          client={appPwFor}
          onClose={() => setAppPwFor(null)}
          onSaved={(saved) => {
            toast.success(`App password connected for ${saved?.gmailEmail || appPwFor.email}`);
            setAppPwFor(null);
            loadMailConnection();
          }}
        />
      )}

      {/* Scrape All — confirm + progress + summary modal */}
      {batchModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            // Allow dismiss only when not running, or when the run has terminated.
            const running = batchState?.status === 'running';
            if (!running) closeBatchModal();
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {batchState
                    ? batchState.status === 'running'
                      ? 'Scrape All — running'
                      : batchState.status === 'cancelled'
                        ? 'Scrape All — cancelled'
                        : 'Scrape All — done'
                    : 'Scrape All — confirm'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {batchState
                    ? 'Jobs are pushed directly to each client\'s dashboard. Discord receives per-run alerts.'
                    : 'Runs sequentially across every Active + Unpaused client. Inactive / New / Paused are skipped.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeBatchModal}
                disabled={batchState?.status === 'running'}
                title={batchState?.status === 'running' ? 'Cancel the run first' : 'Close'}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {!batchState ? (
                // --- Confirmation view ---
                <div className="space-y-3">
                  <div className="text-sm text-gray-700">
                    <span className="font-semibold">{batchConfirmEligible.length}</span> eligible client(s).
                    Total jobs requested:{' '}
                    <span className="font-semibold">
                      {batchConfirmEligible.reduce((a, b) => a + (b.count || 0), 0)}
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
                    {batchConfirmEligible.map((c) => (
                      <div key={c.email} className="flex items-center justify-between px-3 py-2 text-xs">
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="font-medium text-gray-900 truncate">{c.name || c.email}</div>
                          <div className="text-[10px] text-gray-500 truncate">{c.email}</div>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={c.count}
                          onChange={(e) => updateBatchItemCount(c.email, e.target.value)}
                          className="w-16 px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                // --- Progress / summary view ---
                <div className="space-y-4">
                  {/* Overall bar + totals */}
                  {(() => {
                    const t = batchState.totals || {};
                    const total = t.clients || 0;
                    const doneish = (t.done || 0) + (t.failed || 0) + (t.aborted || 0) + (t.skipped || 0);
                    const pct = total ? Math.round((doneish / total) * 100) : 0;
                    return (
                      <div>
                        <div className="flex items-center justify-between text-xs font-medium text-gray-700 mb-1.5">
                          <span>
                            {doneish} / {total} clients
                            {batchState.status === 'running' && batchState.currentIndex >= 0 && batchState.items[batchState.currentIndex] ? (
                              <span className="ml-2 text-indigo-600">
                                · running: {batchState.items[batchState.currentIndex].name || batchState.items[batchState.currentIndex].email}
                              </span>
                            ) : null}
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              batchState.status === 'running' ? 'bg-indigo-500' : batchState.status === 'cancelled' ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                          <span className="text-green-700">✓ {t.done || 0} done</span>
                          <span className="text-red-600">✗ {t.failed || 0} failed</span>
                          <span className="text-gray-500">⊘ {t.aborted || 0} aborted</span>
                          <span className="text-gray-500">↷ {t.skipped || 0} skipped</span>
                          <span className="text-indigo-700 ml-auto">
                            {t.jobsPushed || 0} / {t.jobsRequested || 0} jobs pushed
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Per-client list */}
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[45vh] overflow-y-auto">
                    {(batchState.items || []).map((item, i) => {
                      const isCurrent = batchState.status === 'running' && batchState.currentIndex === i;
                      const icon =
                        item.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-green-600" /> :
                        item.status === 'failed' ? <XCircle className="w-4 h-4 text-red-600" /> :
                        item.status === 'aborted' ? <Square className="w-4 h-4 text-gray-500" /> :
                        item.status === 'skipped' ? <SkipForward className="w-4 h-4 text-gray-400" /> :
                        item.status === 'running' ? <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" /> :
                        <Clock className="w-4 h-4 text-gray-400" />;
                      return (
                        <div key={item.email + i} className={`flex items-center px-3 py-2 text-xs ${isCurrent ? 'bg-indigo-50' : ''}`}>
                          <div className="w-6 flex-shrink-0">{icon}</div>
                          <div className="flex-1 min-w-0 pr-2">
                            <div className="font-medium text-gray-900 truncate">{item.name || item.email}</div>
                            <div className="text-[10px] text-gray-500 truncate">
                              {item.email}
                              {item.relaxationRounds > 0 ? (
                                <span className="ml-1.5 text-amber-600">· filter relaxations auto-declined ({item.relaxationRounds})</span>
                              ) : null}
                              {item.phase && item.status === 'running' ? (
                                <span className="ml-1.5 text-indigo-600">· {item.phase}</span>
                              ) : null}
                            </div>
                            {item.error ? (
                              <div className="text-[10px] text-red-600 truncate" title={item.error}>
                                {item.errorCode ? `${item.errorCode} — ` : ''}{item.error}
                              </div>
                            ) : null}
                          </div>
                          <div className="text-right text-[11px]">
                            <div className="font-semibold">
                              {item.pushed != null ? item.pushed : '—'} / {item.requested || item.count}
                            </div>
                            <div className="text-[10px] text-gray-500">jobs pushed</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
              {!batchState ? (
                <>
                  <button
                    type="button"
                    onClick={closeBatchModal}
                    className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={startBatch}
                    disabled={batchStarting || batchConfirmEligible.length === 0}
                    className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {batchStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Start — {batchConfirmEligible.length} client(s)
                  </button>
                </>
              ) : batchState.status === 'running' ? (
                <button
                  type="button"
                  onClick={cancelBatch}
                  className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 inline-flex items-center gap-2"
                >
                  <Square className="w-4 h-4" /> Cancel batch
                </button>
              ) : (
                <button
                  type="button"
                  onClick={closeBatchModal}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Client Number Modal */}
      {editingClientNumberEmail && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget && !savingClientNumber) { setEditingClientNumberEmail(null); setEditingClientNumberValue(''); } }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Edit Client Number</h2>
              <button type="button" onClick={() => { setEditingClientNumberEmail(null); setEditingClientNumberValue(''); }} disabled={savingClientNumber} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Client Number</label>
                <input
                  type="number"
                  min={1}
                  value={editingClientNumberValue}
                  onChange={(e) => setEditingClientNumberValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveClientNumber(); if (e.key === 'Escape') { setEditingClientNumberEmail(null); setEditingClientNumberValue(''); } }}
                  placeholder="e.g. 5810"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">Leave empty to clear the number</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
              <button type="button" onClick={() => { setEditingClientNumberEmail(null); setEditingClientNumberValue(''); }} disabled={savingClientNumber} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={handleSaveClientNumber} disabled={savingClientNumber} className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
                {savingClientNumber ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  );
}


