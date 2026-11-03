import { sendViaSmtp } from "../utils/smtpSender.js";
const sendMail = (mail) => mailSender(mail);
let mailSender = sendViaSmtp;
export function setAttendanceMailSender(sender) {
  mailSender = sender;
}
import { User } from "./models.js";
const TYPE = {
  casual: "casual",
  sick: "sick",
  personal: "personal",
  other: "other",
};
const capitalize = (v) => v.charAt(0).toUpperCase() + v.slice(1);
const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
function dateRange(leave) {
  const fmt = (d) => {
    const date = new Date(`${d}T00:00:00Z`);
    const part = (o) =>
      date.toLocaleDateString("en-IN", {
        ...o,
        timeZone: "UTC",
      });
    return `${part({
      weekday: "short",
    })} ${part({
      day: "numeric",
    })} ${part({
      month: "short",
    })} ${part({
      year: "numeric",
    })}`;
  };
  if (leave.fromDate === leave.toDate)
    return `${fmt(leave.fromDate)}${leave.halfDay ? " (half day)" : ""}`;
  return `${fmt(leave.fromDate)} to ${fmt(leave.toDate)}`;
}
const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;
// Links in the emails open the portal's frontend, never the API host the request came in on.
// APP_URL or FRONTEND_URL win; otherwise the first CORS_ORIGIN (the frontend), then the production frontend.
export function appUrl() {
  const fromCors = process.env.CORS_ORIGIN?.split(",")[0]?.trim();
  return (
    process.env.APP_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    fromCors ||
    "https://dashboardtracking.vercel.app"
  ).replace(/\/$/, "");
}
function render(c) {
  const rows = c.lines
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:14px;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:14px;color:#0f172a">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0f172a">
  <p style="margin:0 0 6px;font-size:13px;color:#ea580c;font-weight:600">Flashfire Attendance</p>
  <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(c.heading)}</h1>
  <table style="border-collapse:collapse;margin:0 0 16px">${rows}</table>
  ${c.note ? `<p style="margin:0 0 16px;padding:12px 14px;background:#f8fafc;border-left:3px solid #cbd5e1;font-size:14px;color:#334155">${escapeHtml(c.note)}</p>` : ""}
  <a href="${escapeHtml(c.cta.url)}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${escapeHtml(c.cta.label)}</a>
</div>`;
  const text = [
    c.heading,
    "",
    ...c.lines.map(([l, v]) => `${l}: ${v}`),
    ...(c.note ? ["", c.note] : []),
    "",
    `${c.cta.label}: ${c.cta.url}`,
  ].join("\n");
  return {
    subject: c.subject,
    html,
    text,
  };
}
async function adminEmails(exclude) {
  const admins = await User.find(
    {
      role: "admin",
      isActive: true,
      _id: {
        $nin: exclude,
      },
    },
    {
      email: 1,
    },
  ).lean();
  return admins.map((a) => a.email);
}
async function deliver(recipients, content, event) {
  const unique = [...new Set(recipients)];
  const results = await Promise.allSettled(
    unique.map((to) =>
      sendMail({
        ...content,
        to,
      }),
    ),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected")
      console.error(`[notify] ${event} email to ${unique[i]} failed`, r.reason);
  });
}
function schedule(request, event, job) {
  request.res.once("finish", () => {
    setImmediate(async () => {
      try {
        await job();
      } catch (error) {
        console.error(`[notify] ${event} failed`, error);
      }
    });
  });
}
function leaveLines(leave) {
  return [
    ["Employee", `${leave.user.name} (${leave.user.email})`],
    ["Dates", dateRange(leave)],
    ["Type", `${capitalize(TYPE[leave.type])}, ${days(leave.dayCount)}`],
    ["Reason", leave.reason],
  ];
}
export function notifyLeaveRequested(request, leave) {
  const base = appUrl();
  schedule(request, "leave_requested", async () => {
    const to = await adminEmails([leave.user.id]);
    await deliver(
      to,
      render({
        subject: `Leave request: ${leave.user.name}, ${days(leave.dayCount)}`,
        heading: `${leave.user.name} asked for ${days(leave.dayCount)} of ${TYPE[leave.type]} leave`,
        lines: leaveLines(leave),
        cta: {
          label: "Review request",
          url: `${base}/attendance/admin/leaves`,
        },
      }),
      "leave_requested",
    );
  });
}
export function notifyLeaveWithdrawn(request, leave) {
  const base = appUrl();
  schedule(request, "leave_withdrawn", async () => {
    const to = await adminEmails([leave.user.id]);
    await deliver(
      to,
      render({
        subject: `Leave withdrawn: ${leave.user.name}`,
        heading: `${leave.user.name} withdrew a leave request`,
        lines: leaveLines(leave),
        cta: {
          label: "Open leave requests",
          url: `${base}/attendance/admin/leaves`,
        },
      }),
      "leave_withdrawn",
    );
  });
}
export function notifyLeaveDecision(request, leave, action, actor) {
  const base = appUrl();
  const pay = leave.payType
    ? leave.payType === "paid"
      ? "Paid"
      : "Unpaid"
    : "Not set";
  const verb = {
    approve: "approved",
    reject: "rejected",
    revoke: "revoked",
    set_pay: "updated",
  }[action];
  schedule(request, `leave_${action}`, async () => {
    const lines = [...leaveLines(leave)];
    if (leave.status === "approved") lines.push(["Pay", pay]);
    lines.push(["Decided by", actor.name]);
    const note =
      leave.decisionNote && action !== "set_pay"
        ? `Note from ${actor.name}: ${leave.decisionNote}`
        : undefined;
    const employeeHeading = {
      approve: `Your leave is approved (${pay.toLowerCase()})`,
      reject: "Your leave request was rejected",
      revoke: "Your approved leave was revoked",
      set_pay: `Your leave is now marked ${pay.toLowerCase()}`,
    }[action];
    const adminHeading = {
      approve: `${actor.name} approved ${leave.user.name}'s leave as ${pay.toLowerCase()}`,
      reject: `${actor.name} rejected ${leave.user.name}'s leave`,
      revoke: `${actor.name} revoked ${leave.user.name}'s approved leave`,
      set_pay: `${actor.name} marked ${leave.user.name}'s leave ${pay.toLowerCase()}`,
    }[action];
    const jobs = [];
    if (String(actor._id) !== leave.user.id) {
      jobs.push(
        deliver(
          [leave.user.email],
          render({
            subject: `Leave ${verb}: ${dateRange(leave)}`,
            heading: employeeHeading,
            lines,
            note,
            cta: {
              label: "See my leave",
              url: `${base}/attendance`,
            },
          }),
          `leave_${action}_employee`,
        ),
      );
    }
    const admins = await adminEmails([actor._id, leave.user.id]);
    jobs.push(
      deliver(
        admins,
        render({
          subject: `Leave ${verb}: ${leave.user.name}, ${dateRange(leave)}`,
          heading: adminHeading,
          lines,
          note,
          cta: {
            label: "Open leave requests",
            url: `${base}/attendance/admin/leaves`,
          },
        }),
        `leave_${action}_admins`,
      ),
    );
    await Promise.all(jobs);
  });
}
