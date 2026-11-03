// Pure helpers and constants for the attendance pages. Kept out of shared.jsx so that
// file only exports components (react-refresh needs that for fast refresh).

export const istToday = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
export const currentMonth = () => istToday().slice(0, 7);

/** "2026-11" shifted by `delta` months. */
export function shiftMonth(month, delta) {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function monthLabel(month) {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : null;
}

/** "Mon, 10 Nov 2026" from a YYYY-MM-DD key. */
export function formatDay(day, withWeekday = true) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withWeekday ? { weekday: "short" } : {}),
  });
}

export function formatRange(from, to) {
  return from === to ? formatDay(from) : `${formatDay(from, false)} to ${formatDay(to, false)}`;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

export const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

export const cap = (text = "") => text.charAt(0).toUpperCase() + text.slice(1).replaceAll("_", " ");

/**
 * How a calendar day is drawn. `cell` is the tile style, `code` the short mark used in the
 * dense admin grid. Every pair keeps 4.5:1 contrast for text.
 */
const STYLES = {
  present: { label: "Present", code: "P", cell: "bg-emerald-50 border-emerald-200 text-emerald-900", dot: "bg-emerald-500" },
  half_day: { label: "Half day", code: "H", cell: "bg-amber-50 border-amber-200 text-amber-900", dot: "bg-amber-500" },
  absent: { label: "Absent", code: "A", cell: "bg-red-50 border-red-200 text-red-900", dot: "bg-red-500" },
  leave_paid: { label: "Paid leave", code: "L", cell: "bg-blue-50 border-blue-200 text-blue-900", dot: "bg-blue-500" },
  leave_unpaid: { label: "Unpaid leave", code: "U", cell: "bg-orange-50 border-orange-200 text-orange-900", dot: "bg-orange-500" },
  leave_unset: { label: "Leave, pay not set", code: "L?", cell: "bg-violet-50 border-violet-200 text-violet-900", dot: "bg-violet-500" },
  off: { label: "Off", code: "-", cell: "bg-slate-100 border-slate-200 text-slate-600", dot: "bg-slate-400" },
  not_marked: { label: "Not marked yet", code: "?", cell: "bg-white border-dashed border-slate-300 text-slate-700", dot: "bg-slate-300" },
  upcoming: { label: "Upcoming", code: "", cell: "bg-white border-slate-200 text-slate-400", dot: "bg-slate-200" },
  before_joining: { label: "Before joining", code: "", cell: "bg-slate-50 border-slate-100 text-slate-400", dot: "bg-slate-200" },
};

export function dayStyle(day) {
  if (day.status === "leave") {
    const pay = day.leave?.payType;
    return STYLES[pay === "paid" ? "leave_paid" : pay === "unpaid" ? "leave_unpaid" : "leave_unset"];
  }
  return STYLES[day.status] || STYLES.upcoming;
}

export const LEGEND = ["present", "half_day", "absent", "leave_paid", "leave_unpaid", "off", "not_marked"].map((key) => ({ key, ...STYLES[key] }));

export const LEAVE_STATUS = {
  pending: { label: "Pending", tone: "bg-amber-50 text-amber-900 border-amber-200" },
  approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-900 border-emerald-200" },
  rejected: { label: "Rejected", tone: "bg-red-50 text-red-900 border-red-200" },
  cancelled: { label: "Cancelled", tone: "bg-slate-100 text-slate-700 border-slate-200" },
};

export const LEAVE_TYPES = [
  { value: "casual", label: "Casual" },
  { value: "sick", label: "Sick" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other" },
];

export const ROLES = [
  { value: "bda", label: "BDA", hint: "Sees the attendance pages only." },
  { value: "team_lead", label: "Team lead", hint: "Client job analysis, extension and performance reports, plus attendance." },
  { value: "operations_intern", label: "Operations", hint: "Operators performance report, plus attendance." },
  { value: "onboarding_team", label: "Onboarding", hint: "Client onboarding, plus attendance." },
  { value: "csm", label: "CSM", hint: "Client onboarding and job analysis, plus attendance." },
  { value: "admin", label: "Admin", hint: "Full access. Approves leave and manages people." },
];

export const roleLabel = (value) => ROLES.find((r) => r.value === value)?.label || cap(value);

export const DESIGNATIONS = ["Software Developer", "Senior Software Developer", "Frontend Developer", "Backend Developer", "QA Engineer", "Designer", "Business Development Associate", "Operations Executive", "Team Lead", "Customer Success Manager", "HR", "Intern"];
