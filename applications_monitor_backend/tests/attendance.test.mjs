import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import { attendanceRouter } from "../attendance/router.js";
import { Attendance, Leave, Settings } from "../attendance/models.js";
import { UserModel } from "../UserModel.js";
import { setAttendanceMailSender } from "../attendance/notify.js";
import { computeLeaveDays, dayStatus, summarize } from "../attendance/rules.js";
import { dayKey, addDays, isDayKey } from "../attendance/time.js";
let mongo, server, base, employee, admin, otherAdmin;
const mails = [];
const settings = {
  weeklyOffDays: [0],
  holidays: [{ date: "2026-11-04", name: "Holiday" }],
};
setAttendanceMailSender(async (mail) => {
  mails.push(mail);
});
before(async () => {
  process.env.JWT_SECRET = "attendance-test-only-secret";
  mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
  await mongoose.connect(mongo.getUri());
  await Promise.all([Attendance.init(), Leave.init(), Settings.init()]);
  [employee, admin, otherAdmin] = await UserModel.create([
    {
      email: "bda@example.test",
      password: "test",
      role: "bda",
      name: "<Employee>",
    },
    { email: "admin@example.test", password: "test", role: "admin" },
    { email: "other@example.test", password: "test", role: "admin" },
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/attendance", attendanceRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}/api/attendance`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
async function call(user, path, method = "GET", body) {
  const token = jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
  );
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, ...(await response.json()) };
}
function workingDay(offset = 1) {
  let day = addDays(dayKey(), offset);
  while (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) day = addDays(day, 1);
  return day;
}
const request = (day) => ({
  type: "casual",
  fromDate: day,
  toDate: day,
  halfDay: false,
  reason: "<script>hello</script>",
});
test("rules count working days, half days, limits, strict dates and IST midnight", () => {
  assert.deepEqual(
    computeLeaveDays(
      { fromDate: "2026-11-01", toDate: "2026-11-05", halfDay: false },
      settings,
      "2026-11-03",
    ).days,
    ["2026-11-02", "2026-11-03", "2026-11-05"],
  );
  assert.equal(
    computeLeaveDays(
      { fromDate: "2026-11-03", toDate: "2026-11-03", halfDay: true },
      settings,
      "2026-11-03",
    ).dayCount,
    0.5,
  );
  assert.equal(
    computeLeaveDays(
      { fromDate: "2026-11-03", toDate: "2026-11-05", halfDay: true },
      settings,
      "2026-11-03",
    ).ok,
    false,
  );
  assert.equal(
    computeLeaveDays(
      { fromDate: "2026-01-01", toDate: "2026-11-05", halfDay: false },
      settings,
      "2026-11-03",
    ).ok,
    false,
  );
  assert.equal(isDayKey("2026-02-30"), false);
  assert.equal(dayKey(new Date("2026-11-02T19:00:00Z")), "2026-11-03");
});
test("status precedence and fractional payroll summary", () => {
  const input = {
    day: "2026-11-01",
    today: "2026-11-03",
    joinedDay: "2026-01-01",
    settings,
    record: { override: "absent", checkInAt: "now" },
    leave: { halfDay: true, payType: "paid" },
  };
  assert.equal(dayStatus(input), "absent");
  input.record.override = null;
  assert.equal(dayStatus(input), "leave");
  input.leave = null;
  assert.equal(dayStatus(input), "present");
  input.record = null;
  assert.equal(dayStatus(input), "off");
  assert.equal(
    summarize([{ status: "leave", leave: { halfDay: true, payType: "paid" } }])
      .paidLeave,
    0.5,
  );
});
test("BDA access, check-in/out conflicts, month and admin restrictions", async () => {
  assert.equal((await call(employee, "/today")).status, 200);
  assert.equal((await call(employee, "/check-out", "POST")).status, 409);
  assert.equal((await call(employee, "/check-in", "POST")).status, 200);
  assert.equal((await call(employee, "/check-in", "POST")).status, 409);
  assert.equal((await call(employee, "/check-out", "POST")).status, 200);
  assert.equal((await call(employee, "/check-out", "POST")).status, 409);
  assert.equal((await call(employee, "/month")).status, 200);
  assert.equal((await call(employee, "/month?month=bad")).status, 400);
  for (const path of [
    "/admin/overview",
    "/admin/leaves",
    "/admin/attendance",
    "/admin/settings",
  ])
    assert.equal((await call(employee, path)).status, 403);
  assert.equal(
    (await call(employee, "/admin/attendance", "PUT", {})).status,
    403,
  );
});
test("leave lifecycle, ownership, transitions, mail recipient matrix and HTML escaping", async () => {
  const created = await call(
    employee,
    "/leaves",
    "POST",
    request(workingDay()),
  );
  assert.equal(created.status, 201);
  const id = created.leave.id;
  assert.equal(
    (await call(employee, "/leaves", "POST", request(workingDay()))).status,
    409,
  );
  assert.equal((await call(admin, `/leaves/${id}/cancel`, "POST")).status, 404);
  assert.equal(
    (
      await call(employee, `/admin/leaves/${id}`, "PATCH", {
        action: "approve",
        payType: "paid",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(admin, `/admin/leaves/${id}`, "PATCH", { action: "approve" }))
      .status,
    422,
  );
  assert.equal(
    (
      await call(admin, `/admin/leaves/${id}`, "PATCH", {
        action: "approve",
        payType: "paid",
      })
    ).leave.status,
    "approved",
  );
  assert.equal(
    (await call(employee, `/leaves/${id}/cancel`, "POST")).status,
    409,
  );
  assert.equal(
    (await call(admin, `/admin/leaves/${id}`, "PATCH", { action: "reject" }))
      .status,
    409,
  );
  assert.equal(
    (
      await call(admin, `/admin/leaves/${id}`, "PATCH", {
        action: "set_pay",
        payType: "unpaid",
      })
    ).leave.payType,
    "unpaid",
  );
  assert.equal(
    (
      await call(admin, `/admin/leaves/${id}`, "PATCH", {
        action: "revoke",
        note: "Changed",
      })
    ).leave.status,
    "cancelled",
  );
  const second = await call(employee, "/leaves", "POST", request(workingDay()));
  const cancelled = await call(
    employee,
    `/leaves/${second.leave.id}/cancel`,
    "POST",
  );
  assert.equal(cancelled.status, 200, cancelled.error);
  assert.equal(cancelled.leave.status, "cancelled");
  const third = await call(employee, "/leaves", "POST", request(workingDay()));
  assert.equal(
    (
      await call(admin, `/admin/leaves/${third.leave.id}`, "PATCH", {
        action: "reject",
      })
    ).leave.status,
    "rejected",
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  const requests = mails.filter((m) => m.subject.startsWith("Leave request:"));
  assert.ok(requests.some((m) => m.to === admin.email));
  assert.ok(requests.some((m) => m.to === otherAdmin.email));
  assert.ok(!requests.some((m) => m.to === employee.email));
  assert.ok(
    requests.every(
      (m) => !m.html.includes("<script>") && m.html.includes("&lt;script&gt;"),
    ),
  );
  const approvals = mails.filter((m) =>
    m.subject.startsWith("Leave approved:"),
  );
  assert.ok(approvals.some((m) => m.to === employee.email));
  assert.ok(approvals.some((m) => m.to === otherAdmin.email));
  assert.ok(!approvals.some((m) => m.to === admin.email));
});
test("self decisions blocked unless only active admin, inactive JWT blocked and role changes effective", async () => {
  const created = await call(admin, "/leaves", "POST", request(workingDay(5)));
  assert.equal(
    (
      await call(admin, `/admin/leaves/${created.leave.id}`, "PATCH", {
        action: "approve",
        payType: "paid",
      })
    ).status,
    403,
  );
  await UserModel.updateOne(
    { _id: otherAdmin._id },
    { $set: { isActive: false } },
  );
  assert.equal(
    (
      await call(admin, `/admin/leaves/${created.leave.id}`, "PATCH", {
        action: "approve",
        payType: "paid",
      })
    ).status,
    200,
  );
  assert.equal((await call(otherAdmin, "/today")).status, 401);
  await UserModel.updateOne(
    { _id: otherAdmin._id },
    { $set: { isActive: true, role: "bda" } },
  );
  assert.equal((await call(otherAdmin, "/admin/overview")).status, 403);
});
test("overnight shift up to 20 hours, overrides and settings validation", async () => {
  await Attendance.deleteMany({ user: employee._id });
  const now = new Date();
  const yesterday = addDays(dayKey(now), -1);
  await Attendance.create({
    user: employee._id,
    date: yesterday,
    checkInAt: new Date(now.getTime() - 3600000),
  });
  assert.equal((await call(employee, "/today")).today.date, yesterday);
  assert.equal((await call(employee, "/check-out", "POST")).date, yesterday);
  assert.equal(
    (
      await call(admin, "/admin/attendance", "PUT", {
        userId: employee.id,
        date: dayKey(),
        override: "half_day",
        note: "Correction",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(admin, "/admin/attendance", "PUT", {
        userId: employee.id,
        date: workingDay(),
        override: "present",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call(admin, "/admin/settings", "PUT", {
        weeklyOffDays: [0, 1, 2, 3, 4, 5, 6],
        holidays: [],
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call(admin, "/admin/settings", "PUT", {
        weeklyOffDays: [0],
        holidays: [],
      })
    ).status,
    200,
  );
  assert.equal((await call(admin, "/admin/overview")).status, 200);
  assert.equal((await call(admin, "/admin/attendance")).status, 200);
});

test("concurrent overlapping requests allow only one winner", async () => {
  const day = workingDay(15);
  const results = await Promise.all([
    call(employee, "/leaves", "POST", request(day)),
    call(employee, "/leaves", "POST", request(day)),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
});

test('missing or malformed JWT is unauthorized and expired overnight shifts cannot check out', async () => {
  assert.equal((await fetch(base + '/today')).status, 401);
  assert.equal((await fetch(base + '/today', { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  await Attendance.deleteMany({ user: employee._id });
  await Attendance.create({ user: employee._id, date: addDays(dayKey(), -1), checkInAt: new Date(Date.now() - 21 * 3600000) });
  assert.equal((await call(employee, '/today')).today.checkInAt, null);
  assert.equal((await call(employee, '/check-out', 'POST')).status, 409);
});
