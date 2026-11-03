import { isValidObjectId } from "mongoose";
import { requireUser } from "../auth.js";
import { HttpError, ok, route } from "../http.js";
import { Leave } from "../models.js";
import { notifyLeaveWithdrawn } from "../notify.js";
import { toLeaveViews } from "../views.js";
export const POST = route(async (request, ctx) => {
  const user = await requireUser(request);
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) throw new HttpError(404, "Leave request not found");
  const updated = await Leave.findOneAndUpdate(
    {
      _id: id,
      user: user._id,
      status: "pending",
    },
    {
      $set: {
        status: "cancelled",
      },
    },
    {
      returnDocument: "after",
      lean: true,
    },
  );
  if (!updated) {
    const existing = await Leave.findOne(
      {
        _id: id,
        user: user._id,
      },
      {
        status: 1,
      },
    ).lean();
    if (!existing) throw new HttpError(404, "Leave request not found");
    throw new HttpError(
      409,
      `This request is already ${existing.status}, so it can't be withdrawn. Ask an admin.`,
    );
  }
  const [leave] = await toLeaveViews([updated]);
  notifyLeaveWithdrawn(request, leave);
  return ok({
    leave,
  });
});
