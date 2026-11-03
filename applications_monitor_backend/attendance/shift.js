import { Attendance } from "./models.js";
import { addDays, dayKey } from "./time.js";
export const OPEN_SHIFT_HOURS = 20;
export async function currentShift(userId, now = new Date()) {
  const today = dayKey(now);
  const open = await Attendance.findOne({
    user: userId,
    date: {
      $in: [addDays(today, -1), today],
    },
    checkInAt: {
      $gte: new Date(now.getTime() - OPEN_SHIFT_HOURS * 3600 * 1000),
    },
    checkOutAt: null,
  })
    .sort({
      date: -1,
    })
    .lean();
  if (open) return open;
  return Attendance.findOne({
    user: userId,
    date: today,
  }).lean();
}
