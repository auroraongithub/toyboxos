/* Osage's app-data contract. No credentials or arbitrary preferences are writable here. */
import { renameLinks } from "./md.js";
import { today } from "./lib.js";
import { home, second, profile } from "./profile.js";
import { person } from "./prompt.js";
/* money fields take the profile's two currencies (getters: the profile can change after load) */
/* the user's name as the pack knows it when this loads (the AI reads these labels) */
const WHO = person(profile()).name;
const curEnum = () => [home(), second()].filter(Boolean).join("|");
import { normalizeWeekdays } from "./schedule.js";

import BRANDS from "../data/brands.js";

const brandSlug = n => {
  const q = String(n || "")
    .trim()
    .toLowerCase();
  return Object.keys(BRANDS).find(k => k === q || BRANDS[k].t.toLowerCase() === q) || "";
};
const spec = (label, fields, required = [], defaults = {}) => ({ label, fields, required, defaults });
export const WORKSPACE = {
  projects: spec("Board projects", { name: "text" }, ["name"]),
  tasks: spec(
    "Board tasks; proj is a project NAME",
    { title: "text", proj: "text", col: "todo|doing|done" },
    ["title"],
    { proj: "", col: "todo" },
  ),
  events: spec(
    "Personal calendar events",
    {
      title: "text",
      start: "instant",
      end: "optional instant",
      allDay: "boolean",
      tag: "text",
      done: "boolean",
      remind: "number",
    },
    ["title", "start"],
    { allDay: false, done: false, tag: "" },
  ),
  reminders: spec(
    "Reminders and alarms; at is the ringing time; prefer quick for natural-language scheduling",
    { title: "text", at: "instant", loud: "boolean", repeat: "|daily|weekly|weekdays", done: "boolean" },
    ["title", "at"],
    { loud: false, repeat: "", done: false },
  ),
  tx: spec(
    "Income and expenses",
    {
      type: "in|out",
      amt: "positive",
      get cur() {
        return curEnum();
      },
      note: "text",
      category: "text",
      date: "date",
    },
    ["type", "amt", "date"],
    {
      get cur() {
        return home();
      },
      note: "",
      category: "",
    },
  ),
  budgets: spec(
    "Recurring monthly limits; blank category = all spending",
    {
      category: "text",
      amt: "positive",
      get cur() {
        return curEnum();
      },
    },
    ["amt"],
    {
      category: "",
      get cur() {
        return home();
      },
    },
  ),
  subs: spec(
    "Subscriptions",
    {
      name: "text",
      slug: "text",
      amt: "nonnegative",
      get cur() {
        return curEnum();
      },
      cycle: "mo|yr",
      next: "date",
    },
    ["name", "amt", "next"],
    {
      get cur() {
        return home();
      },
      cycle: "mo",
      slug: "",
    },
  ),
  loans: spec(
    `Loans: dir owe = ${WHO} owes it, owed = someone owes ${WHO}; due = YYYY-MM-DD (blank = none). Unpaid loans with a due date remind 3 and 1 days before`,
    {
      name: "text",
      amt: "positive",
      get cur() {
        return curEnum();
      },
      dir: "owe|owed",
      due: "optional date",
      paid: "boolean",
    },
    ["name", "amt"],
    {
      get cur() {
        return home();
      },
      dir: "owe",
      due: "",
      paid: false,
    },
  ),
  wishes: spec(
    "Wishlist",
    {
      name: "text",
      price: "nonnegative",
      get cur() {
        return curEnum();
      },
      link: "text",
      got: "boolean",
      star: "boolean",
    },
    ["name", "price"],
    {
      get cur() {
        return home();
      },
      link: "",
      got: false,
      star: false,
    },
  ),
  habits: spec(
    "Habits; days contains completed YYYY-MM-DD dates",
    { name: "text", days: "dates" },
    ["name"],
    { days: [] },
  ),
  links: spec("Saved links", { name: "text", url: "url" }, ["name", "url"]),
  jots: spec("Inbox jots", { text: "text" }, ["text"]),
  pages: spec(
    "Notes and subjects; use write_page/add_cards for body/deck edits",
    {
      title: "text",
      body: "text",
      kind: "note|subject|person|company|place|thing",
      icon: "text",
      parent: "text",
      props: "pairs",
      deck: "cards",
      pin: "boolean",
    },
    ["title"],
    { body: "", kind: "note", icon: "", parent: "", props: [], pin: false },
  ),
  rels: spec(
    "Connections between pages; a and b are page IDs",
    { a: "text", b: "text", label: "text" },
    ["a", "b"],
    { label: "" },
  ),
  boards: spec("Whiteboards", { title: "text" }, ["title"]),
  ink: spec(
    "Whiteboard text/notes/shapes; b is board ID; x/y coordinates, f font size, l line width; r/e use w/h, l/a use u/v",
    {
      b: "text",
      t: "x|n|r|e|l|a",
      x: "number",
      y: "number",
      s: "text",
      f: "positive",
      l: "positive",
      w: "positive",
      h: "positive",
      u: "number",
      v: "number",
      c: "colour",
      o: "number",
    },
    ["b", "t", "x", "y"],
    { c: "", l: 2, f: 18, o: 0 },
  ),
  graphs: spec(
    "Saved calculator graphs; row = {id,t} expression, vars = sliders, view = {cx,cy,k}",
    { title: "text", rows: "rows", vars: "object", view: "object", tbl: "object" },
    ["title", "rows"],
    { vars: {}, view: { cx: 0, cy: 0, k: 50 }, tbl: { id: "", x0: 0, dx: 1 } },
  ),
  timetable: spec(
    "Weekly classes, NOT Moodle deadlines; days = 0 Sun .. 6 Sat, times = HH:MM",
    { title: "text", room: "text", days: "weekdays", start: "time", end: "time" },
    ["title", "days", "start", "end"],
    { room: "" },
  ),
  config: spec(
    "Only config/semester is writable. Dates are optional; blank dates = an ongoing weekly schedule. Never invent semester dates.",
    { name: "text", start: "optional date", end: "optional date" },
    [],
    { name: "", start: "", end: "" },
  ),
  ticks: spec("Moodle completion only; id must be the existing Moodle class ID", { done: "boolean" }, [
    "done",
  ]),
  jobs: spec(
    "Job leads and applications; skip = closed (rejected, withdrawn or skipped)",
    {
      title: "text",
      fit: "number",
      pay: "text",
      type: "text",
      posted: "text",
      why: "text",
      flags: "strings",
      url: "text",
      company: "text",
      notes: "text",
      status: "new|saved|applied|interview|offer|skip",
      statusAt: "instant",
    },
    ["title"],
    { status: "new", flags: [] },
  ),
  pomos: spec("Logged focus sessions", { mins: "positive", label: "text" }, ["mins"], { label: "" }),
};
const key = s =>
  String(s || "")
    .trim()
    .toLowerCase();
const object = x => !!x && typeof x === "object" && !Array.isArray(x);
const date = x =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) &&
  new Date(x + "T00:00:00Z").toISOString().slice(0, 10) === x;
const finite = x => typeof x === "number" && Number.isFinite(x);
function valid(value, type) {
  if (type.includes("|")) return type.split("|").includes(value);
  switch (type) {
    case "text":
      return typeof value === "string" && value.length <= 400000;
    case "number":
      return finite(value);
    case "positive":
      return finite(value) && value > 0;
    case "nonnegative":
      return finite(value) && value >= 0;
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return date(value);
    case "optional date":
      return value === "" || date(value);
    case "time":
      return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    case "optional instant":
      if (value === "") return true; // fall through
    case "instant":
      return (
        typeof value === "string" &&
        date(value.slice(0, 10)) &&
        /^\d{4}-\d{2}-\d{2}T/.test(value) &&
        /(Z|[+-]\d{2}:\d{2})$/.test(value) &&
        Number.isFinite(Date.parse(value))
      );
    case "url":
      return typeof value === "string" && /^https?:\/\/[^\s]+$/i.test(value);
    case "colour":
      return (
        value === "" ||
        (typeof value === "string" && /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
      );
    case "object":
      return object(value);
    case "weekdays":
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= 7 &&
        value.every(x => Number.isInteger(x) && x >= 0 && x <= 6)
      );
    case "dates":
      return Array.isArray(value) && value.every(date);
    case "strings":
      return Array.isArray(value) && value.every(x => typeof x === "string");
    case "pairs":
      return (
        Array.isArray(value) &&
        value.every(x => Array.isArray(x) && x.length === 2 && x.every(v => typeof v === "string"))
      );
    case "cards":
      return (
        Array.isArray(value) &&
        value.every(x => object(x) && typeof x.q === "string" && typeof x.a === "string")
      );
    case "rows":
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(x => object(x) && typeof x.id === "string" && typeof x.t === "string")
      );
  }
  return false;
}
function fieldsFor(col, raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!object(parsed)) throw new Error("fields must be a JSON object.");
  const fields = { ...parsed };
  if (col === "timetable" && Object.hasOwn(fields, "days")) {
    fields.days = normalizeWeekdays(fields.days);
    if (!fields.days)
      throw new Error(
        'timetable.days needs weekday numbers: [1,3,5] = Mon/Wed/Fri, [2,4] = Tue/Thu, 0 = Sun, 6 = Sat. Send an array, e.g. {"days":[1,3,5]}; day names are also accepted.',
      );
  }
  const schema = WORKSPACE[col];
  for (const [name, value] of Object.entries(fields)) {
    if (!Object.hasOwn(schema.fields, name))
      throw new Error(col + ": unknown field " + name + ". Use capabilities first.");
    if (!valid(value, schema.fields[name]))
      throw new Error(col + "." + name + " must be " + schema.fields[name] + ".");
  }
  return fields;
}
export function capabilities(col, state = {}) {
  if (col) {
    if (!Object.hasOwn(WORKSPACE, col)) return { error: "No writable schema for " + col };
    const result = {
      collection: col,
      ...WORKSPACE[col],
      count: (state[col] || []).length,
      formats: {
        date: "YYYY-MM-DD",
        time: "24-hour HH:MM",
        instant: "ISO 8601 with Z or explicit offset, e.g. 2026-10-28T10:00:00+08:00",
      },
    };
    if (col === "timetable") {
      result.fields = {
        ...result.fields,
        days: {
          type: "array",
          items: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6] },
          description: "0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat",
          examples: [
            [1, 3, 5],
            [2, 4],
          ],
        },
      };
      result.example = { title: "CS101", days: [1, 3, 5], start: "09:00", end: "10:30", room: "J301" };
      result.write_example = { op: "add", col, fields: JSON.stringify(result.example) };
      result.note =
        "Semester dates are optional. Import classes directly; don't invent dates or block on missing config/semester.";
    }
    return result;
  }
  return {
    collections: Object.entries(WORKSPACE).map(([col, s]) => ({
      col,
      description: s.label,
      count: (state[col] || []).length,
    })),
    readOnly: [
      "classes (Moodle deadlines; use ticks to complete)",
      "cards (review state)",
      "sources (use search/read)",
    ],
  };
}

/* Validate the complete batch before touching the store; also build a single Undo. */
export function planChanges(
  changes,
  state,
  {
    uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
    stamp = new Date().toISOString(),
  } = {},
) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100)
    throw new Error("Give 1–100 changes.");
  const data = Object.fromEntries(
    Object.entries(state)
      .filter(([c]) => Object.hasOwn(WORKSPACE, c) || c === "classes")
      .map(([c, rows]) => [c, new Map(rows.map(({ _id, ...doc }) => [_id, doc]))]),
  );
  const ops = new Map(),
    undo = new Map(),
    result = [];
  const put = (col, id, doc) => {
    const k = col + "/" + id,
      before = (state[col] || []).find(x => x._id === id);
    if (!undo.has(k)) {
      if (before) {
        const { _id, ...old } = before;
        undo.set(k, ["set", col, id, old]);
      } else undo.set(k, ["del", col, id]);
    }
    if (!data[col]) data[col] = new Map();
    if (doc === null) {
      data[col].delete(id);
      ops.set(k, ["del", col, id]);
    } else {
      data[col].set(id, doc);
      ops.set(k, ["set", col, id, doc]);
    }
  };
  for (const change of changes) {
    const { col, op } = change;
    if (change.id != null && (typeof change.id !== "string" || !/^[-\w]{1,80}$/.test(change.id)))
      throw new Error("Use an existing app record ID (letters, numbers, underscores or hyphens).");
    if (!Object.hasOwn(WORKSPACE, col))
      throw new Error("Can't change collection " + col + ". Use capabilities.");
    if (!["add", "update", "delete"].includes(op)) throw new Error("Use add, update or delete.");
    if (col === "config" && change.id !== "semester") throw new Error("Only config/semester can be changed.");
    if (col === "ticks" && !data.classes?.has(change.id))
      throw new Error("Use an existing Moodle class ID for ticks.");
    const fields = op === "delete" ? {} : fieldsFor(col, change.fields);
    let id = change.id || uid(),
      old = data[col]?.get(id);
    if (op !== "add" && !old) throw new Error("No " + col + " with id " + id + ".");
    if (op === "add" && old) throw new Error(col + " " + id + " already exists; update it instead.");
    if (op === "delete") {
      put(col, id, null);
      if (col === "pages") {
        for (const [p, doc] of data.pages)
          if (doc.parent === id) put("pages", p, { ...doc, parent: old.parent || "", upd: stamp });
        for (const [r, doc] of data.rels || []) if (doc.a === id || doc.b === id) put("rels", r, null);
      }
      if (col === "boards") for (const [i, doc] of data.ink || []) if (doc.b === id) put("ink", i, null);
      if (col === "projects")
        for (const [t, doc] of data.tasks || [])
          if (doc.proj === old.name) put("tasks", t, { ...doc, proj: "" });
      result.push({ op, col, id, label: old.title || old.name || old.text || old.category || id });
      continue;
    }
    const schema = WORKSPACE[col],
      doc = { ...(op === "add" ? { at: stamp, ...structuredClone(schema.defaults) } : old), ...fields };
    if (col === "tx" && !doc.date) doc.date = today();
    for (const name of schema.required)
      if (doc[name] == null || (typeof doc[name] === "string" && !doc[name].trim()))
        throw new Error(col + " needs " + name + ".");
    if (col === "timetable") {
      doc.days = [...new Set(doc.days)].sort();
      if (doc.end <= doc.start) throw new Error("Class end must be after its start.");
      const duplicate = [...(data.timetable || [])].find(
        ([other, x]) =>
          other !== id &&
          key(x.title) === key(doc.title) &&
          key(x.room) === key(doc.room) &&
          x.start === doc.start &&
          x.end === doc.end &&
          JSON.stringify([...(x.days || [])].sort()) === JSON.stringify(doc.days),
      );
      if (duplicate) {
        result.push({ op: "unchanged", col, id: duplicate[0], label: doc.title });
        continue;
      }
    }
    if (col === "config" && doc.start && doc.end && doc.end < doc.start)
      throw new Error("Semester end must be on or after its start.");
    if (col === "events" && doc.end && Date.parse(doc.end) < Date.parse(doc.start))
      throw new Error("Event end must be after its start.");
    if (col === "events" && doc.remind != null && doc.remind < 0)
      throw new Error("Reminder minutes must not be negative.");
    if (
      col === "budgets" &&
      [...(data.budgets || [])].some(([other, x]) => other !== id && key(x.category) === key(doc.category))
    )
      throw new Error("That category already has a budget. Update its existing ID.");
    if (col === "ink") {
      const required = {
        x: ["s"],
        n: ["s", "w", "h"],
        r: ["w", "h"],
        e: ["w", "h"],
        l: ["u", "v"],
        a: ["u", "v"],
      }[doc.t];
      if (required.some(name => doc[name] == null))
        throw new Error("Whiteboard " + doc.t + " needs " + required.join(", ") + ".");
    }
    if (col === "graphs") {
      if (!finite(doc.view.cx) || !finite(doc.view.cy) || !finite(doc.view.k) || doc.view.k <= 0)
        throw new Error("Graph view needs finite cx/cy and positive k.");
      if (typeof doc.tbl.id !== "string" || !finite(doc.tbl.x0) || !finite(doc.tbl.dx) || !doc.tbl.dx)
        throw new Error("Graph table needs id, finite x0 and nonzero dx.");
      if (
        Object.values(doc.vars).some(v => !object(v) || ![v.v, v.min, v.max].every(finite) || v.min > v.max)
      )
        throw new Error("Each slider needs finite v, min and max.");
    }
    if (col === "pages") {
      doc.upd = stamp;
      if ([...(data.pages || [])].some(([other, x]) => other !== id && key(x.title) === key(doc.title)))
        throw new Error("A page with that title already exists.");
      if (old && old.title !== doc.title)
        for (const [p, x] of data.pages) {
          const body = renameLinks(x.body || "", old.title, doc.title);
          if (p !== id && body !== x.body) put("pages", p, { ...x, body, upd: stamp });
        }
    }
    if (col === "projects" && old && doc.name !== old.name)
      for (const [t, x] of data.tasks || [])
        if (x.proj === old.name) put("tasks", t, { ...x, proj: doc.name });
    if (col === "subs" && old && old.name !== doc.name && !Object.hasOwn(fields, "slug")) doc.slug = "";
    if (col === "subs" && !doc.slug) doc.slug = brandSlug(doc.name); // a sub she adds by name gets the brand logo like one added in Money
    if (col === "jobs" && (!old || old.status !== doc.status)) doc.statusAt = stamp;
    put(col, id, doc);
    result.push({ op, col, id, label: doc.title || doc.name || doc.text || doc.category || id });
  }
  for (const [op, col, id, p] of ops.values()) {
    if (op !== "set" || col !== "pages") continue;
    const seen = new Set([id]);
    let parent = p.parent;
    while (parent) {
      if (seen.has(parent)) throw new Error("A page cannot be inside itself.");
      seen.add(parent);
      const next = data.pages.get(parent);
      if (!next) throw new Error("No parent page " + parent + ".");
      parent = next.parent;
    }
  }
  for (const [op, col, , doc] of ops.values()) {
    if (op === "set" && col === "rels" && (!data.pages?.has(doc.a) || !data.pages?.has(doc.b)))
      throw new Error("Connections need two existing pages.");
    if (op === "set" && col === "ink" && !data.boards?.has(doc.b))
      throw new Error("Whiteboard items need an existing board.");
  }
  return { ops: [...ops.values()], undo: [...undo.values()], result };
}
