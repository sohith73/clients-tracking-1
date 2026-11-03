import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { HttpError, ok, readJson, route } from "../http.js";
import { Attendance, OVERRIDE_STATUSES, User } from "../models.js";
import { getSettings } from "../settings.js";
import { dayKey, isDayKey, isMonthKey, monthKey } from "../time.js";
import { loadMonth } from "../views.js";
export const GET = route(async (request) => {
  await requireAdmin(request);
  const month = request.nextUrl.searchParams.get("month") ?? monthKey();
  if (!isMonthKey(month))
    throw new HttpError(400, "month must look like 2026-11");
  const [users, settings] = await Promise.all([
    User.find({
      isActive: true,
    })
      .sort({
        name: 1,
      })
      .lean(),
    getSettings(),
  ]);
  const people = await loadMonth(users, month, settings);
  return ok({
    month,
    today: dayKey(),
    people,
  });
});
const overrideBody = z.object({
  userId: z.string().refine(isValidObjectId, {
    error: "Unknown employee",
  }),
  date: z.string().refine(isDayKey, {
    error: "Pick a valid date",
  }),
  override: z.enum(OVERRIDE_STATUSES).nullable(),
  note: z
    .string()
    .trim()
    .max(300, {
      error: "Keep the note under 300 characters",
    })
    .optional(),
});
export const PUT = route(async (request) => {
  const admin = await requireAdmin(request);
  const input = await readJson(request, overrideBody);
  if (input.date > dayKey())
    throw new HttpError(422, "You can't mark attendance for a future date");
  const exists = await User.exists({
    _id: input.userId,
  });
  if (!exists) throw new HttpError(404, "Employee not found");
  await Attendance.updateOne(
    {
      user: input.userId,
      date: input.date,
    },
    {
      $set: {
        override: input.override,
        overrideNote: input.override ? input.note || null : null,
        overriddenBy: input.override ? admin._id : null,
      },
    },
    {
      upsert: true,
    },
  );
  return ok({
    saved: true,
  });
});
