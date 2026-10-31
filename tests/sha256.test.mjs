import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256js } from "../src/core/sha256.js";

const node = b => createHash("sha256").update(b).digest("hex");

test("matches node across block boundaries", () => {
  for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 4096]) {
    const b = new Uint8Array(n).map((_, i) => (i * 31 + n) & 255);
    assert.equal(sha256js(b), node(b), "length " + n);
  }
});

test("known vector", () => {
  assert.equal(
    sha256js(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("a pack-sized file", () => {
  const b = new Uint8Array(3 << 20).map((_, i) => (i ^ (i >> 8)) & 255);
  assert.equal(sha256js(b.buffer), node(b));
});
