import test from "node:test";
import assert from "node:assert/strict";
import { capabilities, planChanges } from "../src/core/workspace.js";
import { D } from "../src/core/store.js";

/* money defaults come from the home currency: pin it to PHP so the result is the same whichever pack the build uses */
D.config = [
  ...(D.config || []).filter(x => x._id !== "profile"),
  { _id: "profile", cur: "PHP", cur2: "USD" },
];

const options = { uid: () => "generated-id", stamp: "2026-10-28T02:00:00.000Z" };
const add = (col, fields, id) => ({ op: "add", col, fields, id });
const update = (col, id, fields) => ({ op: "update", col, id, fields });
const del = (col, id) => ({ op: "delete", col, id });
const plan = (changes, state = {}) => planChanges(changes, state, options);
const apply = (state, ops) => {
  const next = structuredClone(state);
  for (const [op, col, id, doc] of ops) {
    next[col] = (next[col] || []).filter(x => x._id !== id);
    if (op === "set") next[col].push({ _id: id, ...doc });
  }
  return next;
};
const ordered = state =>
  Object.fromEntries(
    Object.entries(state).map(([col, rows]) => [
      col,
      rows.slice().sort((a, b) => a._id.localeCompare(b._id)),
    ]),
  );

test("capabilities cover the app and expose exact schemas on demand", () => {
  for (const col of [
    "tasks",
    "tx",
    "budgets",
    "timetable",
    "pages",
    "rels",
    "ink",
    "graphs",
    "habits",
    "reminders",
  ])
    assert.ok(capabilities().collections.some(x => x.col === col));
  assert.equal(capabilities("timetable").fields.days.type, "array");
  assert.deepEqual(capabilities("timetable").fields.days.items.enum, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(JSON.parse(capabilities("timetable").write_example.fields).days, [1, 3, 5]);
  assert.equal(capabilities("config").label.includes("semester"), true);
});
test("one batch creates related project/tasks, expenses and budgets with defaults", () => {
  const p = plan([
    add("projects", { name: "Portfolio" }, "proj"),
    add("tasks", { title: "Finish homepage", proj: "Portfolio" }, "task"),
    add("tx", { type: "out", amt: 250, date: "2026-10-28", category: "Food" }, "lunch"),
    add("budgets", { category: "Food", amt: 3000 }, "food"),
  ]);
  assert.equal(p.ops.length, 4);
  assert.equal(p.ops.find(x => x[2] === "task")[3].col, "todo");
  assert.equal(p.ops.find(x => x[2] === "lunch")[3].cur, "PHP");
  assert.equal(
    p.undo.every(x => x[0] === "del"),
    true,
  );
});
test("invalid item rejects a whole batch before any state is changed", () => {
  const state = { tasks: [{ _id: "t1", title: "Existing", col: "todo" }] },
    before = structuredClone(state);
  assert.throws(
    () =>
      plan(
        [update("tasks", "t1", { col: "doing" }), add("tx", { type: "out", amt: -2, date: "2026-10-28" })],
        state,
      ),
    /positive/,
  );
  assert.deepEqual(state, before);
});
test("semester dates and a complete weekly timetable can be imported together", () => {
  const p = plan([
    add("config", { name: "Semester 2", start: "2026-10-26", end: "2027-03-26" }, "semester"),
    add(
      "timetable",
      JSON.stringify({ title: "CS101", days: [3, 1, 3], start: "07:30", end: "09:00", room: "J301" }),
      "cs",
    ),
  ]);
  assert.deepEqual(p.ops[1][3].days, [1, 3]);
  assert.equal(p.ops[1][3].room, "J301");
});
test("schedule retries skip existing identical classes", () => {
  const entry = { _id: "cs", title: "CS101", days: [1, 3], start: "07:30", end: "09:00", room: "J301" };
  const p = plan(
    [add("timetable", { title: "cs101", days: [3, 1], start: "07:30", end: "09:00", room: "J301" })],
    { timetable: [entry] },
  );
  assert.equal(p.ops.length, 0);
  assert.equal(p.result[0].id, "cs");
  assert.equal(p.result[0].op, "unchanged");
});
test("invalid weekdays, ambiguous times and impossible semester dates are rejected", () => {
  assert.throws(
    () => plan([add("timetable", { title: "Lab", days: [7], start: "09:00", end: "10:00" })]),
    /weekday numbers/,
  );
  assert.throws(
    () => plan([add("timetable", { title: "Lab", days: [1], start: "9am", end: "10:00" })]),
    /time/,
  );
  assert.throws(
    () => plan([add("timetable", { title: "Lab", days: [1], start: "10:00", end: "09:00" })]),
    /end/,
  );
  assert.throws(() => plan([add("config", { start: "2026-02-30", end: "2026-06-01" }, "semester")]), /date/);
});
test("AI weekday names and encoded lists normalize to canonical weekday arrays", () => {
  for (const days of [[1, 3], ["1", "3"], ["Monday", "Wednesday"], "[1,3]", "1,3", "Mon/Wed"]) {
    const p = plan([add("timetable", { title: "CS101", days, start: "09:00", end: "10:00" })]);
    assert.deepEqual(p.ops[0][3].days, [1, 3]);
  }
  assert.throws(
    () => plan([add("timetable", { title: "Bad", days: "weekdays", start: "09:00", end: "10:00" })]),
    /\[1,3,5\]/,
  );
});
test("undated timetables need no semester config, and dates can be cleared explicitly", () => {
  const p = plan([add("timetable", { title: "Lab", days: "TTh", start: "09:00", end: "10:30" })]);
  assert.equal(
    p.ops.some(x => x[1] === "config"),
    false,
  );
  assert.deepEqual(p.ops[0][3].days, [2, 4]);
  const state = { config: [{ _id: "semester", name: "Current", start: "2026-10-01", end: "2026-12-01" }] };
  const cleared = plan([update("config", "semester", { start: "", end: "" })], state);
  assert.equal(cleared.ops[0][3].start, "");
  assert.equal(cleared.ops[0][3].end, "");
});
test("internal settings, unknown fields and Moodle feed records cannot be overwritten", () => {
  assert.throws(() => plan([add("config", { start: "2026-10-01", end: "2026-12-01" }, "osage")]), /semester/);
  assert.throws(() => plan([add("tasks", { title: "X", _u: 1 })]), /unknown field/);
  assert.throws(() => plan([add("classes", { title: "Replace deadline" })]), /collection/);
  assert.throws(() => plan([add("chats", { title: "Overwrite history" })]), /collection/);
});
test("Moodle completion uses ticks with an existing deadline ID", () => {
  assert.throws(() => plan([add("ticks", { done: true }, "nope")]), /Moodle/);
  const p = plan([add("ticks", { done: true }, "m1")], { classes: [{ _id: "m1", title: "Quiz" }] });
  assert.equal(p.ops[0][1], "ticks");
  assert.equal(p.ops[0][2], "m1");
});
test("renaming a page rewrites backlinks and the entire batch can be undone", () => {
  const state = {
    pages: [
      { _id: "a", title: "Old", body: "", parent: "" },
      { _id: "b", title: "Other", body: "See [[Old]]", parent: "" },
    ],
  };
  const p = plan([update("pages", "a", { title: "New" })], state),
    next = apply(state, p.ops);
  assert.equal(next.pages.find(x => x._id === "b").body, "See [[New]]");
  assert.deepEqual(ordered(apply(next, p.undo)), ordered(state));
});
test("deleting a page detaches children and removes its connections, with Undo", () => {
  const state = {
    pages: [
      { _id: "a", title: "Parent" },
      { _id: "b", title: "Child", parent: "a" },
    ],
    rels: [{ _id: "r", a: "a", b: "b", label: "part of" }],
  };
  const p = plan([del("pages", "a")], state),
    next = apply(state, p.ops);
  assert.equal(next.pages[0].parent, "");
  assert.equal(next.rels.length, 0);
  assert.deepEqual(ordered(apply(next, p.undo)), ordered(state));
});
test("page parent cycles and broken connections are rejected", () => {
  const state = {
    pages: [
      { _id: "a", title: "A" },
      { _id: "b", title: "B", parent: "a" },
    ],
  };
  assert.throws(() => plan([update("pages", "a", { parent: "b" })], state), /itself/);
  assert.throws(() => plan([add("rels", { a: "a", b: "missing" })], state), /existing pages/);
});
test("renaming a project preserves its task grouping", () => {
  const p = plan([update("projects", "p", { name: "New" })], {
    projects: [{ _id: "p", name: "Old" }],
    tasks: [{ _id: "t", title: "Task", proj: "Old" }],
  });
  assert.equal(p.ops.find(x => x[1] === "tasks")[3].proj, "New");
});
test("deleting a whiteboard also removes its ink and captures both for Undo", () => {
  const p = plan([del("boards", "b")], {
    boards: [{ _id: "b", title: "Board" }],
    ink: [{ _id: "i", b: "b", t: "x", s: "Hello" }],
  });
  assert.equal(p.ops.filter(x => x[0] === "del").length, 2);
  assert.equal(p.undo.length, 2);
});
test("existing unrelated broken relationships do not block expense logging", () => {
  const p = plan([add("tx", { type: "out", amt: 50, date: "2026-10-28" })], {
    pages: [{ _id: "p", parent: "old-missing-page" }],
  });
  assert.equal(p.ops.length, 1);
});
test("overwriting an existing budget category is explicit, not a duplicate", () => {
  assert.throws(
    () =>
      plan([add("budgets", { category: "food", amt: 1000 })], {
        budgets: [{ _id: "food", category: "Food", amt: 500, cur: "PHP" }],
      }),
    /already has/,
  );
});
test("whiteboard text and saved graphs can be created using the same batch tool", () => {
  const p = plan([
    add("boards", { title: "Study plan" }, "board"),
    add("ink", { b: "board", t: "x", x: 20, y: 30, s: "Review chapter 1" }, "text"),
    add("graphs", { title: "Quadratic", rows: [{ id: "r1", t: "y=x^2" }] }, "graph"),
  ]);
  assert.equal(p.ops.find(x => x[1] === "ink")[3].f, 18);
  assert.equal(p.ops.find(x => x[1] === "graphs")[3].view.k, 50);
});
test("malformed shapes and graph scales are rejected before they can break their tools", () => {
  assert.throws(() => plan([add("ink", { b: "board", t: "r", x: 0, y: 0 })]), /needs w, h/);
  assert.throws(
    () => plan([add("graphs", { title: "Bad", rows: [{ id: "r1", t: "x" }], view: { cx: 0, cy: 0, k: 0 } })]),
    /positive k/,
  );
});
test("calendar instants need an explicit timezone and real date", () => {
  assert.throws(() => plan([add("events", { title: "Quiz", start: "2026-10-28T10:00:00" })]), /instant/);
  assert.throws(() => plan([add("events", { title: "Quiz", start: "2026-02-30T10:00:00Z" })]), /instant/);
  assert.equal(plan([add("events", { title: "Quiz", start: "2026-10-28T10:00:00+08:00" })]).ops.length, 1);
});
test("loans validate, default to I-owe in PHP, and reject a bad due date", () => {
  const d = plan([add("loans", { name: "Tala", amt: 2480, due: "2026-12-27" })]).ops[0][3];
  assert.equal(d.dir, "owe");
  assert.equal(d.cur, "PHP");
  assert.equal(d.paid, false);
  assert.throws(() => plan([add("loans", { name: "Tala", amt: 2480, due: "soon" })]), /date/i);
  assert.throws(() => plan([add("loans", { name: "Tala", amt: 0 })]), /amt/);
});
