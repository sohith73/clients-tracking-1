import { HttpError } from "./http.js";
export const toPublicUser = (user) => ({
  id: String(user._id),
  name: user.name || user.email,
  email: user.email,
  role: user.role,
  designation: user.designation || "",
  isActive: user.isActive,
});
export async function requireUser(request) {
  return request.user;
}
export async function requireAdmin(request) {
  if (request.user.role !== "admin")
    throw new HttpError(403, "Only admins can do this");
  return request.user;
}
