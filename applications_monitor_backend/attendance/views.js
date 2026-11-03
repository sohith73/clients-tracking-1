import { toPublicUser } from "./auth.js";
import { Attendance, Leave, User } from "./models.js";
import { dayStatus, summarize } from "./rules.js";
import { dayKey, daysInMonth } from "./time.js";
const iso = (date) => (date ? date.toISOString() : null);
export async function toLeaveViews(leaves) {
  const ids = new Set();
  for (const leave of leaves) {
    ids.add(String(leave.user));
    if (leave.decidedBy) ids.add(String(leave.decidedBy));
  }
  const users = await User.find(
    {
      _id: {
        $in: [...ids],
      },
    },
    {
      name: 1,
      email: 1,
    },
  ).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return leaves.map((leave) => {
    const owner = byId.get(String(leave.user));
    const decider = leave.decidedBy
      ? byId.get(String(leave.decidedBy))
      : undefined;
    return {
      id: String(leave._id),
      user: {
        id: String(leave.user),
        name: owner?.name ?? "Removed user",
        email: owner?.email ?? "",
      },
      type: leave.type,
      fromDate: leave.fromDate,
      toDate: leave.toDate,
      halfDay: leave.halfDay,
      days: leave.days,
      dayCount: leave.dayCount,
      reason: leave.reason,
      status: leave.status,
      payType: leave.payType ?? null,
      decidedBy: leave.decidedBy
        ? {
            id: String(leave.decidedBy),
            name: decider?.name ?? "Removed user",
          }
        : null,
      decidedAt: iso(leave.decidedAt),
      decisionNote: leave.decisionNote ?? null,
      createdAt: leave.createdAt.toISOString(),
    };
  });
}
export async function loadMonth(users, month, settings) {
  const days = daysInMonth(month);
  const today = dayKey();
  const userIds = users.map((u) => u._id);
  const [records, leaves] = await Promise.all([
    Attendance.find({
      user: {
        $in: userIds,
      },
      date: {
        $gte: days[0],
        $lte: days[days.length - 1],
      },
    }).lean(),
    Leave.find({
      user: {
        $in: userIds,
      },
      status: "approved",
      days: {
        $in: days,
      },
    }).lean(),
  ]);
  const recordByKey = new Map(records.map((r) => [`${r.user}:${r.date}`, r]));
  const leaveByKey = new Map();
  for (const leave of leaves) {
    for (const day of leave.days) leaveByKey.set(`${leave.user}:${day}`, leave);
  }
  const holidayByDay = new Map(settings.holidays.map((h) => [h.date, h.name]));
  return users.map((user) => {
    const joinedDay = user.joinedOn || dayKey(user._id.getTimestamp());
    const cells = days.map((day) => {
      const record = recordByKey.get(`${user._id}:${day}`);
      const leave = leaveByKey.get(`${user._id}:${day}`);
      const leaveInfo = leave
        ? {
            halfDay: leave.halfDay,
            payType: leave.payType ?? null,
          }
        : null;
      const recordInfo = record
        ? {
            checkInAt: iso(record.checkInAt),
            checkOutAt: iso(record.checkOutAt),
            override: record.override ?? null,
          }
        : null;
      return {
        day,
        status: dayStatus({
          day,
          today,
          joinedDay,
          settings,
          record: recordInfo,
          leave: leaveInfo,
        }),
        checkInAt: recordInfo?.checkInAt ?? null,
        checkOutAt: recordInfo?.checkOutAt ?? null,
        override: recordInfo?.override ?? null,
        overrideNote: record?.overrideNote ?? null,
        leave: leave
          ? {
              id: String(leave._id),
              type: leave.type,
              ...leaveInfo,
            }
          : null,
        holiday: holidayByDay.get(day) ?? null,
      };
    });
    return {
      user: toPublicUser(user),
      days: cells,
      summary: summarize(cells),
    };
  });
}
