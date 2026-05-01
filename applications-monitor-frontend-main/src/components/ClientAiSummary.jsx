// AI Candidate Summary section — admin-only.
//
// Talks directly to the FlashFire dashboard backend (NOT this app's own
// applications_monitor_backend) because that's where ProfileModel +
// `aiSummary` field live. The dashboard backend exposes:
//   GET  /get-profile?email=
//   POST /update-ai-summary       { email, aiSummary, model?, source?, wordCount? }
//   POST /build-ai-summary        { email }   → server-side fetches resume + calls OpenAI
//
// VITE_DASHBOARD_BASE is the dashboard backend URL (e.g. http://localhost:8086
// or https://dashboard-api.flashfirejobs.com). Falls back to localhost:8086 if unset.

import React, { useEffect, useState } from 'react';

const DASHBOARD_BASE = (import.meta.env.VITE_DASHBOARD_BASE || 'http://localhost:8086').replace(/\/+$/, '');

export default function ClientAiSummary({ clientEmail }) {
    const [loading, setLoading] = useState(false);
    const [building, setBuilding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState(null);
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState(false);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const [targetDraft, setTargetDraft] = useState('');
    const [savingTarget, setSavingTarget] = useState(false);
    const [history, setHistory] = useState(null);
    const [historyLoading, setHistoryLoading] = useState(false);

    useEffect(() => {
        if (clientEmail) {
            loadProfile();
            loadHistory();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientEmail]);

    async function loadHistory(days = 30) {
        setHistoryLoading(true);
        try {
            const res = await fetch(
                `${DASHBOARD_BASE}/push-history?email=${encodeURIComponent(clientEmail.toLowerCase())}&days=${days}`,
            );
            const body = await res.json().catch(() => null);
            if (res.ok && body?.success) {
                setHistory(body);
            } else {
                setHistory(null);
            }
        } catch {
            setHistory(null);
        } finally {
            setHistoryLoading(false);
        }
    }

    function showMessage(text, kind = 'info') {
        setMessage({ text, kind });
        setError(null);
        setTimeout(() => setMessage(null), 4000);
    }
    function showError(text) {
        setError(text);
        setMessage(null);
    }

    async function loadProfile() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `${DASHBOARD_BASE}/get-profile?email=${encodeURIComponent(clientEmail.toLowerCase())}`,
            );
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                showError(`Could not load profile: ${body?.message || `HTTP ${res.status}`}`);
                setProfile(null);
                return;
            }
            const p = body?.userProfile || null;
            setProfile(p);
            setDraft(p?.aiSummary || '');
            setTargetDraft(p?.targetJobCount != null ? String(p.targetJobCount) : '');
        } catch (e) {
            showError(`Network error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }

    async function buildSummary() {
        setBuilding(true);
        setError(null);
        try {
            const res = await fetch(`${DASHBOARD_BASE}/build-ai-summary`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: clientEmail.toLowerCase() }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body?.success) {
                const step = body?.step ? ` [step: ${body.step}]` : '';
                showError(`Build failed: ${body?.error || `HTTP ${res.status}`}${step} — ${body?.message || ''}`);
                return;
            }
            showMessage(`Summary built (${body.wordCount} words, ${body.source}).`, 'ok');
            // Reload profile to get fresh aiSummary + meta.
            await loadProfile();
            setEditing(false);
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
        setError(null);
        try {
            const wordCount = text.split(/\s+/).filter(Boolean).length;
            const res = await fetch(`${DASHBOARD_BASE}/update-ai-summary`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    email: clientEmail.toLowerCase(),
                    aiSummary: text,
                    model: 'manual-edit',
                    source: 'admin-clients-tracking',
                    wordCount,
                }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || body?.success === false) {
                showError(`Save failed: ${body?.message || `HTTP ${res.status}`}`);
                return;
            }
            showMessage(`Saved (${wordCount} words).`, 'ok');
            setEditing(false);
            await loadProfile();
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
        setError(null);
        try {
            const res = await fetch(`${DASHBOARD_BASE}/update-target-jobs`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    email: clientEmail.toLowerCase(),
                    targetJobCount: n,
                }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || body?.success === false) {
                showError(`Save target failed: ${body?.message || `HTTP ${res.status}`}`);
                return;
            }
            showMessage(n === null ? 'Target removed (no cap).' : `Target set to ${n} jobs.`, 'ok');
            await loadProfile();
            await loadHistory();
        } catch (e) {
            showError(`Network error: ${e.message}`);
        } finally {
            setSavingTarget(false);
        }
    }

    function cancelEdit() {
        setDraft(profile?.aiSummary || '');
        setEditing(false);
        setError(null);
    }

    const summary = profile?.aiSummary || '';
    const meta = profile?.aiSummaryMeta || {};
    const builtAt = meta.builtAt ? new Date(meta.builtAt).toLocaleString() : null;

    return (
        <div className="space-y-6">
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-l-4 border-purple-500 p-4 rounded-r-xl">
                <h3 className="text-lg font-bold text-purple-900 mb-1">AI Candidate Summary</h3>
                <p className="text-sm text-purple-800">
                    Structured candidate brief used by the JR-Direct extension's grader.
                    Built from profile + resume via gpt-4o-mini. Edit here, sync everywhere.
                </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                {summary ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-300">
                        ✓ saved · {meta.wordCount || '?'} words {builtAt && `· ${builtAt}`}
                    </span>
                ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-300">
                        ⚠ not built yet
                    </span>
                )}
                {meta.source && (
                    <span className="text-xs text-slate-500">source: {meta.source}</span>
                )}
                {meta.model && (
                    <span className="text-xs text-slate-500">model: {meta.model}</span>
                )}
            </div>

            {message && (
                <div className={`px-4 py-3 rounded-lg ${
                    message.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-blue-50 text-blue-800 border border-blue-200'
                }`}>
                    {message.text}
                </div>
            )}
            {error && (
                <div className="px-4 py-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm font-mono">
                    {error}
                </div>
            )}

            <PushHistoryPanel history={history} loading={historyLoading} onReload={() => loadHistory(30)} />

            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h4 className="text-sm font-bold text-amber-900">Target job count cap</h4>
                    <span className="text-xs text-amber-700">
                        Currently set: <strong>{profile?.targetJobCount != null ? profile.targetJobCount : '∞ (no cap)'}</strong>
                    </span>
                </div>
                <p className="text-xs text-amber-800 mb-3 leading-relaxed">
                    The dashboard's <code>/addjob</code> endpoint refuses operator pushes once this many jobs already exist for the client. Leave empty for no cap. Affects scraper + extension pushes only — clients self-tracking are not capped.
                </p>
                <div className="flex gap-2 items-center">
                    <input
                        type="number"
                        min="0"
                        max="10000"
                        step="5"
                        value={targetDraft}
                        onChange={(e) => setTargetDraft(e.target.value)}
                        placeholder="(no cap)"
                        className="px-3 py-2 border border-amber-300 rounded-lg bg-white text-sm w-32 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button
                        onClick={saveTarget}
                        disabled={savingTarget}
                        className="px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
                    >
                        {savingTarget ? 'Saving…' : 'Save target'}
                    </button>
                </div>
            </div>

            {loading && !profile && <div className="text-slate-500">Loading…</div>}

            {!editing ? (
                <>
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                        {summary ? (
                            <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed">{summary}</pre>
                        ) : (
                            <div className="text-slate-500 italic">No summary yet. Click <strong>Build summary</strong> to generate one from the candidate's profile + resume.</div>
                        )}
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <button
                            onClick={buildSummary}
                            disabled={building}
                            className="inline-flex items-center px-4 py-2 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {building ? 'Building (~15s)…' : (summary ? '↻ Rebuild from profile + resume' : '✨ Build summary')}
                        </button>
                        {summary && (
                            <button
                                onClick={() => { setDraft(summary); setEditing(true); }}
                                className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
                            >
                                ✎ Edit
                            </button>
                        )}
                        <button
                            onClick={loadProfile}
                            disabled={loading}
                            className="inline-flex items-center px-4 py-2 rounded-lg bg-slate-200 text-slate-700 font-medium hover:bg-slate-300 transition-colors"
                        >
                            ↻ Reload
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={20}
                        className="w-full p-4 border border-blue-300 rounded-xl bg-blue-50/30 text-sm font-mono text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-500"
                        placeholder="Edit candidate summary…"
                    />
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">
                            {draft.trim().split(/\s+/).filter(Boolean).length} words
                        </span>
                        <div className="flex gap-3">
                            <button
                                onClick={cancelEdit}
                                className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700 font-medium hover:bg-slate-300 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveEdit}
                                disabled={saving}
                                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                                {saving ? 'Saving…' : 'Save changes'}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// PushHistoryPanel: per-day count of operator-pushed jobs over last 30 days.
// Visualises both a tally + tiny bar chart so admin can see push pattern at a
// glance + spot dead days. Cap progress shown alongside.
function PushHistoryPanel({ history, loading, onReload }) {
    if (loading && !history) {
        return <div className="text-slate-500 text-sm">Loading push history…</div>;
    }
    if (!history) {
        return (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-700">Push History</h4>
                    <button onClick={onReload} className="text-xs text-blue-600 hover:underline">↻ Retry</button>
                </div>
                <p className="text-xs text-slate-500 mt-2">Could not load push history.</p>
            </div>
        );
    }
    const rows = history.history || [];
    const totalOps = history.totals?.ops || 0;
    const totalAll = history.totals?.all || 0;
    const cap = history.capInfo?.targetJobCount;
    const remaining = history.capInfo?.remaining;
    const maxOps = rows.reduce((m, r) => (r.ops > m ? r.ops : m), 0) || 1;

    // Build a dense day-by-day list for the last N days even if no jobs were
    // pushed that day (so the table reads "0" instead of skipping the date).
    const today = new Date();
    const denseDays = [];
    for (let i = (history.days || 30) - 1; i >= 0; i -= 1) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const found = rows.find((r) => r.date === key);
        denseDays.push({ date: key, ops: found?.ops || 0, all: found?.all || 0 });
    }
    const recent = denseDays.slice(-14); // table shows last 14, bar chart full 30

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-700">
                    Push History <span className="text-xs text-slate-500 font-normal">— last {history.days || 30} days, ops only</span>
                </h4>
                <button onClick={onReload} className="text-xs text-blue-600 hover:underline">↻ Refresh</button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                    <div className="text-xs text-blue-700 uppercase tracking-wide">Total ops-pushed</div>
                    <div className="text-2xl font-bold text-blue-900">{totalOps}</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                    <div className="text-xs text-emerald-700 uppercase tracking-wide">All jobs</div>
                    <div className="text-2xl font-bold text-emerald-900">{totalAll}</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <div className="text-xs text-amber-700 uppercase tracking-wide">Cap remaining</div>
                    <div className="text-2xl font-bold text-amber-900">
                        {cap == null ? '∞' : remaining != null ? remaining : `${totalOps}/${cap}`}
                    </div>
                </div>
            </div>

            <div className="flex items-end gap-1 h-20 mb-3 overflow-x-auto">
                {denseDays.map((d) => {
                    const h = (d.ops / maxOps) * 100;
                    return (
                        <div
                            key={d.date}
                            title={`${d.date}: ${d.ops} ops · ${d.all} total`}
                            className="flex-1 min-w-[8px] flex flex-col justify-end"
                        >
                            <div
                                className={`rounded-t ${d.ops > 0 ? 'bg-blue-500' : 'bg-slate-200'}`}
                                style={{ height: `${Math.max(h, 4)}%` }}
                            />
                        </div>
                    );
                })}
            </div>

            <table className="w-full text-xs">
                <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                        <th className="text-left py-1 px-2">Date</th>
                        <th className="text-right py-1 px-2">Ops pushes</th>
                        <th className="text-right py-1 px-2">All adds</th>
                    </tr>
                </thead>
                <tbody>
                    {recent.slice().reverse().map((d) => (
                        <tr key={d.date} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-1 px-2 font-mono text-slate-700">{d.date}</td>
                            <td className={`py-1 px-2 text-right font-medium ${d.ops > 0 ? 'text-blue-700' : 'text-slate-400'}`}>{d.ops}</td>
                            <td className="py-1 px-2 text-right text-slate-600">{d.all}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
