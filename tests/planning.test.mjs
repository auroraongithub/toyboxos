import test from "node:test";
import assert from "node:assert/strict";
import { budgetUsage, expenseCategory } from "../src/core/budgets.js";
import { classesOn, weekLayout, weekClock, normalizeWeekdays } from "../src/core/schedule.js";

const convert = (amount, currency) => (currency === "USD" ? amount * 58 : amount);
const tx = [
  { type: "out", amt: 250, cur: "PHP", category: "Food", date: "2026-10-01" },
  { type: "out", amt: 5, cur: "USD", category: " food ", date: "2026-10-31" },
  { type: "in", amt: 10000, cur: "PHP", category: "Food", date: "2026-10-01" },
  { type: "out", amt: 100, cur: "PHP", date: "2026-10-15" },
  { type: "out", amt: 900, cur: "PHP", category: "Food", date: "2026-09-30" },
  { type: "out", amt: 900, cur: "PHP", category: "Food", date: "2026-11-01" },
];

test("category limits count this month's expenses across currencies and ignore income", () => {
  assert.deepEqual(budgetUsage({ category: "Food", amt: 500, cur: "PHP" }, tx, "2026-10", convert), {
    spent: 540,
    left: -40,
  });
});
test("overall limits include old uncategorized expenses", () => {
  assert.deepEqual(budgetUsage({ category: "", amt: 1000, cur: "PHP" }, tx, "2026-10", convert), {
    spent: 640,
    left: 360,
  });
  assert.equal(
    budgetUsage({ category: "Uncategorized", amt: 200, cur: "PHP" }, tx, "2026-10", convert).spent,
    100,
  );
});
test("limits can be denominated in USD and start fresh each month", () => {
  assert.equal(budgetUsage({ category: "Food", amt: 10, cur: "USD" }, tx, "2026-10", convert).left, 0.69);
  assert.deepEqual(budgetUsage({ category: "Food", amt: 500, cur: "PHP" }, tx, "2026-12", convert), {
    spent: 0,
    left: 500,
  });
});
test("cent rounding does not falsely mark an exact limit as exceeded", () => {
  const cents = [0.1, 0.2].map(amt => ({ type: "out", amt, cur: "PHP", date: "2026-10-28" }));
  assert.equal(budgetUsage({ amt: 0.3, cur: "PHP" }, cents, "2026-10", convert).left, 0);
});
test("quick spending supports existing and multiword categories without guessing from notes", () => {
  assert.deepEqual(expenseCategory("lunch #food", ["Food"]), { note: "lunch", category: "Food" });
  assert.deepEqual(expenseCategory("#school_supplies notebooks"), {
    note: "notebooks",
    category: "school supplies",
  });
  assert.deepEqual(expenseCategory("lunch"), { note: "lunch", category: "" });
});

const semester = { start: "2026-10-26", end: "2026-11-06" };
const entries = [
  { _id: "late", title: "CS101", days: [1, 3, 5], start: "10:00", end: "11:30", room: "J301" },
  { _id: "early", title: "Math", days: [3], start: "08:00", end: "09:00" },
  { _id: "weekend", title: "PE", days: [0], start: "07:00", end: "08:00" },
];
test("class templates repeat on selected weekdays in chronological order", () => {
  for (const day of ["2026-10-28", "2026-11-04"]) {
    assert.deepEqual(
      classesOn(entries, semester, day).map(x => x._id),
      ["early", "late"],
    );
  }
  assert.deepEqual(classesOn(entries, semester, "2026-10-27"), []);
  assert.equal(classesOn(entries, semester, "2026-11-01")[0]._id, "weekend");
});
test("semester boundaries are inclusive and classes stop outside them", () => {
  assert.equal(classesOn(entries, semester, "2026-10-26").length, 1);
  assert.equal(classesOn(entries, semester, "2026-11-06").length, 1);
  assert.deepEqual(classesOn(entries, semester, "2026-10-25"), []);
  assert.deepEqual(classesOn(entries, semester, "2026-11-09"), []);
  assert.equal(classesOn(entries, null, "2026-10-28").length, 2);
});
test("weekly classes work without dates and honor each optional bound independently", () => {
  assert.equal(classesOn(entries, null, "2026-11-11").length, 2);
  assert.equal(classesOn(entries, { start: "", end: "" }, "2026-11-11").length, 2);
  assert.deepEqual(classesOn(entries, { start: "2026-11-01" }, "2026-10-28"), []);
  assert.equal(classesOn(entries, { start: "2026-11-01" }, "2026-11-11").length, 2);
  assert.deepEqual(classesOn(entries, { end: "2026-11-01" }, "2026-11-04"), []);
});
test("common weekday inputs are explicit while ambiguous or invalid values are rejected", () => {
  assert.deepEqual(normalizeWeekdays("MWF"), [1, 3, 5]);
  assert.deepEqual(normalizeWeekdays("Tuesday and Thursday"), [2, 4]);
  assert.deepEqual(normalizeWeekdays(["Sun", "Sat", 0]), [0, 6]);
  for (const value of ["weekdays", "S", [7], [1.3], [true], [], "[1,3", "", null])
    assert.equal(normalizeWeekdays(value), null);
});
test("class occurrences use Manila time, including midnight", () => {
  const [x] = classesOn([{ title: "Lab", days: [3], start: "00:00", end: "01:00" }], semester, "2026-10-28");
  assert.equal(new Date(x.t).toISOString(), "2026-10-27T16:00:00.000Z");
  assert.equal(x.e - x.t, 3600000);
});

test("weekly grid gives overlapping classes separate lanes and reuses full width afterward", () => {
  const { blocks, start, end } = weekLayout([
    { title: "A", days: [1], start: "08:00", end: "10:00" },
    { title: "B", days: [1], start: "09:00", end: "11:00" },
    { title: "C", days: [1], start: "11:00", end: "12:00" },
    { title: "Evening", days: [5], start: "20:30", end: "21:00" },
  ]);
  assert.equal(start, 420);
  assert.equal(end, 1260);
  const [a, b, c] = blocks.filter(x => x.day === 1);
  assert.equal(a.columns, 2);
  assert.equal(b.columns, 2);
  assert.notEqual(a.lane, b.lane);
  assert.equal(c.columns, 1);
  assert.equal(c.lane, 0);
});
test("live time line uses Manila time and only appears within the semester and displayed hours", () => {
  const clock = weekClock(Date.parse("2026-10-28T02:17:00Z"), semester, 420, 1140);
  assert.equal(clock.minute, 617);
  assert.equal(clock.weekday, 3);
  assert.equal(weekClock(Date.parse("2026-10-28T15:00:00Z"), semester, 420, 1140), null);
  assert.equal(weekClock(Date.parse("2026-11-09T02:00:00Z"), semester, 420, 1140), null);
  assert.equal(weekClock(Date.parse("2026-11-09T02:00:00Z"), null, 420, 1140).minute, 600);
});
