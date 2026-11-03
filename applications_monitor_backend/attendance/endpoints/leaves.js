import { requireUser } from "../auth.js";
import { ok, readJson, route } from "../http.js";
import { createLeave, createLeaveSchema } from "../leaves.js";
import { Leave } from "../models.js";
import { notifyLeaveRequested } from "../notify.js";
import { toLeaveViews } from "../views.js";
export const GET = route(async (request) => {
  const user = await requireUser(request);
  const leaves = await Leave.find({
    user: user._id,
  })
    .sort({
      fromDate: -1,
    })
    .limit(200)
    .lean();
  return ok({
    leaves: await toLeaveViews(leaves),
  });
});
export const POST = route(async (request) => {
  const user = await requireUser(request);
  const input = await readJson(request, createLeaveSchema);
  const created = await createLeave(user, input);
  const [leave] = await toLeaveViews([created.toObject()]);
  notifyLeaveRequested(request, leave);
  return ok(
    {
      leave,
    },
    201,
  );
});
