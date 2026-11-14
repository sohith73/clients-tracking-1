import { sendGmailEmail } from "./gmailSender.js";
import { getPlanLabel } from "./planCaps.js";
import { unsubscribeLink, unsubscribeHeaders, UNSUB_STREAMS } from "./unsubscribe.js";

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@flashfirejobs.com";
const WEBSITE_URL   = process.env.WEBSITE_URL   || "https://www.flashfirejobs.com";
const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://portal.flashfirejobs.com/";

function shell({ kicker, title, bodyHtml, unsubUrl }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">

    <!-- Brand bar -->
    <div style="text-align:center;padding:8px 0 16px;">
      <span style="display:inline-block;font-size:22px;font-weight:800;letter-spacing:0.5px;color:#ea580c;">FLASHFIRE</span>
    </div>

    <!-- Header card -->
    <div style="background:#1f2937;border-radius:12px 12px 0 0;padding:22px 26px;">
      <div style="color:#fbbf24;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">${kicker}</div>
      <div style="color:#fff;font-size:22px;font-weight:700;margin-top:6px;line-height:1.3;">${title}</div>
    </div>

    <!-- Body card -->
    <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
      ${bodyHtml}

      <!-- Inline CTA divider -->
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #f3f4f6;text-align:center;">
        <a href="${DASHBOARD_URL}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px;font-size:13px;">Open your dashboard →</a>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">Need help? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#ea580c;text-decoration:none;">${SUPPORT_EMAIL}</a>.</div>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-top:14px;padding:18px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:top;font-size:12px;color:#6b7280;line-height:1.6;">
            <div style="font-weight:700;color:#1f2937;font-size:13px;margin-bottom:4px;">FlashFire</div>
            Application-tracking & job-search concierge<br>
            <a href="${WEBSITE_URL}" style="color:#ea580c;text-decoration:none;">${WEBSITE_URL.replace(/^https?:\/\//, "")}</a>
          </td>
          <td style="vertical-align:top;text-align:right;font-size:12px;color:#6b7280;line-height:1.6;">
            <a href="mailto:${SUPPORT_EMAIL}" style="color:#374151;text-decoration:none;">${SUPPORT_EMAIL}</a><br>
            <a href="${DASHBOARD_URL}" style="color:#374151;text-decoration:none;">Client portal</a>
          </td>
        </tr>
      </table>
    </div>

    <!-- Legal -->
    <div style="text-align:center;padding:14px 8px 4px;font-size:11px;color:#9ca3af;line-height:1.6;">
      © ${year} FlashFire. All rights reserved.<br>
      You're getting this because your FlashFire plan is active.${
        unsubUrl
          ? `<br><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from these updates</a>`
          : ""
      }
    </div>
  </div>
</body>
</html>`;
}

function progressBlock({ planLabel, currentCount, planCap }) {
  const safePct = planCap ? Math.max(0, Math.min(100, (currentCount / planCap) * 100)) : 0;
  return `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:10px;">
        <tr>
          <td align="left" style="font-size:13px;color:#7c2d12;font-weight:600;">${planLabel} plan</td>
          <td align="right" style="font-size:13px;color:#7c2d12;font-weight:600;">${currentCount} / ${planCap}</td>
        </tr>
      </table>
      <div style="background:#ffedd5;height:8px;border-radius:999px;overflow:hidden;">
        <div style="background:#ea580c;height:8px;width:${safePct}%;border-radius:999px;"></div>
      </div>
      <div style="text-align:right;color:#ea580c;font-size:12px;font-weight:700;margin-top:6px;">${safePct.toFixed(0)}% complete</div>
    </div>`;
}

// Build the email per type.
function buildEmail(type, ctx) {
  const { name, planLabel, planCap, currentCount, threshold, unsubUrl } = ctx;

  if (type === 'started') {
    return {
      subject: "Your resume is ready and applications are going out",
      html: shell({
        unsubUrl,
        kicker: "FLASHFIRE PORTAL",
        title: "Resume done. Applications going out.",
        bodyHtml: `
          <p style="margin:0 0 16px;color:#374151;font-size:16px;">Hi ${name},</p>
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Good news. Your new resume is ready, and we've started sending applications today. Your <strong>${planLabel}</strong> plan covers <strong>${planCap}</strong> roles, and we'll keep you posted as we go.</p>
          <p style="margin:0;color:#6b7280;font-size:13px;">If a few specific companies or titles are top of mind, just reply and we'll prioritize them.</p>`
      })
    };
  }

  if (type === 'count_milestone') {
    return {
      subject: `${threshold} applications in. Quick update.`,
      html: shell({
        unsubUrl,
        kicker: "FLASHFIRE PORTAL",
        title: `${threshold} applications submitted`,
        bodyHtml: `
          <p style="margin:0 0 12px;color:#374151;font-size:16px;">Hi ${name},</p>
          <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Wanted to give you a heads up. We've crossed <strong>${threshold} applications</strong> on your <strong>${planLabel}</strong> plan. Replies usually start showing up around this stage, so keep an eye on your inbox and LinkedIn.</p>
          ${progressBlock({ planLabel, currentCount, planCap })}
          <p style="margin:0;color:#6b7280;font-size:13px;">Want us to shift focus to different roles or locations? Just reply.</p>`
      })
    };
  }

  if (type === 'completed') {
    return {
      subject: `All ${planCap} applications done. ${planLabel} plan wrapped.`,
      html: shell({
        unsubUrl,
        kicker: "FLASHFIRE PORTAL",
        title: "All applications are out the door",
        bodyHtml: `
          <p style="margin:0 0 12px;color:#374151;font-size:16px;">Hi ${name},</p>
          <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">That's a wrap on all <strong>${planCap} applications</strong> under your <strong>${planLabel}</strong> plan. We're now focused on tracking replies, lining up interviews, and helping with follow-ups.</p>
          ${progressBlock({ planLabel, currentCount: planCap, planCap })}
          <p style="margin:0;color:#6b7280;font-size:13px;">Got an interview coming up or need prep help? Reply here, we've got you.</p>`
      })
    };
  }

  throw new Error(`Unknown milestone email type: ${type}`);
}

// trigger: "manual" when an operator sent it (send-pending, resend, test);
// anything else is the cron. Shown in the admin Notifications tab.
export async function sendMilestoneEmail({ client, type, snapshot = {}, milestoneKey = null, trigger = "auto" }) {
  const toEmail = (client.paymentEmail || "").trim();
  if (!toEmail) {
    console.warn(`[Milestone] skip ${type} for ${client.email} — no paymentEmail`);
    return { skipped: true, reason: "no_payment_email" };
  }

  const planLabel = getPlanLabel(client.planType);
  // Opting out here stops the recurring reports, not the interview/offer
  // alerts - those are the job search itself and have their own stream.
  const unsub = unsubscribeLink(toEmail, UNSUB_STREAMS.REMINDERS);
  const ctx = {
    unsubUrl: unsub.url,
    name: client.name || "there",
    planLabel,
    planCap: snapshot.planCap || 0,
    currentCount: snapshot.currentCount || 0,
    threshold: snapshot.threshold || 0
  };

  const { subject, html } = buildEmail(type, ctx);

  const logSnapshot = {
    planType: client.planType || "",
    planCap: ctx.planCap,
    currentCount: ctx.currentCount,
    percent: ctx.planCap ? Math.round((ctx.currentCount / ctx.planCap) * 100) : 0
  };

  const result = await sendGmailEmail({
    to: toEmail,
    subject,
    html,
    // RFC 8058: turns Gmail's own Unsubscribe button on. One-click POST is
    // only claimed for an https link - see utils/unsubscribe.js.
    headers: unsubscribeHeaders(toEmail, UNSUB_STREAMS.REMINDERS),
    category: "milestone",
    type: milestoneKey || type,
    clientEmail: client.email,
    snapshot: logSnapshot,
    meta: { milestoneType: type, milestoneKey, trigger: trigger === "manual" ? "manual" : "auto" }
  });

  return result;
}

// Exported for utils/unsubscribe.test.mjs, which checks every milestone
// variant carries the opt-out link. Not part of the sending API.
export const __testables = { buildEmail };
