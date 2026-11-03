import mongoose, { Schema } from "mongoose";
function model(name, schema) {
  return (
    mongoose.models[name] ??
    mongoose.model(name, schema, `attendance_${name.toLowerCase()}`)
  );
}
export { UserModel as User } from "../UserModel.js";
const holidaySchema = new Schema(
  {
    date: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
  },
  {
    _id: false,
  },
);
const settingsSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "global",
    },
    weeklyOffDays: {
      type: [Number],
      default: [0],
    },
    holidays: {
      type: [holidaySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);
export const Settings = model("Settings", settingsSchema);
export const LEAVE_TYPES = ["casual", "sick", "personal", "other"];
export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"];
export const PAY_TYPES = ["paid", "unpaid"];
const leaveSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "tracking_portal_users",
      required: true,
    },
    type: {
      type: String,
      enum: LEAVE_TYPES,
      required: true,
    },
    fromDate: {
      type: String,
      required: true,
    },
    toDate: {
      type: String,
      required: true,
    },
    halfDay: {
      type: Boolean,
      default: false,
      required: true,
    },
    days: {
      type: [String],
      required: true,
    },
    dayCount: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: LEAVE_STATUSES,
      default: "pending",
      required: true,
    },
    payType: {
      type: String,
      enum: [...PAY_TYPES, null],
      default: null,
    },
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: "tracking_portal_users",
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    decisionNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);
leaveSchema.index({
  user: 1,
  fromDate: -1,
});
leaveSchema.index({
  status: 1,
  createdAt: -1,
});
leaveSchema.index({
  days: 1,
  status: 1,
});
leaveSchema.index(
  { user: 1, days: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["pending", "approved"] } },
  },
);
export const Leave = model("Leave", leaveSchema);
export const OVERRIDE_STATUSES = ["present", "half_day", "absent"];
const attendanceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "tracking_portal_users",
      required: true,
    },
    date: {
      type: String,
      required: true,
    },
    checkInAt: {
      type: Date,
      default: null,
    },
    checkOutAt: {
      type: Date,
      default: null,
    },
    override: {
      type: String,
      enum: [...OVERRIDE_STATUSES, null],
      default: null,
    },
    overrideNote: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },
    overriddenBy: {
      type: Schema.Types.ObjectId,
      ref: "tracking_portal_users",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);
attendanceSchema.index(
  {
    user: 1,
    date: 1,
  },
  {
    unique: true,
  },
);
attendanceSchema.index({
  date: 1,
});
export const Attendance = model("Attendance", attendanceSchema);

export { Attendance as AttendanceModel, Leave as LeaveModel, Settings as AttendanceSettingsModel };
