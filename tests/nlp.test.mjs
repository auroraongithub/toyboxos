import test from "node:test";
import assert from "node:assert/strict";
import { when } from "../src/core/nlp.js";

test("a trailing 'at' with nothing after it is not a crash", () => {
  for (const s of ["frontend dev at", "meet at", "call mom at "]) assert.doesNotThrow(() => when(s), s);
});

test("times after 'at' still read", () => {
  assert.equal(when("dinner at 7pm").time, "19:00");
});
