import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { UserModel } from "../UserModel.js";

export async function requireActiveUser(req, res, next) {
  let claims;
  try {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    claims = jwt.verify(token || "", process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Sign in to continue" });
  }
  if (!mongoose.isValidObjectId(claims.userId))
    return res.status(401).json({ error: "Invalid session" });
  try {
    const user = await UserModel.findById(claims.userId).lean();
    if (!user?.isActive)
      return res
        .status(401)
        .json({ error: "Your session has ended. Sign in again." });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function verifyAdmin(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Only admins can do this" });
  next();
}
