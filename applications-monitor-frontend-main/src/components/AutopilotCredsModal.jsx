// View and save the autopilot logins for one client (JobRight + the
// extension panel), from Client Job Analysis or AI Summaries.
//
// The autopilot logs into JobRight first and then into the FlashFire panel
// inside the extension. A client missing either half stops at that step
// ("JobRight login needed" / "Panel login needed"), so this shows both halves
// and lets a manager fix them here instead of on the desktop app.
//
// Blank fields are left unchanged on save, so a password never has to be
// retyped. "Fill team defaults" asks the server to fill every still-blank
// field with the standard values (client email, standard passwords, the
// extension's master operator code); it never overwrites a saved value.
//
// The portal backend relays to the dashboard backend's ops-gated credential
// store. The operator code is never sent to the browser, only whether one is
// saved.

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X, Loader2, Eye, EyeOff } from 'lucide-react';
import JobrightCredsBody from './JobrightCredsBody.jsx';

const EMPTY = { jrEmail: '', jrPassword: '', extEmail: '', extPassword: '', extCode: '' };

// Team-standard values, pre-filled into blank fields so Save just works.
// They match the server defaults (applications_monitor_backend/index.js) and
// what the autopilot falls back to when nothing is saved.
const DEFAULT_JR_PASSWORD = 'Jobhunt@2026';
const DEFAULT_PANEL_PASSWORD = 'flashfire@123';
const DEFAULT_PANEL_CODE = '00000';

function TextField({ id, label, value, onChange, disabled, secret = false, placeholder = '', hint = '', inputMode }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={secret && !shown ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-gray-900 text-sm disabled:bg-gray-50 ${secret ? 'pr-10' : ''}`}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
            className="absolute inset-y-0 right-0 px-3 text-gray-400 hover:text-gray-700"
          >
            {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

export default function AutopilotCredsModal({ apiBase, authHeaders, client, onClose, onSaved }) {
  const [data, setData] = useState(null);       // GET/PUT response
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const titleId = useId();
  const firstFieldRef = useRef(null);
  const url = `${apiBase}/api/clients/${encodeURIComponent(client.email)}/jobright-creds`;

  // Prefill with what is saved, and the team defaults for anything blank. The
  // operator code is never sent by the server, so it is left blank (= keep)
  // when one is saved, and defaulted when none is.
  const prefill = useCallback((d) => {
    const c = d?.creds || {};
    setForm({
      jrEmail: c.jrEmail || client.email,
      jrPassword: c.jrPassword || DEFAULT_JR_PASSWORD,
      extEmail: c.extEmail || client.email,
      extPassword: c.extPassword || DEFAULT_PANEL_PASSWORD,
      extCode: c.hasExtCode ? '' : DEFAULT_PANEL_CODE,
    });
  }, [client.email]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { headers: authHeaders() });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(body.error || `Could not load credentials (HTTP ${res.status}).`);
          return;
        }
        setData(body);
        prefill(body);
      } catch {
        if (!cancelled) setLoadError('Network error while loading credentials.');
      }
    })();
    return () => { cancelled = true; };
  }, [url, authHeaders, prefill]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  useEffect(() => {
    if (editing) firstFieldRef.current?.querySelector('input')?.focus();
  }, [editing]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const codeOk = !form.extCode.trim() || /^\d{5}$/.test(form.extCode.trim());

  const save = async ({ useDefaults = false } = {}) => {
    if (saving) return;
    if (!codeOk) { setError('Operator code must be exactly 5 digits.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = useDefaults ? { useDefaults: true } : { ...form };
      const res = await fetch(url, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Could not save (HTTP ${res.status}).`);
        return;
      }
      setData(body);
      prefill(body);
      setEditing(false);
      onSaved?.(body);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const creds = data?.creds;
  const missingSomething = data && (!data.onFile || !creds?.autoLoginReady);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-gray-900">Autopilot logins</h2>
            {client.name && <p className="text-sm text-gray-700 mt-0.5">{client.name}</p>}
            <p className="text-xs text-gray-500 break-all">{client.email}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {!data && !loadError && (
            <span className="inline-flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading...
            </span>
          )}
          {loadError && <p className="text-sm text-red-700">{loadError}</p>}

          {data && !editing && (
            <>
              <div className="rounded-lg border border-gray-200 p-3">
                <JobrightCredsBody data={data} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing(true)} disabled={saving}
                  className="px-3 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                  Edit
                </button>
                {missingSomething && (
                  <button type="button" onClick={() => save({ useDefaults: true })} disabled={saving}
                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    Fill team defaults
                  </button>
                )}
              </div>
              {missingSomething && (
                <p className="text-[11px] text-gray-500">
                  Defaults: the client's email for both logins, the standard JobRight and panel passwords,
                  and the master operator code. Only blank fields are filled.
                </p>
              )}
            </>
          )}

          {data && editing && (
            <form className="space-y-3" autoComplete="off"
              onSubmit={(e) => { e.preventDefault(); save(); }}>
              <fieldset className="space-y-3" disabled={saving}>
                <legend className="text-xs font-bold uppercase tracking-wide text-gray-500">JobRight</legend>
                <div ref={firstFieldRef}>
                  <TextField id="ap-jr-email" label="JobRight email" value={form.jrEmail} onChange={set('jrEmail')}
                    placeholder={client.email} />
                </div>
                <TextField id="ap-jr-pass" label="JobRight password" value={form.jrPassword} onChange={set('jrPassword')}
                  secret placeholder="Standard password" />
              </fieldset>
              <fieldset className="space-y-3 pt-2 border-t border-gray-100" disabled={saving}>
                <legend className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2">FlashFire panel (extension)</legend>
                <TextField id="ap-ext-email" label="Panel email" value={form.extEmail} onChange={set('extEmail')}
                  placeholder={client.email} />
                <TextField id="ap-ext-pass" label="Panel password" value={form.extPassword} onChange={set('extPassword')}
                  secret placeholder="Standard panel password" />
                <TextField id="ap-ext-code" label="Operator code" value={form.extCode} onChange={set('extCode')}
                  inputMode="numeric" placeholder={creds?.hasExtCode ? 'Saved (hidden). Leave blank to keep' : '5 digits'}
                  hint={!codeOk ? 'Must be exactly 5 digits.' : 'Blank fields keep their saved value.'} />
              </fieldset>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <div className="sticky -bottom-6 -mx-6 -mb-6 px-6 py-3 bg-white border-t border-gray-100 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => { prefill(data); setEditing(false); setError(''); }} disabled={saving}
                  className="px-3 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving || !codeOk}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Save
                </button>
              </div>
            </form>
          )}

          {error && !editing && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}
