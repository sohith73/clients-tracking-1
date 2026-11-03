import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { ok, readJson, route } from "../http.js";
import { Settings } from "../models.js";
import { getSettings } from "../settings.js";
import { isDayKey } from "../time.js";
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
  return ok({
    settings: await getSettings(),
  });
});
