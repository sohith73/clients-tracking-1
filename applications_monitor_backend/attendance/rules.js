import { addDays, daysBetween, weekdayOf } from "./time.js";
export const MAX_LEAVE_SPAN_DAYS = 60;
export const MAX_BACKDATE_DAYS = 60;
export function nonWorking(day, settings) {
  return (
    settings.weeklyOffDays.includes(weekdayOf(day)) ||
    settings.holidays.some((h) => h.date === day)
  );
}
export function computeLeaveDays(input, settings, today) {
  const { fromDate, toDate, halfDay } = input;
  if (toDate < fromDate)
    return {
      ok: false,
      message: "The end date is before the start date",
    };
  if (fromDate < addDays(today, -MAX_BACKDATE_DAYS)) {
    return {
      ok: false,
      message: `Leave can start at most ${MAX_BACKDATE_DAYS} days in the past`,
    };
  }
  if (toDate > addDays(fromDate, MAX_LEAVE_SPAN_DAYS - 1)) {
    return {
      ok: false,
      message: `One request can cover at most ${MAX_LEAVE_SPAN_DAYS} days. Split it into two.`,
    };
  }
  if (halfDay && fromDate !== toDate)
    return {
      ok: false,
      message: "A half day must start and end on the same date",
    };
  const days = daysBetween(fromDate, toDate).filter(
    (day) => !nonWorking(day, settings),
  );
  if (days.length === 0)
    return {
      ok: false,
      message:
        "Those dates are all weekly offs or holidays, so no leave is needed",
    };
  return {
    ok: true,
    days,
    dayCount: halfDay ? 0.5 : days.length,
  };
}
export function dayStatus(input) {
  const { day, today, joinedDay, settings, record, leave } = input;
  if (record?.override) return record.override;
  if (leave) return "leave";
  if (record?.checkInAt) return "present";
  if (nonWorking(day, settings)) return "off";
  if (day > today) return "upcoming";
  if (day < joinedDay) return "before_joining";
  if (day === today) return "not_marked";
  return "absent";
}
export function summarize(days) {
  const summary = {
    present: 0,
    halfDay: 0,
    absent: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    unsetLeave: 0,
  };
  for (const { status, leave } of days) {
    if (status === "present") summary.present += 1;
    else if (status === "half_day") summary.halfDay += 1;
    else if (status === "absent") summary.absent += 1;
    else if (status === "leave" && leave) {
      const amount = leave.halfDay ? 0.5 : 1;
      if (leave.payType === "paid") summary.paidLeave += amount;
      else if (leave.payType === "unpaid") summary.unpaidLeave += amount;
      else summary.unsetLeave += amount;
    }
  }
  return summary;
}
