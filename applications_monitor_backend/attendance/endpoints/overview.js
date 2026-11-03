import { requireAdmin, toPublicUser } from "../auth.js";
import { ok, route } from "../http.js";
import { Attendance, Leave, User } from "../models.js";
import { nonWorking } from "../rules.js";
import { getSettings } from "../settings.js";
import { OPEN_SHIFT_HOURS } from "../shift.js";
import { addDays, dayKey } from "../time.js";
export const GET = route(async (request) => {
  await requireAdmin(request);
  const now = new Date();
  const today = dayKey(now);
  const [users, records, leaves, pendingLeaves, settings] = await Promise.all([
    User.find({
      isActive: true,
    })
      .sort({
        name: 1,
      })
      .lean(),
    Attendance.find({
      checkInAt: {
        $ne: null,
      },
      $or: [
        {
          date: today,
        },
        {
          date: addDays(today, -1),
          checkOutAt: null,
          checkInAt: {
            $gte: new Date(now.getTime() - OPEN_SHIFT_HOURS * 3600 * 1000),
          },
        },
      ],
    }).lean(),
    Leave.find({
      status: "approved",
      days: today,
    }).lean(),
    Leave.countDocuments({
      status: "pending",
    }),
    getSettings(),
  ]);
  const recordByUser = new Map();
  for (const record of records) {
    const key = String(record.user);
    const existing = recordByUser.get(key);
    if (!existing || record.date > existing.date) recordByUser.set(key, record);
  }
  const leaveByUser = new Map(leaves.map((l) => [String(l.user), l]));
  const checkedIn = [];
  const onLeave = [];
  const notMarked = [];
  for (const user of users) {
    const record = recordByUser.get(String(user._id));
    const leave = leaveByUser.get(String(user._id));
    if (record?.checkInAt) {
      checkedIn.push({
        user: toPublicUser(user),
        checkInAt: record.checkInAt.toISOString(),
        checkOutAt: record.checkOutAt?.toISOString() ?? null,
      });
    } else if (leave) {
      onLeave.push({
        user: toPublicUser(user),
        halfDay: leave.halfDay,
        payType: leave.payType ?? null,
        type: leave.type,
      });
    } else {
      notMarked.push(toPublicUser(user));
    }
  }
  return ok({
    today,
    isOffDay: nonWorking(today, settings),
    counts: {
      employees: users.length,
      checkedIn: checkedIn.length,
      onLeave: onLeave.length,
      notMarked: notMarked.length,
      pendingLeaves,
    },
    checkedIn,
    onLeave,
    notMarked,
  });
});
