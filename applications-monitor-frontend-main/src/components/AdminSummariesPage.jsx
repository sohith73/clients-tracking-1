// Admin AI Summaries — dedicated page.
//
// Layout: master/detail.
//   • Top bar          — title + 4 stat tiles (clients / built / coverage / ops total)
//   • Left column      — sticky search + filter chips + scrollable client list with
//                        status pills + cap progress bars + recency timestamps
//   • Right column     — selected-client summary editor + push-history bar chart +
//                        target-cap editor. Empty state with hint when nothing picked.
//
// All admin-editable AI fields live in dashboard-backend's ProfileModel
// (aiSummary, aiSummaryMeta, targetJobCount). This page calls:
//   GET  /summaries-overview        — master list
//   GET  /get-profile?email=        — full profile for selected
//   POST /build-ai-summary          — server-side OpenAI build
//   POST /update-ai-summary         — manual edit save
//   POST /update-target-jobs        — set/remove cap
//   GET  /push-history?email=       — daily pushes (chart)

import React, { useEffect, useMemo, useState, useRef } from 'react';

const DASHBOARD_BASE = (import.meta.env.VITE_DASHBOARD_BASE || 'http://localhost:8086').replace(/\/+$/, '');

const FILTER_LABELS = {
    all: 'All',
    built: 'Summary built',
    missing: 'Missing summary',
    stale: 'Profile changed',
    capped: 'Has cap',
    'cap-reached': 'Cap reached',
    'no-cap': 'No cap',
};

export default function AdminSummariesPage() {
    const [overview, setOverview] = useState(null);
    const [overviewLoading, setOverviewLoading] = useState(false);
    const [overviewError, setOverviewError] = useState(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [selectedEmail, setSelectedEmail] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    // Bulk-build state for "Build all" button.
    const [bulkRunning, setBulkRunning] = useState(false);
    const [bulkProgress, setBulkProgress] = useState(null); // {done,total,current,errors:[]}
    const bulkAbortRef = useRef(false);

    // Read deep-link param so the page can be linked to with a preselected client.
    useEffect(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            const email = params.get('clientEmail');
            if (email) setSelectedEmail(email.toLowerCase());
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        loadOverview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]);

    async function loadOverview() {
        setOverviewLoading(true);
        setOverviewError(null);
        try {
            const r = await fetch(`${DASHBOARD_BASE}/summaries-overview`);
            const body = await r.json();
            if (!r.ok || !body?.success) {
                setOverviewError(body?.message || `HTTP ${r.status}`);
                return;
            }
            setOverview(body);
        } catch (e) {
            setOverviewError(e.message);
        } finally {
            setOverviewLoading(false);
        }
    }

    const rows = overview?.rows || [];
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) => {
            if (q) {
                const blob = `${r.email} ${r.name} ${(r.preferredRoles || []).join(' ')} ${(r.preferredLocations || []).join(' ')}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            if (filter === 'built' && !r.hasSummary) return false;
            if (filter === 'missing' && r.hasSummary) return false;
            if (filter === 'stale' && !(r.hasSummary && r.summaryStale)) return false;
            if (filter === 'capped' && r.targetJobCount == null) return false;
            if (filter === 'no-cap' && r.targetJobCount != null) return false;
            if (filter === 'cap-reached' && r.capStatus !== 'reached' && r.capStatus !== 'over') return false;
            return true;
        });
    }, [rows, search, filter]);

    const totals = overview?.totals || { clients: 0, withSummary: 0, withoutSummary: 0, stale: 0, withCap: 0, opsTotal: 0 };
    const coverage = totals.clients > 0 ? Math.round((totals.withSummary / totals.clients) * 100) : 0;
    const bulkTargets = useMemo(
        () => rows.filter((r) => !r.hasSummary || r.summaryStale),
        [rows],
    );

    // Build summaries for every client missing one OR flagged stale,
    // sequentially so we never hammer OpenAI. Refreshes overview after
    // each call so the UI reflects progress live.
    async function bulkBuildAll() {
        if (bulkRunning) return;
        const targets = bulkTargets;
        if (targets.length === 0) return;
        setBulkRunning(true);
        bulkAbortRef.current = false;
        const errors = [];
        setBulkProgress({ done: 0, total: targets.length, current: targets[0].email, errors });
        for (let i = 0; i < targets.length; i += 1) {
            if (bulkAbortRef.current) break;
            const t = targets[i];
            setBulkProgress({ done: i, total: targets.length, current: t.email, errors: [...errors] });
            try {
                const r = await fetch(`${DASHBOARD_BASE}/build-ai-summary`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ email: t.email }),
                });
                const body = await r.json().catch(() => null);
                if (!r.ok || !body?.success) {
                    errors.push({ email: t.email, error: body?.error || `HTTP ${r.status}`, message: body?.message || '' });
                }
            } catch (e) {
                errors.push({ email: t.email, error: 'NETWORK', message: e.message });
            }
        }
        setBulkProgress({ done: targets.length, total: targets.length, current: '', errors });
        setBulkRunning(false);
        await loadOverview();
    }
    function abortBulk() { bulkAbortRef.current = true; }

    const selected = useMemo(
        () => filtered.find((r) => r.email === selectedEmail) || rows.find((r) => r.email === selectedEmail) || null,
        [selectedEmail, filtered, rows],
    );

    return (
        <div className="min-h-screen bg-slate-50">
            {/* HEADER */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">AI Summaries</h1>
                            <p className="text-sm text-slate-500 mt-1">
                                Manage candidate briefs + per-client push caps used by the JR-Direct extension's grader.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            {bulkRunning ? (
                                <button
                                    onClick={abortBulk}
                                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium border border-red-200"
                                >
                                    ✕ Stop bulk build
                                </button>
                            ) : (
                                <button
                                    onClick={bulkBuildAll}
                                    disabled={bulkTargets.length === 0}
                                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Build summaries for every client missing one or flagged stale (profile changed)."
                                >
                                    ⚡ Build all ({bulkTargets.length})
                                </button>
                            )}
                            <button
                                onClick={() => setRefreshKey((k) => k + 1)}
                                disabled={bulkRunning}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium border border-slate-200 disabled:opacity-50"
                            >
                                ↻ Refresh
                            </button>
                        </div>
                    </div>

                    {/* BULK PROGRESS STRIP */}
                    {bulkProgress && (
                        <div className="mt-4 px-4 py-3 rounded-xl bg-slate-900 text-white">
                            <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="font-semibold">
                                    {bulkRunning ? 'Building…' : 'Bulk build complete'}
                                </span>
                                <span className="text-slate-300 font-mono">
                                    {bulkProgress.done} / {bulkProgress.total}
                                    {bulkProgress.current && ` · ${bulkProgress.current}`}
                                </span>
                            </div>
                            <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-400 transition-all duration-300"
                                    style={{ width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }}
                                />
                            </div>
                            {bulkProgress.errors?.length > 0 && (
                                <div className="mt-2 text-xs text-red-300">
                                    {bulkProgress.errors.length} error{bulkProgress.errors.length > 1 ? 's' : ''}
                                    {bulkProgress.errors.slice(0, 3).map((e, i) => (
                                        <span key={i} className="ml-2 opacity-80">· {e.email}: {e.error}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* STAT TILES */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
                        <StatTile label="Clients" value={totals.clients} />
                        <StatTile label="Summaries built" value={totals.withSummary} sub={`${coverage}% coverage`} accent="emerald" />
                        <StatTile label="Missing summary" value={totals.withoutSummary} sub="needs build" accent="amber" />
                        <StatTile label="Profile changed" value={totals.stale || 0} sub="needs rebuild" accent="orange" />
                        <StatTile label="Ops jobs pushed" value={totals.opsTotal} sub={`${totals.withCap} capped`} accent="blue" />
                    </div>
                </div>
            </div>

            {/* BODY */}
            <div className="max-w-7xl mx-auto px-6 py-6">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* LEFT — list */}
                    <aside className="lg:col-span-4 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 border-b border-slate-200 bg-slate-50">
                            <div className="relative">
                                <input
                                    type="search"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search name, email, roles…"
                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                                />
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
                            </div>
                            <div className="flex gap-1.5 flex-wrap mt-3">
                                {Object.keys(FILTER_LABELS).map((k) => (
                                    <button
                                        key={k}
                                        onClick={() => setFilter(k)}
                                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                            filter === k
                                                ? 'bg-slate-900 text-white'
                                                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                        }`}
                                    >
                                        {FILTER_LABELS[k]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {overviewLoading && !overview && (
                                <div className="p-6 text-center text-slate-500 text-sm">Loading clients…</div>
                            )}
                            {overviewError && (
                                <div className="p-6 text-center">
                                    <div className="text-red-700 text-sm font-medium">Failed to load</div>
                                    <div className="text-xs text-red-600 mt-1 font-mono">{overviewError}</div>
                                    <div className="text-xs text-slate-500 mt-2">
                                        Dashboard backend at <code>{DASHBOARD_BASE}</code> reachable?
                                    </div>
                                </div>
                            )}
                            {overview && filtered.length === 0 && (
                                <div className="p-6 text-center text-slate-500 text-sm">No clients match.</div>
                            )}
                            {filtered.map((r) => (
                                <ClientRow
                                    key={r.email}
                                    row={r}
                                    selected={r.email === selectedEmail}
                                    onClick={() => setSelectedEmail(r.email)}
                                />
                            ))}
                        </div>

                        <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 text-center">
                            Showing {filtered.length} of {rows.length} · sorted by recent ops pushes
                        </div>
                    </aside>

                    {/* RIGHT — detail */}
                    <main className="lg:col-span-8">
                        {!selected ? (
                            <EmptyState rowCount={rows.length} />
                        ) : (
                            <ClientDetailPane
                                key={selected.email}
                                row={selected}
                                onProfileChanged={() => setRefreshKey((k) => k + 1)}
                            />
                        )}
                    </main>
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------------------
// LEFT — list row
// -------------------------------------------------------------------------

function ClientRow({ row, selected, onClick }) {
    const initials = (row.name || row.email).split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    const cap = row.targetJobCount;
    const ops = row.currentOpsCount;
    const capPct = cap ? Math.min(100, Math.round((ops / cap) * 100)) : null;
    return (
        <button
            onClick={onClick}
            className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${
                selected ? 'bg-blue-50 border-l-4 border-l-blue-500 -ml-1 pl-3' : 'hover:bg-slate-50'
            }`}
        >
            <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    selected ? 'bg-blue-100 text-blue-900' : 'bg-slate-200 text-slate-700'
                }`}>
                    {initials}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 text-sm truncate">{row.name}</span>
                        {row.hasSummary
                            ? (row.summaryStale
                                ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700 flex-shrink-0" title="Profile changed since last summary build — rebuild recommended.">↻ CHANGED</span>
                                : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 flex-shrink-0">✓ BUILT</span>)
                            : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 flex-shrink-0">⚠ MISSING</span>}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{row.email}</div>
                    {row.planType && <div className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">{row.planType}</div>}
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
                        <span>📤 {ops}</span>
                        {cap != null ? (
                            <>
                                <span className="text-slate-300">/</span>
                                <span className={row.capStatus === 'reached' || row.capStatus === 'over' ? 'text-red-600 font-bold' : ''}>{cap}</span>
                                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full ${
                                            capPct >= 100 ? 'bg-red-500'
                                            : capPct >= 80 ? 'bg-amber-500'
                                            : 'bg-emerald-500'
                                        }`}
                                        style={{ width: `${capPct}%` }}
                                    />
                                </div>
                            </>
                        ) : (
                            <span className="text-slate-400 italic">no cap</span>
                        )}
                    </div>
                </div>
            </div>
        </button>
    );
}

// -------------------------------------------------------------------------
// RIGHT — detail pane
// -------------------------------------------------------------------------

function ClientDetailPane({ row, onProfileChanged }) {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [building, setBuilding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [targetDraft, setTargetDraft] = useState('');
    const [savingTarget, setSavingTarget] = useState(false);
    const [openaiKeyDraft, setOpenaiKeyDraft] = useState('');
    const [savingKey, setSavingKey] = useState(false);
    const [keyVisible, setKeyVisible] = useState(false);

    function showMessage(text, kind = 'ok') {
        setMessage({ text, kind });
        setError(null);
        setTimeout(() => setMessage(null), 4500);
    }
    function showError(text) {
        setError(text);
        setMessage(null);
    }

    async function loadProfile() {
        setLoading(true);
        try {
            const r = await fetch(`${DASHBOARD_BASE}/get-profile?email=${encodeURIComponent(row.email)}`);
            const body = await r.json().catch(() => null);
            if (!r.ok) {
                showError(`Profile load failed: ${body?.message || `HTTP ${r.status}`}`);
                setProfile(null);
                return;
            }
            const p = body?.userProfile || null;
            setProfile(p);
            setDraft(p?.aiSummary || '');
            setTargetDraft(p?.targetJobCount != null ? String(p.targetJobCount) : '');
            setOpenaiKeyDraft(p?.openaiKey || '');
        } catch (e) {
            showError(`Network error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }

    async function loadHistory(days = 30) {
        setHistoryLoading(true);
        try {
            const r = await fetch(`${DASHBOARD_BASE}/push-history?email=${encodeURIComponent(row.email)}&days=${days}`);
            const body = await r.json().catch(() => null);
            setHistory(r.ok && body?.success ? body : null);
        } catch {
            setHistory(null);
        } finally {
            setHistoryLoading(false);
        }
    }

    useEffect(() => {
        loadProfile();
        loadHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.email]);

    async function buildSummary() {
        setBuilding(true);
        setError(null);
        try {
            const r = await fetch(`${DASHBOARD_BASE}/build-ai-summary`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: row.email }),
            });
            const body = await r.json().catch(() => null);
            if (!r.ok || !body?.success) {
                const step = body?.step ? ` [step: ${body.step}]` : '';
                showError(`Build failed: ${body?.error || `HTTP ${r.status}`}${step} — ${body?.message || ''}`);
                return;
            }
            showMessage(`Summary built (${body.wordCount} words, ${body.source}).`);
            setEditing(false);
            await loadProfile();
            onProfileChanged?.();
        } catch (e) {
            showError(`Network error: ${e.message}`);
        } finally {
            setBuilding(false);
        }
    }

    async function saveEdit() {
        const text = draft.trim();
        if (!text) { showError('Summary cannot be empty.'); return; }
        setSaving(true);
        try {
            const wordCount = text.split(/\s+/).filter(Boolean).length;
            const r = await fetch(`${DASHBOARD_BASE}/update-ai-summary`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    email: row.email,
                    aiSummary: text,
                    model: 'manual-edit',
                    source: 'admin-summaries-page',
                    wordCount,
                }),
            });
            const body = await r.json().catch(() => null);
            if (!r.ok || body?.success === false) {
                showError(`Save failed: ${body?.message || `HTTP ${r.status}`}`);
                return;
            }
            showMessage(`Saved (${wordCount} words).`);
            setEditing(false);
            await loadProfile();
            onProfileChanged?.();
        } catch (e) {
            showError(`Network error: ${e.message}`);
        } finally {
            setSaving(false);
        }
    }

    async function saveTarget() {
        const val = targetDraft.trim();
        const n = val === '' ? null : Number.parseInt(val, 10);
        if (n !== null && (!Number.isInteger(n) || n < 0 || n > 10000)) {
            showError('Target must be 0-10000 (or empty for no cap).');
            return;
        }
        setSavingTarget(true);
        try {
            const r = await fetch(`${DASHBOARD_BASE}/update-target-jobs`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: row.email, targetJobCount: n }),
            });
            const body = await r.json().catch(() => null);
            if (!r.ok || body?.success === false) {
                showError(`Save target failed: ${body?.message || `HTTP ${r.status}`}`);
                return;
            }
            showMessage(n === null ? 'Target removed (no cap).' : `Target set to ${n} jobs.`);
            await loadProfile();
            await loadHistory();
            onProfileChanged?.();
        } catch (e) {
            showError(`Network error: ${e.message}`);
        } finally {
            setSavingTarget(false);
        }
    }

    async function saveOpenaiKey() {
        const v = openaiKeyDraft.trim();
        if (v && !/^sk-/.test(v)) {
            showError('OpenAI key must start with "sk-".');
            return;
        }
        setSavingKey(true);
        try {
            const r = await fetch(`${DASHBOARD_BASE}/update-openai-key`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: row.email, openaiKey: v }),
            });
            const body = await r.json().catch(() => null);
            if (!r.ok || body?.success === false) {
                showError(`Save key failed: ${body?.message || `HTTP ${r.status}`}`);
                return;
            }
            showMessage(v ? 'OpenAI key saved.' : 'OpenAI key cleared.');
            await loadProfile();
            onProfileChanged?.();
        } catch (e) {
            showError(`Network error: ${e.message}`);
        } finally {
            setSavingKey(false);
        }
    }

    const summary = profile?.aiSummary || '';
    const meta = profile?.aiSummaryMeta || {};
    const builtAt = meta.builtAt ? new Date(meta.builtAt).toLocaleString() : null;
    const savedKey = profile?.openaiKey || '';
    const keyMasked = savedKey ? `${savedKey.slice(0, 7)}…${savedKey.slice(-4)}` : '';

    return (
        <div className="space-y-5">
            {/* Client identity card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900">{row.name}</h2>
                        <div className="text-sm text-slate-500 font-mono">{row.email}</div>
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {row.planType && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700">
                                    {row.planType}
                                </span>
                            )}
                            {(row.preferredRoles || []).slice(0, 4).map((rr) => (
                                <span key={rr} className="px-2 py-0.5 rounded text-[11px] bg-blue-50 text-blue-700 border border-blue-200">{rr}</span>
                            ))}
                            {(row.preferredLocations || []).slice(0, 3).map((loc) => (
                                <span key={loc} className="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 border border-slate-200">📍 {loc}</span>
                            ))}
                        </div>
                    </div>
                    <a
                        href={`/monitor-clients?clientEmail=${encodeURIComponent(row.email)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 hover:underline"
                    >
                        View full profile ↗
                    </a>
                </div>
            </div>

            {/* Messages */}
            {message && (
                <div className="px-4 py-2.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-sm">
                    {message.text}
                </div>
            )}
            {error && (
                <div className="px-4 py-2.5 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm font-mono">
                    {error}
                </div>
            )}

            {/* Push history */}
            <PushHistoryCard history={history} loading={historyLoading} onReload={loadHistory} />

            {/* Target cap */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                        <h3 className="font-bold text-slate-900 flex items-center gap-2">
                            🎯 Target job count cap
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                            <code>/addjob</code> refuses ops pushes once {row.currentOpsCount} jobs reach this cap. Empty = no cap.
                        </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        row.targetJobCount == null ? 'bg-slate-100 text-slate-600'
                        : row.capStatus === 'reached' || row.capStatus === 'over' ? 'bg-red-100 text-red-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                        {row.targetJobCount == null ? '∞ no cap'
                        : `${row.currentOpsCount} / ${row.targetJobCount}`}
                    </span>
                </div>
                <div className="flex gap-2">
                    <input
                        type="number"
                        min="0"
                        max="10000"
                        step="5"
                        value={targetDraft}
                        onChange={(e) => setTargetDraft(e.target.value)}
                        placeholder="(empty = no cap)"
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button
                        onClick={saveTarget}
                        disabled={savingTarget}
                        className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
                    >
                        {savingTarget ? 'Saving…' : 'Update cap'}
                    </button>
                </div>
            </div>

            {/* AI summary */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
                    <div>
                        <h3 className="font-bold text-slate-900">Candidate Summary</h3>
                        <div className="text-xs mt-1">
                            {summary ? (
                                profile?.summaryStale ? (
                                    <span className="text-orange-700 font-semibold">
                                        ↻ Profile changed — rebuild recommended.
                                        {builtAt && <span className="text-slate-500 ml-1 font-normal">(saved {builtAt})</span>}
                                    </span>
                                ) : (
                                    <span className="text-emerald-700">
                                        Saved · {meta.wordCount || '?'} words {builtAt && `· ${builtAt}`}
                                        {meta.source && <span className="text-slate-500 ml-1">({meta.source})</span>}
                                    </span>
                                )
                            ) : (
                                <span className="text-amber-700">Not built yet — click Build to generate.</span>
                            )}
                        </div>
                    </div>
                    {!editing && (
                        <div className="flex gap-2 flex-shrink-0">
                            <button
                                onClick={buildSummary}
                                disabled={building}
                                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
                            >
                                {building ? 'Building (~15s)…' : (summary ? '↻ Rebuild' : 'Build summary')}
                            </button>
                            {summary && (
                                <button
                                    onClick={() => { setDraft(summary); setEditing(true); }}
                                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                                >
                                    ✎ Edit
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-5">
                    {loading && !profile && <div className="text-slate-400 text-sm">Loading…</div>}
                    {!editing && (
                        summary ? (
                            <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed max-h-[480px] overflow-y-auto pr-1">{summary}</pre>
                        ) : (
                            <div className="text-slate-400 italic text-sm">No summary on file. Click <strong>Build summary</strong> above.</div>
                        )
                    )}
                    {editing && (
                        <>
                            <textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                rows={22}
                                className="w-full p-3 border border-blue-300 rounded-xl bg-blue-50/30 text-sm font-mono text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-500"
                                placeholder="Edit candidate summary…"
                            />
                            <div className="flex justify-between items-center mt-3">
                                <span className="text-xs text-slate-500">{draft.trim().split(/\s+/).filter(Boolean).length} words</span>
                                <div className="flex gap-2">
                                    <button onClick={() => { setEditing(false); setDraft(summary); }} className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-300">Cancel</button>
                                    <button onClick={saveEdit} disabled={saving} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* OpenAI API key (per-client). The JR-direct extension's SW
                fetches this on /extension/clientLogin and uses it for the
                auto-judge call. Plain text per ops decision. */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
                    <div>
                        <h3 className="font-bold text-slate-900 flex items-center gap-2">
                            🔑 OpenAI API key
                        </h3>
                        <div className="text-xs mt-1">
                            {savedKey ? (
                                <span className="text-emerald-700">Saved · <code className="font-mono bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">{keyMasked}</code></span>
                            ) : (
                                <span className="text-amber-700">No key on file. Auto-judge in the extension will be disabled until set.</span>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                            Used by the JR-direct extension's service worker to call <code>api.openai.com</code> for relevance judging. Model is locked to <code>gpt-4o-mini</code>. Stored plain-text on this client's profile and delivered to the extension on login.
                        </p>
                    </div>
                </div>
                <div className="p-5">
                    <div className="flex gap-2">
                        <div className="flex-1 relative">
                            <input
                                type={keyVisible ? 'text' : 'password'}
                                value={openaiKeyDraft}
                                onChange={(e) => setOpenaiKeyDraft(e.target.value)}
                                placeholder="sk-…"
                                spellCheck={false}
                                autoComplete="off"
                                className="w-full px-3 py-2 pr-20 border border-slate-300 rounded-lg bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            <button
                                type="button"
                                onClick={() => setKeyVisible((v) => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                            >
                                {keyVisible ? 'Hide' : 'Show'}
                            </button>
                        </div>
                        <button
                            onClick={saveOpenaiKey}
                            disabled={savingKey}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                            {savingKey ? 'Saving…' : (savedKey ? 'Update key' : 'Save key')}
                        </button>
                        {savedKey && (
                            <button
                                onClick={() => { setOpenaiKeyDraft(''); }}
                                disabled={savingKey}
                                className="px-3 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300 disabled:opacity-50"
                                title="Clear input — click Update key to remove the saved key."
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------------------
// Push history card with bar chart + table
// -------------------------------------------------------------------------

function PushHistoryCard({ history, loading, onReload }) {
    if (loading && !history) {
        return <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 text-slate-400 text-sm">Loading push history…</div>;
    }
    const totalOps = history?.totals?.ops || 0;
    const totalAll = history?.totals?.all || 0;
    const cap = history?.capInfo?.targetJobCount;
    const remaining = history?.capInfo?.remaining;
    const rows = history?.history || [];
    const days = history?.days || 30;
    const today = new Date();
    const denseDays = [];
    for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const found = rows.find((r) => r.date === key);
        denseDays.push({ date: key, ops: found?.ops || 0, all: found?.all || 0 });
    }
    const maxOps = denseDays.reduce((m, r) => (r.ops > m ? r.ops : m), 0) || 1;
    const recent = denseDays.slice(-7);

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">📊 Push History</h3>
                    <p className="text-xs text-slate-500 mt-1">Operator-pushed jobs · last {days} days</p>
                </div>
                <button onClick={() => onReload(days)} className="text-xs text-blue-600 hover:underline">↻ Refresh</button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
                <MiniStat label="Ops pushed" value={totalOps} color="blue" />
                <MiniStat label="All jobs" value={totalAll} color="emerald" />
                <MiniStat label="Cap left" value={cap == null ? '∞' : remaining} color="amber" />
            </div>

            {/* Bar chart — full window */}
            <div className="flex items-end gap-1 h-24 mb-4 bg-slate-50 rounded-lg p-2 border border-slate-100">
                {denseDays.map((d) => {
                    const h = (d.ops / maxOps) * 100;
                    return (
                        <div
                            key={d.date}
                            title={`${d.date}: ${d.ops} ops · ${d.all} total`}
                            className="flex-1 min-w-[4px] flex flex-col justify-end"
                        >
                            <div
                                className={`rounded-t transition-all ${d.ops > 0 ? 'bg-blue-500' : 'bg-slate-200'}`}
                                style={{ height: `${Math.max(h, 4)}%` }}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Recent days table */}
            <div className="text-xs">
                <div className="text-slate-500 mb-1">Last 7 days</div>
                <div className="grid grid-cols-7 gap-1">
                    {recent.map((d) => (
                        <div
                            key={d.date}
                            className={`p-2 rounded text-center ${d.ops > 0 ? 'bg-blue-50 border border-blue-200' : 'bg-slate-50 border border-slate-200'}`}
                        >
                            <div className="text-[10px] text-slate-500 font-mono">{d.date.slice(5)}</div>
                            <div className={`text-base font-bold ${d.ops > 0 ? 'text-blue-700' : 'text-slate-400'}`}>{d.ops}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function MiniStat({ label, value, color }) {
    const colorMap = {
        blue: 'bg-blue-50 border-blue-200 text-blue-900',
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
        amber: 'bg-amber-50 border-amber-200 text-amber-900',
    };
    return (
        <div className={`border rounded-lg p-2 text-center ${colorMap[color]}`}>
            <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
            <div className="text-xl font-bold">{value}</div>
        </div>
    );
}

// -------------------------------------------------------------------------
// Empty state + header tile
// -------------------------------------------------------------------------

function EmptyState({ rowCount }) {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
            <div className="text-6xl mb-4">👈</div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Pick a client</h2>
            <p className="text-sm text-slate-500">
                {rowCount === 0
                    ? 'No clients found. Onboard one in Register Client first.'
                    : 'Select from the list to manage their summary, target cap, and push history.'}
            </p>
        </div>
    );
}

function StatTile({ label, value, sub, accent = 'slate' }) {
    const accentMap = {
        slate: 'text-slate-900',
        emerald: 'text-emerald-700',
        amber: 'text-amber-700',
        orange: 'text-orange-700',
        blue: 'text-blue-700',
    };
    return (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{label}</div>
            <div className={`text-2xl font-bold mt-1 ${accentMap[accent]}`}>{value}</div>
            {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
        </div>
    );
}
