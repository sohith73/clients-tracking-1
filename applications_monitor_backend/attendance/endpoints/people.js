import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { HttpError, ok, readJson, route } from "../http.js";
import { User } from "../models.js";
import { isDayKey } from "../time.js";

export const PORTAL_ROLES = ["admin", "team_lead", "operations_intern", "onboarding_team", "csm", "bda"];
const ONBOARDING_SUB_ROLES = ["resume_maker", "linkedin_and_cover_letter_optimization"];
const stamp = () => new Date().toLocaleString("en-US", "Asia/Kolkata");

const email = z
  .string({ error: "Enter an email address" })
  .trim()
  .toLowerCase()
  .email({ error: "Enter a valid email address" });
const name = z.string({ error: "Enter a name" }).trim().min(2, { error: "Enter the full name" }).max(80);
const designation = z.string().trim().max(60, { error: "Keep the designation under 60 characters" });
const joinedOn = z
  .string()
  .refine(isDayKey, { error: "Pick a valid joining date" })
  .nullable();
const role = z.enum(PORTAL_ROLES, { error: "Choose a role" });
const subRole = z.enum(ONBOARDING_SUB_ROLES).nullable();

const createBody = z.object({
  name,
  email,
  otpEmail: email.or(z.literal("")).optional(),
  role,
  designation: designation.default(""),
  joinedOn: joinedOn.optional(),
  onboardingSubRole: subRole.optional(),
});

const patchBody = z
  .object({
    name,
    otpEmail: email.or(z.literal("")),
    role,
    designation,
    joinedOn,
    onboardingSubRole: subRole,
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to change" });

/** Readable 16-char password without look-alike characters. Shown to the admin once, stored only as a hash. */
function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export const toPerson = (user) => ({
  id: String(user._id),
  name: user.name || "",
  email: user.email,
  otpEmail: user.otpEmail || "",
  role: user.role,
  designation: user.designation || "",
  joinedOn: user.joinedOn || null,
  onboardingSubRole: user.onboardingSubRole ?? null,
  isActive: user.isActive !== false,
  createdAt: user._id.getTimestamp().toISOString(),
});

async function findPerson(id) {
  if (!isValidObjectId(id)) throw new HttpError(404, "Person not found");
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, "Person not found");
  return user;
}

export const GET = route(async (request) => {
  await requireAdmin(request);
  const users = await User.find({}).sort({ isActive: -1, name: 1, email: 1 }).lean();
  return ok({ people: users.map(toPerson) });
});

export const POST = route(async (request) => {
  await requireAdmin(request);
  const input = await readJson(request, createBody);
  if (await User.exists({ email: input.email })) throw new HttpError(409, "Someone with this email already exists");
  const password = temporaryPassword();
  const user = await User.create({
    email: input.email,
    password: await bcrypt.hash(password, 10),
    role: input.role,
    name: input.name,
    designation: input.designation,
    joinedOn: input.joinedOn ?? null,
    otpEmail: input.otpEmail || "",
    ...(input.role === "onboarding_team" ? { onboardingSubRole: input.onboardingSubRole ?? "resume_maker" } : {}),
    isActive: true,
    updatedAt: stamp(),
  });
  return ok({ person: toPerson(user), temporaryPassword: password }, 201);
});

export const PATCH = route(async (request, ctx) => {
  const admin = await requireAdmin(request);
  const { id } = await ctx.params;
  const input = await readJson(request, patchBody);
  const user = await findPerson(id);
  const isSelf = String(user._id) === String(admin._id);

  const losesAdmin = user.role === "admin" && user.isActive !== false && (input.isActive === false || (input.role && input.role !== "admin"));
  if (isSelf && input.isActive === false) throw new HttpError(403, "You cannot turn off your own account");
  if (isSelf && input.role && input.role !== "admin") throw new HttpError(403, "You cannot remove your own admin access");
  if (losesAdmin) {
    const others = await User.countDocuments({ role: "admin", isActive: { $ne: false }, _id: { $ne: user._id } });
    if (others === 0) throw new HttpError(409, "This is the last active admin");
  }

  const set = { updatedAt: stamp() };
  for (const key of ["name", "designation", "joinedOn", "isActive"]) if (input[key] !== undefined) set[key] = input[key];
  if (input.otpEmail !== undefined) set.otpEmail = input.otpEmail;
  const nextRole = input.role ?? user.role;
  if (input.role) set.role = input.role;
  if (nextRole === "onboarding_team") {
    const sub = input.onboardingSubRole ?? user.onboardingSubRole ?? "resume_maker";
    set.onboardingSubRole = sub;
  } else if (input.role) {
    set.onboardingSubRole = null;
  }

  const updated = await User.findByIdAndUpdate(user._id, { $set: set }, { new: true, runValidators: true });
  return ok({ person: toPerson(updated) });
});

export const RESET_PASSWORD = route(async (request, ctx) => {
  await requireAdmin(request);
  const { id } = await ctx.params;
  const user = await findPerson(id);
  const password = temporaryPassword();
  await User.updateOne({ _id: user._id }, { $set: { password: await bcrypt.hash(password, 10), updatedAt: stamp() } });
  return ok({ person: toPerson(user), temporaryPassword: password });
});
