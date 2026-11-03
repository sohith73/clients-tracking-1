import { requireUser } from "../auth.js";
import { HttpError, ok, route } from "../http.js";
import { Attendance } from "../models.js";
import { currentShift } from "../shift.js";
import { dayKey } from "../time.js";
export const POST = route(async (request) => {
  const user = await requireUser(request);
  const now = new Date();
  const open = await currentShift(user._id, now);
  if (open?.checkInAt && !open.checkOutAt) {
    throw new HttpError(409, "You are already checked in. Check out first.");
  }
  const date = dayKey(now);
  try {
    await Attendance.updateOne(
      {
        user: user._id,
        date,
        checkInAt: null,
      },
      {
        $set: {
          checkInAt: now,
        },
      },
      {
        upsert: true,
      },
    );
  } catch (error) {
    if (error.code === 11000) {
      throw new HttpError(409, "You already checked in today.");
    }
    throw error;
  }
  return ok({
    date,
    checkInAt: now.toISOString(),
  });
});
