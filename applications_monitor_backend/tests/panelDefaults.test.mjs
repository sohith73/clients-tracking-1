// Panel-login defaults for the autopilot (added 2026-11-06).
//
// A client with JobRight creds but no panel login stopped every run at
// "Panel login needed" (Sreyashi Chatterjee, 2026-11-06). Marking JobRight Yes
// now also fills the panel half with the team defaults. The guarantee that
// matters: only BLANK fields are written. A client's own panel password must
// never be overwritten by a re-toggle.
//
// Functions are lifted out of index.js by brace matching (same approach as
// fetchJrCreds.test.mjs), because index.js connects to Mongo on import.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");

function lift(name) {
  const at = src.indexOf(`async function ${name}(`);
  assert.ok(at > 0, `${name} must exist in index.js`);
  let depth = 0, started = false;
  for (let i = src.indexOf("{", at); i < src.length; i += 1) {
    if (src[i] === "{") { depth += 1; started = true; }
    else if (src[i] === "}") { depth -= 1; if (started && depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(`could not brace-match ${name}`);
}

const dir = mkdtempSync(join(tmpdir(), "ff-paneldefaults-"));

async function load(base) {
  const mod = join(dir, `m${Date.now()}${Math.random()}.mjs`);
  writeFileSync(mod, `
const FLASHFIRE_API_BASE_URL = ${JSON.stringify(base)};
const FLASHFIRE_OPS_KEY = "k";
const DEFAULT_PANEL_PASSWORD = "flashfire@123";
const DEFAULT_PANEL_CODE = "00000";
${lift("fetchAutopilotJrCreds")}
${lift("saveAutopilotCreds")}
${lift("fillPanelDefaults")}
export { fillPanelDefaults, fetchAutopilotJrCreds };
`);
  return import(pathToFileURL(mod).href);
}

/** Fake dashboard credential store: GET returns `record` (or 404), PUT records the body. */
async function store(record) {
  const puts = [];
  const server = createServer((req, res) => {
    if (req.method === "GET") {
      if (!record) { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: true, data: record }));
    }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      puts.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, puts, close: () => new Promise((r) => server.close(r)) };
}

test("fills every panel field when none is saved", async () => {
  const s = await store({ jrEmail: "c@example.com", jrPassword: "Jobhunt@2026" });
  try {
    const { fillPanelDefaults } = await load(s.base);
    const out = await fillPanelDefaults("c@example.com", "test");
    assert.equal(out.ok, true);
    assert.deepEqual(out.filled.sort(), ["extCode", "extEmail", "extPassword"]);
    assert.equal(s.puts.length, 1);
    assert.equal(s.puts[0].extEmail, "c@example.com");
    assert.equal(s.puts[0].extPassword, "flashfire@123");
    assert.equal(s.puts[0].extCode, "00000");
  } finally { await s.close(); }
});

test("never overwrites a saved panel password or code", async () => {
  const s = await store({ jrEmail: "c@example.com", extEmail: "", extPassword: "client-own-pw", extCode: "54321" });
  try {
    const { fillPanelDefaults } = await load(s.base);
    const out = await fillPanelDefaults("c@example.com", "test");
    assert.deepEqual(out.filled, ["extEmail"]);
    assert.equal(s.puts.length, 1);
    assert.equal(s.puts[0].extPassword, undefined, "a saved password must not be sent");
    assert.equal(s.puts[0].extCode, undefined, "a saved code must not be sent");
  } finally { await s.close(); }
});

test("writes nothing when the panel login is already complete", async () => {
  const s = await store({ extEmail: "c@example.com", extPassword: "pw", extCode: "11111" });
  try {
    const { fillPanelDefaults } = await load(s.base);
    const out = await fillPanelDefaults("c@example.com", "test");
    assert.deepEqual(out, { ok: true, filled: [], message: "" });
    assert.equal(s.puts.length, 0);
  } finally { await s.close(); }
});

test("a client with no row at all gets the defaults", async () => {
  const s = await store(null);
  try {
    const { fillPanelDefaults } = await load(s.base);
    const out = await fillPanelDefaults("c@example.com", "test");
    assert.equal(out.ok, true);
    assert.equal(out.filled.length, 3);
  } finally { await s.close(); }
});

test("readiness needs both halves, and the code is only exposed on request", async () => {
  const s = await store({ jrEmail: "c@example.com", jrPassword: "x", extEmail: "", extPassword: "", extCode: "00000" });
  try {
    const { fetchAutopilotJrCreds } = await load(s.base);
    const plain = await fetchAutopilotJrCreds("c@example.com");
    assert.equal(plain.creds.jrReady, true);
    assert.equal(plain.creds.panelReady, false);
    assert.equal(plain.creds.autoLoginReady, false);
    assert.equal(plain.creds.hasExtCode, true);
    assert.equal("extCode" in plain.creds, false, "the operator code must not reach the browser");
    const withCode = await fetchAutopilotJrCreds("c@example.com", true);
    assert.equal(withCode.creds.extCode, "00000");
  } finally { await s.close(); }
});
