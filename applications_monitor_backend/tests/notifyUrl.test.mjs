import { test } from "node:test";
import assert from "node:assert/strict";
import { appUrl } from "../attendance/notify.js";

const KEYS = ["APP_URL", "FRONTEND_URL", "CORS_ORIGIN"];
function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  }
}

test("email links point at the frontend, never the API host", () => {
  assert.equal(withEnv({}, () => appUrl()), "https://dashboardtracking.vercel.app");
  assert.equal(withEnv({ CORS_ORIGIN: "https://portal.example.test, https://x.test" }, () => appUrl()), "https://portal.example.test");
  assert.equal(withEnv({ CORS_ORIGIN: "https://portal.example.test", FRONTEND_URL: "https://front.example.test/" }, () => appUrl()), "https://front.example.test");
  assert.equal(withEnv({ FRONTEND_URL: "https://front.example.test", APP_URL: "https://app.example.test" }, () => appUrl()), "https://app.example.test");
});
