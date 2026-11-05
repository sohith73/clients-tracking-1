// Connect or replace a client's Gmail app password from Client Job Analysis.
//
// One app password lets Flashfire read the client's inbox (IMAP), which is
// what produces the interview / assignment / offer alerts, and send recruiter
// mail as them (SMTP). It takes precedence over the Google OAuth connection.
//
// The portal backend relays to the dashboard backend, which checks the
// password with Gmail before saving and stores it encrypted. This popup only
// ever learns WHETHER one is connected; the password is never sent back.
// Same store as the dashboard Profile popup, so either place can set it.

import React, { useEffect, useId, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

const maskStyle =
  typeof CSS !== 'undefined' && CSS.supports?.('-webkit-text-security', 'disc')
    ? { WebkitTextSecurity: 'disc' }
    : null;

export default function ClientAppPasswordModal({ apiBase, authHeaders, client, onClose, onSaved }) {
  const [status, setStatus] = useState(null); // null while loading
  const [loadError, setLoadError] = useState('');
  const [gmailEmail, setGmailEmail] = useState(client.email || '');
  const [appPassword, setAppPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const passwordRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/clients/${encodeURIComponent(client.email)}/app-password`, {
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data?.message || data?.error || 'Could not load the current status.');
          setStatus({ connected: false });
          return;
        }
        setStatus(data);
        if (data.gmailEmail) setGmailEmail(data.gmailEmail);
      } catch {
        if (!cancelled) {
          setLoadError('Could not load the current status.');
          setStatus({ connected: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, authHeaders, client.email]);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  useEffect(() => {
    if (error && !saving) passwordRef.current?.focus();
  }, [error, saving]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const letters = appPassword.replace(/\s+/g, '');
  const canSubmit = !saving && /\S+@\S+\.\S+/.test(gmailEmail.trim()) && letters.length === 16;
  const replacing = !!status?.connected;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/clients/${encodeURIComponent(client.email)}/app-password`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ gmailEmail: gmailEmail.trim(), appPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || data?.error || 'Could not save the app password. Try again.');
        return;
      }
      setAppPassword('');
      onSaved(data);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-gray-900">
              {replacing ? 'Replace Gmail app password' : 'Connect Gmail app password'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {client.name ? `${client.name} · ` : ''}
              {client.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-sm">
            {status === null ? (
              <span className="inline-flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking current status...
              </span>
            ) : status.connected && status.needsReplacing ? (
              <span className="inline-flex items-start gap-2 text-red-700">
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                Gmail refused the saved app password ({status.gmailEmail}). Paste a new one.
              </span>
            ) : status.connected ? (
              <span className="inline-flex items-start gap-2 text-emerald-700 break-all">
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
                Connected: {status.gmailEmail}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-gray-600">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-400" aria-hidden="true" />
                No app password yet.
              </span>
            )}
            {loadError && <p className="mt-1 text-xs text-amber-700">{loadError}</p>}
          </div>

          <ol className="list-decimal space-y-1 rounded-lg bg-orange-50 py-3 pl-8 pr-4 text-sm text-gray-700">
            <li>Sign in to the client's Google account and turn on 2-Step Verification.</li>
            <li>
              Open{' '}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-orange-700 underline"
              >
                myaccount.google.com/apppasswords
              </a>{' '}
              and create one named "Flashfire".
            </li>
            <li>Paste the 16 letters below.</li>
          </ol>

          <form onSubmit={submit} className="space-y-4" autoComplete="off">
            <div>
              <label htmlFor="ct-app-pw-gmail" className="block text-sm font-semibold text-gray-700 mb-1.5">
                Gmail address
              </label>
              <input
                id="ct-app-pw-gmail"
                type="email"
                autoComplete="off"
                value={gmailEmail}
                onChange={(e) => setGmailEmail(e.target.value)}
                disabled={saving}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-gray-900 text-sm disabled:bg-gray-50"
                placeholder="client@gmail.com"
              />
            </div>
            <div>
              <label htmlFor="ct-app-pw-secret" className="block text-sm font-semibold text-gray-700 mb-1.5">
                App password
              </label>
              <input
                id="ct-app-pw-secret"
                ref={passwordRef}
                type={maskStyle ? 'text' : 'password'}
                style={maskStyle || undefined}
                autoComplete="off"
                spellCheck={false}
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                disabled={saving}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-gray-900 text-sm tracking-wider disabled:bg-gray-50"
                placeholder="abcd efgh ijkl mnop"
              />
              <p className="mt-1.5 text-xs text-gray-500">
                {letters.length}/16 letters. It is checked with Gmail, saved encrypted, and never shown again.
              </p>
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-1 inline-flex items-center justify-center gap-2 whitespace-nowrap px-4 py-2.5 bg-orange-500 hover:bg-orange-600 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking...
                  </>
                ) : (
                  replacing ? 'Check and replace' : 'Check and save'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
