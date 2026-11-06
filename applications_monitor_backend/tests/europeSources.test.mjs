// Choosing Europe as a client's country turns on Indeed, Glassdoor and
// HiringCafe (2026-11-06). Lifted out of index.js by brace matching, because
// index.js connects to Mongo on import.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
const enableEuropeSources = new Function(
  `const EUROPE_SOURCES = ['indeed', 'glassdoor', 'hiringcafe']; return ${lift("enableEuropeSources")};`
)();

function fakeProfile(doc) {
  const writes = [];
  return {
    writes,
    collection: {
      findOne: async () => doc,
      updateOne: async (filter, update) => { writes.push([filter, update]); },
    },
  };
}

test("adds the three boards to what is already ticked", async () => {
  const P = fakeProfile({ scrapeSources: ["jobright", "reed"] });
  assert.deepEqual(await enableEuropeSources(P, "a@x.com"),
    ["jobright", "reed", "indeed", "glassdoor", "hiringcafe"]);
  assert.deepEqual(P.writes[0][1], { $set: { scrapeSources: ["jobright", "reed", "indeed", "glassdoor", "hiringcafe"] } });
});

test("no saved list means JobRight plus the three", async () => {
  const P = fakeProfile({});
  assert.deepEqual(await enableEuropeSources(P, "a@x.com"), ["jobright", "indeed", "glassdoor", "hiringcafe"]);
});

test("already on: no write", async () => {
  const P = fakeProfile({ scrapeSources: ["hiringcafe", "indeed", "glassdoor"] });
  await enableEuropeSources(P, "a@x.com");
  assert.equal(P.writes.length, 0);
});

test("no dashboard profile yet: null, nothing written", async () => {
  const P = fakeProfile(null);
  assert.equal(await enableEuropeSources(P, "a@x.com"), null);
  assert.equal(P.writes.length, 0);
});
