import { requireUser } from "../auth.js";
import { HttpError, ok, route } from "../http.js";
import { getSettings } from "../settings.js";
import { dayKey, isMonthKey, monthKey } from "../time.js";
import { loadMonth } from "../views.js";
export const GET = route(async (request) => {
  const user = await requireUser(request);
  const month = request.nextUrl.searchParams.get("month") ?? monthKey();
  if (!isMonthKey(month))
    throw new HttpError(400, "month must look like 2026-11");
  const settings = await getSettings();
  const [person] = await loadMonth([user], month, settings);
  return ok({
    month,
    today: dayKey(),
    person,
  });
});
