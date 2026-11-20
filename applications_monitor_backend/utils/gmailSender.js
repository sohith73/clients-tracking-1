import { google } from "googleapis";
import { GmailUser } from "../schema_models/GmailUser.js";
import { ClientEmailLogModel } from "../ClientEmailLogModel.js";
import { isGmailAuthError, notifyGmailAuthError } from "./discordMilestoneNotify.js";
import { isSmtpConfigured, sendViaSmtp, smtpFromEmail } from "./smtpSender.js";

function encodeRfc2047Header(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const utf8 = Buffer.from(value, "utf8");
  const max = 57;
  const parts = [];
  for (let i = 0; i < utf8.length; i += max) {
    parts.push(`=?UTF-8?B?${utf8.subarray(i, i + max).toString("base64")}?=`);
  }
  return parts.join("\r\n ");
}

function encodeFilename(filename) {
  if (/[^\x00-\x7F]/.test(filename)) {
    return `=?UTF-8?B?${Buffer.from(filename).toString("base64")}?=`;
  }
  if (/[()<>@,;:\\"\/\[\]?=]/.test(filename)) {
    return `"${filename.replace(/"/g, '\\"')}"`;
  }
  return filename;
}

function buildMime({ from, to, subject, html, text, attachment, headers }) {
  const boundary = `----=_FF_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const altBoundary = `----=_FFalt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const encSubject = encodeRfc2047Header(subject);
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${encSubject}`,
    `MIME-Version: 1.0`
  ];

  // Extra headers (List-Unsubscribe and friends) go before Content-Type, which
  // must stay last because the body is appended straight after it. CR/LF is
  // stripped from both halves: a newline in a header value would let a crafted
  // value inject headers of its own, or terminate the header block early.
  for (const [name, value] of Object.entries(headers || {})) {
    const n = String(name).replace(/[\r\n:]/g, "").trim();
    const v = String(value).replace(/[\r\n]/g, " ").trim();
    if (n && v) lines.push(`${n}: ${v}`);
  }

  const altPart = (() => {
    const inner = [];
    inner.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    inner.push("");
    if (text) {
      inner.push(`--${altBoundary}`);
      inner.push("Content-Type: text/plain; charset=UTF-8");
      inner.push("Content-Transfer-Encoding: 7bit");
      inner.push("");
      inner.push(text);
      inner.push("");
    }
    if (html) {
      inner.push(`--${altBoundary}`);
      inner.push("Content-Type: text/html; charset=UTF-8");
      inner.push("Content-Transfer-Encoding: 7bit");
      inner.push("");
      inner.push(html);
      inner.push("");
    }
    inner.push(`--${altBoundary}--`);
    return inner.join("\r\n");
  })();

  if (attachment) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push(altPart);
    lines.push(`--${boundary}`);
    const fname = encodeFilename(attachment.filename);
    lines.push(`Content-Type: ${attachment.mimetype}; name=${fname}`);
    lines.push(`Content-Disposition: attachment; filename=${fname}`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    const b64 = attachment.content.toString("base64");
    for (let i = 0; i < b64.length; i += 76) lines.push(b64.substr(i, 76));
    lines.push("");
    lines.push(`--${boundary}--`);
  } else {
    lines.push(altPart);
  }
  return lines.join("\r\n");
}

// Single global sender — only one GmailUser doc exists at any time (replaced on each connect).
export async function getActiveGmailSender() {
  return GmailUser.findOne({}).sort({ updatedAt: -1, createdAt: -1 });
}

async function sendViaGmailRaw(user, { to, subject, html, text, attachment, headers }) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth.setCredentials({ refresh_token: user.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const mime = buildMime({ from: user.email, to, subject, html, text, attachment, headers });
  const raw = Buffer.from(mime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

/**
 * High-level send + log helper. All system emails should go through this.
 *
 * @param {Object} args
 * @param {string} args.to                 - Recipient email
 * @param {string} args.subject
 * @param {string} [args.html]
 * @param {string} [args.text]
 * @param {Object} [args.attachment]       - { filename, mimetype, content (Buffer) }
 * @param {string} args.category           - milestone | otp | tag | manual | other
 * @param {string} args.type               - sub-type (e.g. 'started', 'otp_login', 'onboarding_tag')
 * @param {string} [args.clientEmail]      - canonical client/user identifier (defaults to `to`)
 * @param {Object} [args.snapshot]         - milestone snapshot fields
 * @param {Object} [args.meta]             - arbitrary structured data persisted on log
 * @returns {Promise<{success:boolean, error?:string, skipped?:boolean, reason?:string}>}
 */
export async function sendGmailEmail({
  to,
  subject,
  html,
  text,
  attachment = null,
  headers = null,
  category = "other",
  type,
  clientEmail,
  snapshot,
  meta = {}
}) {
  const recipient = (to || "").trim();
  if (!recipient) {
    return { skipped: true, reason: "no_recipient" };
  }
  if (!type) {
    return { skipped: true, reason: "no_type" };
  }

  // Prefer SMTP (Gmail App Password) when configured — it uses a static
  // username + app password, so it never hits invalid_grant / token revocation.
  // Falls back to the Gmail OAuth API when SMTP env is not set.
  const useSmtp = isSmtpConfigured();
  const sender = useSmtp ? null : await getActiveGmailSender();
  const fromEmail = useSmtp ? smtpFromEmail() : (sender ? sender.email : "");

  const logBase = {
    clientEmail: (clientEmail || recipient).toLowerCase(),
    toEmail: recipient.toLowerCase(),
    paymentEmail: category === "milestone" ? recipient.toLowerCase() : "",
    category,
    type,
    subject,
    provider: useSmtp ? "smtp" : "gmail",
    fromEmail,
    snapshot: snapshot || undefined,
    meta
  };

  if (!useSmtp && !sender) {
    console.warn(`[GmailSender] no SMTP env and no connected Gmail sender — skip ${type} to ${recipient}`);
    await ClientEmailLogModel.create({ ...logBase, status: "failed", errorMessage: "no_sender_configured" });
    return { skipped: true, reason: "no_sender_configured" };
  }

  try {
    let provider = logBase.provider;
    let sentFrom = fromEmail;
    if (useSmtp) {
      // Falls back to SendGrid when Gmail refuses the send (utils/mailFallback.js).
      const sent = await sendViaSmtp({ to: recipient, subject, html, text, attachment, headers });
      provider = sent?.channel || "smtp";
      if (sent?.from) sentFrom = sent.from;
      // The mail went out, but Gmail's login is broken: still raise the alarm,
      // or nobody fixes the app password while SendGrid quietly carries it.
      if (sent?.smtpError && isGmailAuthError(sent.smtpError)) {
        notifyGmailAuthError({ error: sent.smtpError, senderEmail: fromEmail, recipient, category, type })
          .catch((e) => console.error('[GmailSender] auth alert failed:', e?.message || e));
      }
    } else {
      await sendViaGmailRaw(sender, { to: recipient, subject, html, text, attachment, headers });
    }
    await ClientEmailLogModel.create({ ...logBase, provider, fromEmail: sentFrom, status: "success" });
    console.log(`[GmailSender] sent ${category}/${type} to ${recipient} from ${sentFrom} via ${provider === "gmail" ? "oauth" : provider}`);
    return { success: true };
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.message || "send_failed";
    console.error(`[GmailSender] ${category}/${type} failed to ${recipient} via ${useSmtp ? "smtp" : "oauth"}: ${msg}`);
    await ClientEmailLogModel.create({ ...logBase, status: "failed", errorMessage: msg });
    // Auth failures (invalid_grant / token revoked for OAuth; bad app password
    // for SMTP) mean nothing will send until credentials are fixed — fire a
    // loud, throttled Discord alert.
    if (isGmailAuthError(msg)) {
      notifyGmailAuthError({ error: msg, senderEmail: fromEmail, recipient, category, type })
        .catch((e) => console.error('[GmailSender] auth alert failed:', e?.message || e));
    }
    return { success: false, error: msg };
  }
}

// Exported for the header-injection test in utils/unsubscribe.test.mjs. Not
// part of the sending API - build a message through sendGmailEmail().
export const __testables = { buildMime };
