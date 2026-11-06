// The autopilot login saved for one client, rendered the same way wherever it
// appears (Client Job Analysis rows, AI Summaries client pane).
//
// Why this exists: flipping "JobRight: Yes" also provisions these credentials,
// but the only sign of it was a toast. A manager coming back the next day had
// no way to tell whether the account details landed, which is exactly the
// question that was asked when a day's toggles looked like they had not taken.
//
// Passwords are shown in full - the people who can reach this are the same
// admins and team leads who set the toggle - but start hidden so a shared
// screen or a screenshot does not publish them by accident. One click reveals,
// one click copies.
//
// Data comes from GET /api/clients/:email/jobright-creds on the portal backend,
// which proxies the ops-key-gated dashboard route server-side. Nothing here
// holds a key.

import React, { useState } from 'react';
import toast from 'react-hot-toast';

function Field({ label, value, secret = false }) {
    const [shown, setShown] = useState(false);
    if (!value) {
        return (
            <div className="flex items-baseline gap-2 py-0.5">
                <span className="text-[10px] uppercase tracking-wide text-slate-400 w-20 shrink-0">{label}</span>
                <span className="text-[11px] text-slate-400 italic">not set</span>
            </div>
        );
    }
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
        } catch {
            // Clipboard needs a secure context and permission; revealing the
            // value is the fallback so it can still be read off the screen.
            setShown(true);
            toast.error('Copy blocked by the browser - showing it instead');
        }
    };
    return (
        <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-[10px] uppercase tracking-wide text-slate-400 w-20 shrink-0">{label}</span>
            <span className="text-[11px] font-mono text-slate-800 break-all flex-1">
                {secret && !shown ? '••••••••••' : value}
            </span>
            {secret && (
                <button
                    type="button"
                    onClick={() => setShown((v) => !v)}
                    className="text-[10px] text-indigo-600 hover:text-indigo-800 shrink-0"
                >
                    {shown ? 'hide' : 'show'}
                </button>
            )}
            <button
                type="button"
                onClick={copy}
                className="text-[10px] text-slate-500 hover:text-slate-800 shrink-0"
            >
                copy
            </button>
        </div>
    );
}

export default function JobrightCredsBody({ data }) {
    if (!data) return null;
    const { onFile, creds, reason, jobrightCreated } = data;

    if (!onFile || !creds) {
        return (
            <div className="text-[11px]">
                <div className="font-semibold text-red-700 mb-0.5">No autopilot credentials on file</div>
                <div className="text-slate-600">
                    {reason || 'Nothing saved for this client yet.'}
                </div>
                {jobrightCreated && (
                    // The flag and the credentials disagree, which is the exact
                    // state that makes a client look ready and never scrape.
                    <div className="mt-1 text-slate-500">
                        JobRight is marked as created, so this one needs saving: use
                        Fill team defaults or Edit.
                    </div>
                )}
            </div>
        );
    }

    const missing = [!creds.jrReady && 'JobRight', !creds.panelReady && 'panel'].filter(Boolean);
    return (
        <div>
            <div className={`text-[11px] font-semibold mb-1 ${creds.autoLoginReady ? 'text-emerald-700' : 'text-amber-700'}`}>
                {creds.autoLoginReady
                    ? 'Autopilot can log in unattended'
                    : `Incomplete - the autopilot will stop at the ${missing.join(' and ')} login`}
            </div>
            <Field label="JR email" value={creds.jrEmail} />
            <Field label="JR pass" value={creds.jrPassword} secret />
            {/* The dashboard-panel login is a different account. The
                operator code is never sent to the browser (it is the same
                code for everyone and this panel gets screenshotted); only
                whether one is saved. */}
            <div className="mt-1 pt-1 border-t border-slate-200">
                <Field label="Panel email" value={creds.extEmail} />
                <Field label="Panel pass" value={creds.extPassword} secret />
                <div className="flex items-baseline gap-2 py-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400 w-20 shrink-0">Op code</span>
                    <span className={`text-[11px] ${creds.hasExtCode ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                        {creds.hasExtCode ? 'saved' : 'not set'}
                    </span>
                </div>
            </div>
            {creds.hcSearch && (
                <div className="mt-1 pt-1 border-t border-slate-200">
                    <Field label="HC search" value={creds.hcSearch} />
                </div>
            )}
        </div>
    );
}
