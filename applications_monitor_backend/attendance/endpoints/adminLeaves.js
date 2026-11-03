import { isValidObjectId } from "mongoose";
import { requireAdmin } from "../auth.js";
import { HttpError, ok, route } from "../http.js";
import { LEAVE_STATUSES, Leave } from "../models.js";
import { daysInMonth, isMonthKey } from "../time.js";
import { toLeaveViews } from "../views.js";
export const GET = route(async (request) => {
  await requireAdmin(request);
  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? "pending";
  const month = params.get("month");
  const userId = params.get("userId");
  const filter = {};
  if (status !== "all") {
    if (!LEAVE_STATUSES.includes(status))
      throw new HttpError(400, "Unknown status filter");
    filter.status = status;
  }
  if (month) {
    if (!isMonthKey(month))
      throw new HttpError(400, "month must look like 2026-11");
    const days = daysInMonth(month);
    filter.fromDate = {
      $lte: days[days.length - 1],
    };
    filter.toDate = {
      $gte: days[0],
    };
  }
  if (userId) {
    if (!isValidObjectId(userId)) throw new HttpError(400, "Unknown employee");
    filter.user = userId;
  }
  const sort =
    status === "pending"
      ? {
          fromDate: 1,
        }
      : {
          fromDate: -1,
        };
  const leaves = await Leave.find(filter).sort(sort).limit(500).lean();
  return ok({
    leaves: await toLeaveViews(leaves),
  });
});
