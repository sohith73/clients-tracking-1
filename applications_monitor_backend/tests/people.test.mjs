import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { attendanceRouter } from "../attendance/router.js";
import { UserModel } from "../UserModel.js";
import { dayKey, addDays } from "../attendance/time.js";

let mongo, server, base, admin, otherAdmin, lead;

before(async () => {
  process.env.JWT_SECRET = "people-test-only-secret";
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  await mongoose.connect(mongo.getUri());
  [admin, otherAdmin, lead] = await UserModel.create([
    { email: "admin@example.test", password: "x", role: "admin", name: "Admin" },
    { email: "other@example.test", password: "x", role: "admin", name: "Other" },
    { email: "lead@example.test", password: "x", role: "team_lead", name: "Lead" },
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
  const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET);
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, ...(await response.json()) };
}

test("only admins can use the people endpoints", async () => {
  for (const [method, path] of [["GET", "/admin/people"], ["POST", "/admin/people"], ["PATCH", `/admin/people/${lead._id}`], ["POST", `/admin/people/${lead._id}/reset-password`]]) {
    assert.equal((await call(lead, path, method, method === "GET" ? undefined : {})).status, 403, `${method} ${path}`);
  }
});

test("creating a person stores a hashed temporary password and works with the login hash check", async () => {
  const created = await call(admin, "/admin/people", "POST", {
    name: "Dev Person",
    email: "  Dev.Person@Example.test ",
    otpEmail: "dev.personal@example.test",
    role: "bda",
    designation: "Software Developer",
    joinedOn: "2026-11-02",
  });
  assert.equal(created.status, 201);
  assert.equal(created.person.email, "dev.person@example.test");
  assert.equal(created.person.designation, "Software Developer");
  assert.equal(created.person.isActive, true);
  assert.match(created.temporaryPassword, /^[A-Za-z0-9]{16}$/);
  const stored = await UserModel.findOne({ email: "dev.person@example.test" }).lean();
  assert.notEqual(stored.password, created.temporaryPassword);
  assert.ok(await bcrypt.compare(created.temporaryPassword, stored.password));
  assert.equal(stored.otpEmail, "dev.personal@example.test");
  assert.equal(stored.joinedOn, "2026-11-02");
});

test("duplicate email is 409 and bad input is 422", async () => {
  assert.equal((await call(admin, "/admin/people", "POST", { name: "Again", email: "lead@example.test", role: "csm" })).status, 409);
  assert.equal((await call(admin, "/admin/people", "POST", { name: "X", email: "nope", role: "csm" })).status, 422);
  assert.equal((await call(admin, "/admin/people", "POST", { name: "Xavier", email: "x@example.test", role: "ceo" })).status, 422);
  assert.equal((await call(admin, "/admin/people", "POST", { name: "Xavier", email: "x@example.test", role: "csm", joinedOn: "2026-13-45" })).status, 422);
});

test("a new person shows up in the attendance grid and the joining date drives before_joining", async () => {
  const joined = addDays(dayKey(), 3);
  const created = await call(admin, "/admin/people", "POST", { name: "Future Hire", email: "future@example.test", role: "bda", joinedOn: joined });
  assert.equal(created.status, 201);
  const grid = await call(admin, "/admin/attendance");
  const person = grid.people.find((p) => p.user.email === "future@example.test");
  assert.ok(person, "new person is in the grid");
  assert.equal(person.user.designation, "");
  const today = person.days.find((d) => d.day === dayKey());
  if (today) assert.equal(today.status, "before_joining");
});

test("editing changes role, designation and OTP email, and re-validates", async () => {
  const target = await UserModel.findOne({ email: "dev.person@example.test" });
  const edited = await call(admin, `/admin/people/${target._id}`, "PATCH", { role: "team_lead", designation: "Engineering Lead", otpEmail: "" });
  assert.equal(edited.status, 200);
  assert.equal(edited.person.role, "team_lead");
  assert.equal(edited.person.otpEmail, "");
  assert.equal((await call(admin, `/admin/people/${target._id}`, "PATCH", { role: "bogus" })).status, 422);
  assert.equal((await call(admin, `/admin/people/${target._id}`, "PATCH", {})).status, 422);
  assert.equal((await call(admin, "/admin/people/not-an-id", "PATCH", { name: "Zed Zed" })).status, 404);
});

test("turning someone off blocks their attendance access at once and hides them from the grid", async () => {
  const target = await UserModel.findOne({ email: "dev.person@example.test" });
  assert.equal((await call(target, "/today")).status, 200);
  assert.equal((await call(admin, `/admin/people/${target._id}`, "PATCH", { isActive: false })).status, 200);
  assert.equal((await call(target, "/today")).status, 401);
  const grid = await call(admin, "/admin/attendance");
  assert.ok(!grid.people.some((p) => p.user.email === "dev.person@example.test"));
  const all = await call(admin, "/admin/people");
  assert.equal(all.people.find((p) => p.email === "dev.person@example.test").isActive, false);
  assert.equal((await call(admin, `/admin/people/${target._id}`, "PATCH", { isActive: true })).status, 200);
  assert.equal((await call(target, "/today")).status, 200);
});

test("admins cannot lock themselves out, and the last admin is protected", async () => {
  assert.equal((await call(admin, `/admin/people/${admin._id}`, "PATCH", { isActive: false })).status, 403);
  assert.equal((await call(admin, `/admin/people/${admin._id}`, "PATCH", { role: "csm" })).status, 403);
  assert.equal((await call(admin, `/admin/people/${otherAdmin._id}`, "PATCH", { role: "csm" })).status, 200);
  const lone = await UserModel.findById(admin._id);
  const demoted = await UserModel.findOne({ email: "other@example.test" });
  // admin is now the only admin; a second admin trying to remove them is impossible, so promote then demote.
  assert.equal((await call(admin, `/admin/people/${demoted._id}`, "PATCH", { role: "admin" })).status, 200);
  assert.equal((await call(demoted, `/admin/people/${lone._id}`, "PATCH", { isActive: false })).status, 200);
  assert.equal((await call(demoted, `/admin/people/${demoted._id}`, "PATCH", { isActive: false })).status, 403);
  await UserModel.updateOne({ _id: lone._id }, { $set: { isActive: true } });
});

test("reset password returns a new one-time password that replaces the old hash", async () => {
  const target = await UserModel.findOne({ email: "lead@example.test" });
  const before = target.password;
  const reset = await call(admin, `/admin/people/${target._id}/reset-password`, "POST");
  assert.equal(reset.status, 200);
  assert.match(reset.temporaryPassword, /^[A-Za-z0-9]{16}$/);
  const after = await UserModel.findById(target._id).lean();
  assert.notEqual(after.password, before);
  assert.ok(await bcrypt.compare(reset.temporaryPassword, after.password));
  assert.equal((await call(admin, `/admin/people/${new mongoose.Types.ObjectId()}/reset-password`, "POST")).status, 404);
});

test("adding a holiday removes that day from pending and approved leaves, and cancels a leave that is left empty", async () => {
  const { Leave, Settings } = await import("../attendance/models.js");
  await Settings.deleteMany({});
  const start = (() => {
    let d = addDays(dayKey(), 10);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = addDays(d, 1);
    return d;
  })();
  const next = addDays(start, 1);
  const noOff = [0];
  const mk = (extra) => ({ user: lead._id, type: "casual", reason: "test reason", ...extra });
  const [multi, single, half, rejected] = await Leave.create([
    mk({ fromDate: start, toDate: next, days: [start, next], dayCount: 2, status: "approved", payType: "paid" }),
    mk({ fromDate: addDays(start, 5), toDate: addDays(start, 5), days: [addDays(start, 5)], dayCount: 1, status: "pending" }),
    mk({ fromDate: addDays(start, 8), toDate: addDays(start, 8), days: [addDays(start, 8)], dayCount: 0.5, halfDay: true, status: "pending" }),
    mk({ fromDate: addDays(start, 11), toDate: addDays(start, 11), days: [addDays(start, 11)], dayCount: 1, status: "rejected" }),
  ]);
  const holidays = [start, addDays(start, 5), addDays(start, 11)].sort().map((date) => ({ date, name: "Holiday" }));
  const saved = await call(admin, "/admin/settings", "PUT", { weeklyOffDays: noOff, holidays });
  assert.equal(saved.status, 200);
  assert.equal(saved.adjustedLeaves, 2);
  const after = Object.fromEntries((await Leave.find({ _id: { $in: [multi._id, single._id, half._id, rejected._id] } }).lean()).map((l) => [String(l._id), l]));
  assert.deepEqual(after[multi._id].days, [next]);
  assert.equal(after[multi._id].dayCount, 1);
  assert.equal(after[multi._id].status, "approved");
  assert.equal(after[single._id].status, "cancelled");
  assert.match(after[single._id].decisionNote, /holiday/i);
  assert.equal(after[half._id].dayCount, 0.5);
  assert.equal(after[rejected._id].status, "rejected");
  const again = await call(admin, "/admin/settings", "PUT", { weeklyOffDays: noOff, holidays: holidays.slice(0, 1) });
  assert.equal(again.adjustedLeaves, 0);
  assert.deepEqual((await Leave.findById(multi._id).lean()).days, [next]);
});

test("everyone signed in can read upcoming holidays, only admins can change them", async () => {
  const { Settings } = await import("../attendance/models.js");
  await Settings.deleteMany({});
  const soon = addDays(dayKey(), 7);
  const old = addDays(dayKey(), -7);
  assert.equal((await call(lead, "/admin/settings", "PUT", { weeklyOffDays: [0], holidays: [] })).status, 403);
  assert.equal((await call(admin, "/admin/settings", "PUT", { weeklyOffDays: [0, 6], holidays: [{ date: old, name: "Old" }, { date: soon, name: "Founders day" }] })).status, 200);
  const seen = await call(lead, "/holidays");
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.holidays, [{ date: soon, name: "Founders day" }]);
  assert.deepEqual(seen.weeklyOffDays, [0, 6]);
});

test("accounts created before this feature (no designation, joining date or name) keep working", async () => {
  // Raw insert, the way old users look in the collection: none of the new fields exist.
  const legacyId = new mongoose.Types.ObjectId();
  await UserModel.collection.insertOne({ _id: legacyId, email: "legacy@example.test", password: await bcrypt.hash("old-password", 10), role: "team_lead", isActive: true, createdAt: "1/2/2025, 10:00:00 AM", updatedAt: "1/2/2025, 10:00:00 AM" });
  const legacy = await UserModel.findById(legacyId).lean();
  assert.equal((await call(legacy, "/today")).status, 200);
  assert.equal((await call(legacy, "/holidays")).status, 200);
  const people = await call(admin, "/admin/people");
  const row = people.people.find((p) => p.email === "legacy@example.test");
  assert.equal(row.isActive, true);
  assert.equal(row.designation, "");
  assert.equal(row.joinedOn, null);
  const grid = await call(admin, "/admin/attendance");
  const cell = grid.people.find((p) => p.user.email === "legacy@example.test");
  assert.ok(cell, "legacy user is in the grid");
  assert.equal(cell.user.name, "legacy@example.test");
  // The original login still verifies the old password hash.
  assert.ok(await bcrypt.compare("old-password", legacy.password));
  assert.equal((await call(admin, `/admin/people/${legacyId}`, "PATCH", { designation: "Engineer", joinedOn: "2025-01-02" })).status, 200);
});
