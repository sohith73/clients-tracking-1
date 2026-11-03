const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
export function dayKey(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function monthKey(date = new Date()) {
  return dayKey(date).slice(0, 7);
}
export function isDayKey(value) {
  if (!DAY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function isMonthKey(value) {
  return MONTH_RE.test(value) && isDayKey(`${value}-01`);
}
export function weekdayOf(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}
export function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function daysBetween(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
export function daysInMonth(month) {
  const first = `${month}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return daysBetween(first, addDays(next.toISOString().slice(0, 10), -1));
}
export function shiftMonth(month, delta) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
});
export function formatTimeIST(iso) {
  return iso ? timeFormat.format(new Date(iso)) : "-";
}
const dayFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
export function formatDay(day) {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}
const monthFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
export function formatMonth(month) {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}
export function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
