import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { ok, readJson, route } from "../http.js";
import { Leave, Settings } from "../models.js";
import { getSettings } from "../settings.js";
import { nonWorking } from "../rules.js";
import { addDays, dayKey, isDayKey } from "../time.js";
const body = z.object({
  weeklyOffDays: z
    .array(z.number().int().min(0).max(6))
    .max(6, {
      error: "At least one day of the week has to be a working day",
    })
    .transform((list) => [...new Set(list)].sort()),
  holidays: z
    .array(
      z.object({
        date: z.string().refine(isDayKey, {
          error: "Holiday date is not valid",
        }),
        name: z
          .string()
          .trim()
          .min(1, {
            error: "Give the holiday a name",
          })
          .max(80),
      }),
    )
    .max(200)
    .refine((list) => new Set(list.map((h) => h.date)).size === list.length, {
      error: "Two holidays share the same date",
    })
    .transform((list) =>
      [...list].sort((a, b) => a.date.localeCompare(b.date)),
    ),
});
export const GET = route(async (request) => {
  await requireAdmin(request);
  return ok({
    settings: await getSettings(),
  });
});
/**
 * A leave freezes its day list when it is requested. When a holiday or weekly off is added later,
 * drop those days from pending and approved leaves so nobody is charged leave on a day off.
 * A request left with no days is cancelled. Removing a holiday never adds days back.
 */
async function reconcileLeaves(settings) {
  const leaves = await Leave.find({
    status: { $in: ["pending", "approved"] },
    toDate: { $gte: addDays(dayKey(), -90) },
  }).lean();
  let adjusted = 0;
  for (const leave of leaves) {
    const days = leave.days.filter((day) => !nonWorking(day, settings));
    if (days.length === leave.days.length) continue;
    adjusted += 1;
    if (days.length === 0) {
      await Leave.updateOne(
        { _id: leave._id },
        {
          $set: {
            status: "cancelled",
            decisionNote: "Cancelled automatically: every date is now a holiday or weekly off.",
          },
        },
      );
    } else {
      await Leave.updateOne(
        { _id: leave._id },
        { $set: { days, dayCount: leave.halfDay ? 0.5 : days.length } },
      );
    }
  }
  return adjusted;
}
export const PUT = route(async (request) => {
  await requireAdmin(request);
  const input = await readJson(request, body);
  await getSettings();
  await Settings.updateOne(
    {
      key: "global",
    },
    {
      $set: input,
    },
  );
  const settings = await getSettings();
  const adjustedLeaves = await reconcileLeaves(settings);
  return ok({
    settings,
    adjustedLeaves,
  });
});
