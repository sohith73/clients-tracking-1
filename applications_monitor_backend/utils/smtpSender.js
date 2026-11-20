// SMTP sender using a Gmail App Password (or any SMTP provider).
//
// This is the preferred path because it uses a static username + app password
// instead of OAuth refresh tokens — so it never hits `invalid_grant` / token
// revocation. If the SMTP_* env vars are set, sendGmailEmail() uses this;
// otherwise it falls back to the Gmail OAuth API path.
//
// Required env to enable:
//   SMTP_USER  = the full Gmail address (e.g. support@flashfirejobs.com)
//   SMTP_PASS  = the 16-char Google App Password (NOT the normal password)
// Optional:
//   SMTP_HOST  = smtp.gmail.com   (default)
//   SMTP_PORT  = 465              (default; 587 also works)
//   SMTP_SECURE= true             (default true for 465; set false for 587)
//   SMTP_FROM_EMAIL = address shown in the From header (default SMTP_USER)
//   SMTP_FROM_NAME  = display name in the From header (e.g. "FlashFire Team")

import nodemailer from "nodemailer";
import { isMailFallbackEnabled, isSmtpAuthError, sendViaSendgridFallback } from "./mailFallback.js";

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function smtpFromEmail() {
  return process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "";
}

// Singleton transporter — created once, reused for every send.
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const port = Number(process.env.SMTP_PORT) || 465;
  // Default to implicit TLS on 465; STARTTLS on anything else (e.g. 587).
  const secure = process.env.SMTP_SECURE != null
    ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
    : port === 465;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

/**
 * Send one email over SMTP.
 * @param {Object} a
 * @param {string} a.to
 * @param {string} a.subject
 * @param {string} [a.html]
 * @param {string} [a.text]
 * @param {Object} [a.attachment] - { filename, mimetype, content (Buffer) }
 * @param {Object} [a.headers]    - extra headers, e.g. List-Unsubscribe
 * @returns {Promise<{ messageId: string }>}
 */
// After Gmail refuses the login, sends go straight to SendGrid for this long,
// then SMTP is tried again so a fixed app password is picked up on its own.
const SMTP_AUTH_COOLDOWN_MS = 15 * 60 * 1000;
let smtpAuthDeadUntil = 0;

export function __setTransporter(t) {
  _transporter = t;
}
export function __resetSmtpAuthState() {
  smtpAuthDeadUntil = 0;
}

/**
 * Send one email: Gmail SMTP first, SendGrid when Gmail fails (utils/mailFallback.js).
 * Throws when every road failed, as before, so callers log the failure.
 * @returns {Promise<{ messageId: string, channel: "smtp" | "sendgrid", smtpError?: string }>}
 */
export async function sendViaSmtp(args) {
  let smtpError = "";
  if (!isSmtpConfigured()) smtpError = "smtp_not_configured";
  else if (smtpAuthDeadUntil > Date.now() && isMailFallbackEnabled()) smtpError = "smtp_login_recently_refused";
  else {
    try {
      const out = await sendViaGmailSmtp(args);
      return { ...out, channel: "smtp" };
    } catch (err) {
      smtpError = String(err?.message || err).slice(0, 400);
      if (isSmtpAuthError(smtpError)) smtpAuthDeadUntil = Date.now() + SMTP_AUTH_COOLDOWN_MS;
      if (!isMailFallbackEnabled()) throw err;
      console.warn(`[smtpSender] SMTP failed (${smtpError.slice(0, 120)}), sending "${String(args?.subject || "").slice(0, 60)}" through SendGrid`);
    }
  }
  if (!isMailFallbackEnabled()) throw new Error(smtpError);
  const res = await sendViaSendgridFallback(args);
  if (!res.ok) throw new Error(`smtp: ${smtpError.slice(0, 200)} | ${res.error}`);
  return { messageId: res.messageId, channel: "sendgrid", smtpError };
}

async function sendViaGmailSmtp({ to, subject, html, text, attachment, headers }) {
  const fromEmail = smtpFromEmail();
  const fromName = process.env.SMTP_FROM_NAME || "";
  const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;

  const mail = { from, to, subject, html, text };
  // Spread as a plain object so nodemailer writes each one verbatim. This is
  // how List-Unsubscribe / List-Unsubscribe-Post reach the provider, which is
  // what turns Gmail's own "Unsubscribe" button on.
  if (headers && typeof headers === "object" && Object.keys(headers).length) mail.headers = { ...headers };
  if (attachment) {
    mail.attachments = [{
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.mimetype,
    }];
  }
  const info = await getTransporter().sendMail(mail);
  return { messageId: info?.messageId };
}
