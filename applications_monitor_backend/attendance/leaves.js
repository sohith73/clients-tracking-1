import { z } from "zod";
import { HttpError } from "./http.js";
import { LEAVE_TYPES, Leave } from "./models.js";
import { computeLeaveDays } from "./rules.js";
import { getSettings } from "./settings.js";
import { dayKey, isDayKey } from "./time.js";
const day = z.string().refine(isDayKey, {
  error: "Pick a valid date",
});
export const createLeaveSchema = z.object({
  type: z.enum(LEAVE_TYPES, {
    error: "Pick a leave type",
  }),
  fromDate: day,
  toDate: day,
  halfDay: z.boolean().default(false),
  reason: z
    .string({
      error: "Add a reason",
    })
    .trim()
    .min(3, {
      error: "Add a short reason (at least 3 characters)",
    })
    .max(1000, {
      error: "Keep the reason under 1000 characters",
    }),
});
export async function createLeave(user, input) {
  const settings = await getSettings();
  const result = computeLeaveDays(input, settings, dayKey());
  if (!result.ok) throw new HttpError(422, result.message);
  const clash = await Leave.findOne({
    user: user._id,
    status: {
      $in: ["pending", "approved"],
    },
    days: {
      $in: result.days,
    },
  }).lean();
  if (clash) {
    throw new HttpError(
      409,
      `You already have a ${clash.status} request covering ${clash.fromDate === clash.toDate ? clash.fromDate : `${clash.fromDate} to ${clash.toDate}`}.`,
    );
  }
  return Leave.create({
    ...input,
    user: user._id,
    days: result.days,
    dayCount: result.dayCount,
  });
}
