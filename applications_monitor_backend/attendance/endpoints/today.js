import { requireUser } from "../auth.js";
import { ok, route } from "../http.js";
import { Leave } from "../models.js";
import { getSettings } from "../settings.js";
import { currentShift } from "../shift.js";
import { dayKey, weekdayOf } from "../time.js";
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const GET = route(async (request) => {
  const user = await requireUser(request);
  const today = dayKey();
  const [shift, settings, leave] = await Promise.all([
    currentShift(user._id),
    getSettings(),
    Leave.findOne({
      user: user._id,
      status: "approved",
      days: today,
    }).lean(),
  ]);
  const holiday = settings.holidays.find((h) => h.date === today);
  const offReason = holiday
    ? `Holiday: ${holiday.name}`
    : settings.weeklyOffDays.includes(weekdayOf(today))
      ? `${WEEKDAYS[weekdayOf(today)]} is a weekly off`
      : null;
  return ok({
    today: {
      date: shift?.date ?? today,
      checkInAt: shift?.checkInAt?.toISOString() ?? null,
      checkOutAt: shift?.checkOutAt?.toISOString() ?? null,
    },
    offReason,
    leaveToday: leave
      ? {
          halfDay: leave.halfDay,
          payType: leave.payType ?? null,
        }
      : null,
  });
});
