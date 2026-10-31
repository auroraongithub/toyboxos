import test from "node:test";
import assert from "node:assert/strict";
import { storedCalls, toolFailed } from "../src/core/ai-calls.js";

const signature = "fixture-opaque-signature/with+padding==";
const call = (id = "config") => ({
  id,
  n: "data",
  a: '{"do":"list","col":"config"}',
  x: { google: { thought_signature: signature } },
});

test("Gemini tool signatures survive normalization and persisted chat history exactly", () => {
  const original = call(),
    saved = JSON.parse(JSON.stringify({ r: "assistant", tc: storedCalls([original], () => "unused") }));
  assert.deepEqual(saved.tc[0], original);
  assert.equal(saved.tc[0].x.google.thought_signature, signature);
});
test("provider metadata stays on its own call during parallel tool requests", () => {
  const first = call("first"),
    second = { id: "second", n: "look", a: '{"window":"money"}' };
  const saved = storedCalls([first, second], () => "unused");
  assert.deepEqual(saved, [first, second]);
  assert.equal(Object.hasOwn(saved[1], "x"), false);
});
test("metadata from all sequential tool steps remains in history", () => {
  const first = call("first"),
    second = { ...call("second"), x: { google: { thought_signature: "second-fixture-signature" } } };
  const history = JSON.parse(
    JSON.stringify([
      { r: "assistant", tc: storedCalls([first], () => "unused") },
      { r: "tool", ti: "first", t: "config result" },
      { r: "assistant", tc: storedCalls([second], () => "unused") },
      { r: "tool", ti: "second", t: "timetable result" },
    ]),
  );
  assert.equal(history[0].tc[0].x.google.thought_signature, signature);
  assert.equal(history[2].tc[0].x.google.thought_signature, "second-fixture-signature");
});
test("ordinary tool calls and default ids/arguments still work", () => {
  assert.deepEqual(
    storedCalls([{ n: "look" }], () => "fixture"),
    [{ id: "call_fixture0", n: "look", a: "{}" }],
  );
  assert.deepEqual(
    storedCalls([{ id: "given", n: "look", a: "{}" }], () => "unused"),
    [{ id: "given", n: "look", a: "{}" }],
  );
});
test("normalization neither mutates incoming calls nor drops future provider metadata", () => {
  const original = {
      n: "look",
      x: { google: { thought_signature: signature }, provider: { state: ["a", "b"] } },
      future: { opaque: "keep" },
    },
    snapshot = structuredClone(original);
  const [saved] = storedCalls([original], () => "fixture");
  assert.deepEqual(original, snapshot);
  assert.deepEqual(saved.x, original.x);
  assert.deepEqual(saved.future, original.future);
});
test("new and previously saved failed tool calls are distinguishable from successful edits", () => {
  assert.equal(toolFailed({ ok: false, t: "Invalid weekdays" }), true);
  assert.equal(toolFailed({ t: "Failed: timetable.days must be weekdays." }), true);
  assert.equal(toolFailed({ t: "Those arguments weren't valid JSON; call again." }), true);
  assert.equal(toolFailed({ ok: true, t: '{"changed":2}' }), false);
  assert.equal(toolFailed({ t: "Alex said no. Nothing was changed." }), false);
  assert.equal(toolFailed(undefined), false);
});
