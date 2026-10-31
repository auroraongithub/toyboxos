// The assistant's system prompt must stay byte-stable per pack (prompt caching): Osage's is pinned by hash.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSystem, person } from "../src/core/prompt.js";
import fs from "node:fs";
import plain from "../src/packs/default/ai.js";
const hasOsage = fs.existsSync(new URL("../src/packs/osage/ai.js", import.meta.url));

const sha = s => createHash("sha256").update(s).digest("hex").slice(0, 16);
test("osage prompt unchanged", { skip: !hasOsage }, async () => {
  const osage = (await import("../src/packs/osage/ai.js")).default,
    me = (await import("../src/packs/osage/profile.js")).default;
  assert.equal(sha(buildSystem(osage, person(me))), "5034a721456a6133");
});
test("default pack prompt", () => {
  const s = buildSystem(plain);
  assert.ok(s.startsWith("You are Assistant, living inside"));
  assert.ok(s.includes("\n\nVoice: calm"));
});
test("no persona, plain name", () => {
  const s = buildSystem({ name: "Assistant", persona: "" });
  assert.ok(s.startsWith("You are Assistant, living inside"));
  assert.ok(!s.includes("\n\n\n"));
  assert.ok(s.includes("\n\nHow to work:\n"));
});
test("someone else, they/them", () => {
  const s = buildSystem(plain, person({ name: "Ana", pronouns: "they" }));
  assert.ok(s.includes("Ana's personal OS"));
  assert.ok(s.includes("they ask"));
  assert.ok(!/(Sean|he|his|him)/.test(s));
});
