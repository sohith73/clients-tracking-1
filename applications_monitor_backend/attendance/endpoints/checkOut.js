import { requireUser } from "../auth.js";
import { HttpError, ok, route } from "../http.js";
import { Attendance } from "../models.js";
import { currentShift } from "../shift.js";
export const POST = route(async (request) => {
  const user = await requireUser(request);
  const now = new Date();
  const shift = await currentShift(user._id, now);
  if (!shift?.checkInAt)
    throw new HttpError(409, "Check in before checking out.");
  if (shift.checkOutAt)
    throw new HttpError(409, "You already checked out for this shift.");
  const result = await Attendance.updateOne(
    {
      _id: shift._id,
      checkOutAt: null,
    },
    {
      $set: {
        checkOutAt: now,
      },
    },
  );
  if (result.modifiedCount === 0)
    throw new HttpError(409, "You already checked out for this shift.");
  return ok({
    date: shift.date,
    checkOutAt: now.toISOString(),
  });
});
