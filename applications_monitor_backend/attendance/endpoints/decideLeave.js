import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { HttpError, ok, readJson, route } from "../http.js";
import { Leave, PAY_TYPES, User } from "../models.js";
import { notifyLeaveDecision } from "../notify.js";
import { toLeaveViews } from "../views.js";
const note = z
  .string()
  .trim()
  .max(500, {
    error: "Keep the note under 500 characters",
  })
  .optional();
const payType = z.enum(PAY_TYPES, {
  error: "Choose paid or unpaid",
});
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    payType,
    note,
  }),
  z.object({
    action: z.literal("reject"),
    note,
  }),
  z.object({
    action: z.literal("set_pay"),
    payType,
  }),
  z.object({
    action: z.literal("revoke"),
    note,
  }),
]);
const TRANSITIONS = {
  approve: {
    from: "pending",
    to: "approved",
  },
  reject: {
    from: "pending",
    to: "rejected",
  },
  set_pay: {
    from: "approved",
    to: "approved",
  },
  revoke: {
    from: "approved",
    to: "cancelled",
  },
};
export const PATCH = route(async (request, ctx) => {
  const admin = await requireAdmin(request);
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) throw new HttpError(404, "Leave request not found");
  const input = await readJson(request, body);
  const current = await Leave.findById(id).lean();
  if (!current) throw new HttpError(404, "Leave request not found");
  if (String(current.user) === String(admin._id)) {
    const otherAdmins = await User.countDocuments({
      role: "admin",
      isActive: true,
      _id: {
        $ne: admin._id,
      },
    });
    if (otherAdmins > 0)
      throw new HttpError(403, "Another admin has to decide your own leave.");
  }
  const { from, to } = TRANSITIONS[input.action];
  const update = {
    status: to,
  };
  if (input.action === "set_pay") {
    update.payType = input.payType;
  } else {
    update.decidedBy = admin._id;
    update.decidedAt = new Date();
    update.decisionNote = input.note || null;
    if (input.action === "approve") update.payType = input.payType;
    if (input.action === "reject") update.payType = null;
  }
  const updated = await Leave.findOneAndUpdate(
    {
      _id: id,
      status: from,
    },
    {
      $set: update,
    },
    {
      returnDocument: "after",
      lean: true,
    },
  );
  if (!updated) {
    const latest = await Leave.findById(id, {
      status: 1,
    }).lean();
    throw new HttpError(
      409,
      `This request is ${latest?.status ?? "gone"} now, so that action no longer applies. Refresh.`,
    );
  }
  const [leave] = await toLeaveViews([updated]);
  if (!(input.action === "set_pay" && current.payType === input.payType)) {
    notifyLeaveDecision(request, leave, input.action, admin);
  }
  return ok({
    leave,
  });
});
