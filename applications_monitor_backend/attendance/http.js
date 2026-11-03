import { ZodError } from "zod";
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const ok = (data, status = 200) => ({ data, status });
export const readJson = async (request, schema) => schema.parse(request.body);
export function route(handler) {
  return async (req, res) => {
    try {
      req.nextUrl = new URL(req.originalUrl, "http://attendance.local");
      const result = await handler(req, { params: req.params });
      res.status(result.status).json(result.data);
    } catch (error) {
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof ZodError)
        return res
          .status(422)
          .json({ error: error.issues[0]?.message || "Invalid input" });
      if (error.code === 11000)
        return res
          .status(409)
          .json({ error: "A conflicting record already exists" });
      console.error("[attendance]", error);
      res.status(500).json({ error: "Unable to complete attendance request" });
    }
  };
}
