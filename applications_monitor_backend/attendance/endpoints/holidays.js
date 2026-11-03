import { ok, route } from "../http.js";
import { getSettings } from "../settings.js";
import { dayKey } from "../time.js";

/** Company holidays and weekly offs, readable by every signed-in person so they can plan leave. */
export const GET = route(async () => {
  const settings = await getSettings();
  const today = dayKey();
  return ok({
    weeklyOffDays: settings.weeklyOffDays,
    holidays: settings.holidays.filter((h) => h.date >= today).map(({ date, name }) => ({ date, name })),
  });
});
