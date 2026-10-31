/* What the assistant can see: a readable text version of any open window, page, board or reference. */
import { ls } from "./pref.js";
import { D, calItems, toPHP } from "./store.js";
import { today, dkey, dayLabel, timeLabel, money, fmt } from "./lib.js";
import { hubOf, reg } from "../shell/os.js";
import { budgetUsage } from "./budgets.js";
import { classesOn, WEEKDAYS } from "./schedule.js";
import { home } from "./profile.js";

/* ---------- what's on screen ---------- */
const low = s =>
  String(s || "")
    .trim()
    .toLowerCase();
const clip = (s, n) => {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
};
const findPage = q => {
  if (!q) return null;
  const l = low(q);
  return (
    D.pages.find(p => p._id === q) ||
    D.pages.find(p => low(p.title) === l) ||
    D.pages.find(p => low(p.title).includes(l))
  );
};
const lastWin = () => {
  const v = hubOf(ls.get("os-ai-last", "today"));
  return v === "buddy" ? "today" : v;
};
const when = t => dayLabel(dkey(new Date(t))) + " " + timeLabel(t);

function boardText(b) {
  if (!b) return "Whiteboard: no boards yet.";
  const t = D.ink
    .filter(i => i.b === b._id && (i.t === "x" || i.t === "n") && i.s)
    .map(i => "- " + i.s.replace(/\n/g, " / "));
  const strokes = D.ink.filter(i => i.b === b._id && i.t !== "x" && i.t !== "n").length;
  return (
    `Whiteboard "${b.title}": ${t.length} text items, ${strokes} drawn strokes/shapes (drawings aren't readable as text).\n` +
    clip(t.join("\n"), 6000)
  );
}
function pageText(p) {
  const par = D.pages.find(x => x._id === p.parent),
    body = p.body || "",
    lim = p.doc ? 1500 : 7000,
    kids = D.pages.filter(x => x.parent === p._id).map(x => x.title);
  return (
    `Page "${p.title}" (id ${p._id}, ${p.kind || "note"}${par ? ", under " + par.title : ""}, ${body.length} chars)\n` +
    clip(body, 7000) +
    (body.length > 7000 ? "\n[more: read page at=7000]" : "") +
    (kids.length ? "\nPages under it: " + clip(kids.join(", "), 1500) : "")
  );
}
function scheduleText() {
  const semester = D.config.find(x => x._id === "semester");
  return (
    "Semester dates (optional): " +
    (semester ? JSON.stringify(semester) : "none; weekly classes can be imported and used without dates") +
    "\nWeekly classes:\n" +
    D.timetable
      .slice(0, 60)
      .map(
        x =>
          `${x._id}: ${x.title}, ${(x.days || []).map(d => (WEEKDAYS.find(w => w[0] === d) || [])[1]).join("/")} ${x.start}-${x.end}${x.room ? ", " + x.room : ""}`,
      )
      .join("\n")
  );
}
function budgetsText() {
  return (
    "Monthly limits:\n" +
    D.budgets
      .map(b => {
        const u = budgetUsage(b, D.tx, today().slice(0, 7), toPHP);
        return `${b._id}: ${b.category || "All spending"}, ${money(u.spent, b.cur)} / ${money(b.amt, b.cur)}, ${money(Math.abs(u.left), b.cur)} ${u.left < 0 ? "over" : "left"}`;
      })
      .join("\n")
  );
}
export function look(win) {
  const w = win || ls.get("os-ai-last", "today"),
    sub = w === "notes" ? ls.get("os-sub-notes", "notes") : w;
  if (w === "timetable" || w === "schedule") return scheduleText();
  if (w === "budgets") return budgetsText();
  if (w === "pomodoro" || w === "timer") return "Timer: " + JSON.stringify(ls.get("os-pomo", {}));
  if (sub === "whiteboard" || w === "whiteboard")
    return boardText(D.boards.find(x => x._id === ls.get("os-wb", "")) || D.boards[0]);
  if (sub === "calc") {
    const g = D.graphs.find(x => x._id === ls.get("os-gr-cur", ""));
    return g
      ? [
          "Graph " + g.title + ":",
          ...g.rows.filter(r => r.t).map(r => "- " + r.t),
          ...Object.entries(g.vars || {}).map(([n, v]) => n + " = " + v.v),
        ].join("\n")
      : "Calculator open.";
  }
  if (sub === "links")
    return (
      "Links:\n" +
      D.links
        .slice(0, 60)
        .map(l => `- ${l.name}: ${l.url}`)
        .join("\n")
    );
  if (sub === "graph") {
    const t = id => (D.pages.find(p => p._id === id) || {}).title || "?";
    return (
      `Graph: ${D.pages.length} pages. Connections:\n` +
      (D.rels
        .slice(0, 80)
        .map(r => `- ${t(r.a)} -${r.label ? " " + r.label + " " : ""}- ${t(r.b)}`)
        .join("\n") || "(none besides [[links]])")
    );
  }
  if (sub === "inbox")
    return (
      "Inbox jots:\n" +
      D.jots
        .slice(-30)
        .map(j => "- " + j.text)
        .join("\n")
    );
  if (hubOf(w) === "notes") {
    const p = D.pages.find(x => x._id === ls.get("os-page", ""));
    if (!p)
      return (
        "Notes: no page open. Pages: " +
        D.pages
          .slice(0, 40)
          .map(x => x.title)
          .join(", ")
      );
    return pageText(p);
  }
  const now = Date.now();
  if (hubOf(w) === "plan") {
    const ev = calItems()
      .filter(x => !x.done && x.e > now - 864e5 && x.t < now + 14 * 864e5)
      .slice(0, 30)
      .map(
        x =>
          `- ${when(x.t)}${x.multi ? " until " + when(x.e) : ""}: ${x.title}${x.code ? " #" + x.code : ""}`,
      );
    const rem = D.reminders
      .filter(r => !r.done)
      .slice(0, 15)
      .map(r => `- ${when(Date.parse(r.at))}: ${r.title}${r.loud ? " (alarm)" : ""}`);
    const tk = D.tasks
      .filter(t => (t.col || "todo") !== "done")
      .slice(0, 20)
      .map(t => `- [${t.col || "todo"}] ${t.title}${t.proj ? " #" + t.proj : ""}`);
    return `Calendar, next 14 days:\n${ev.join("\n") || "(nothing)"}\nReminders:\n${rem.join("\n") || "(none)"}\nBoard tasks:\n${tk.join("\n") || "(none)"}\n${scheduleText()}`;
  }
  if (hubOf(w) === "money") {
    const m = today().slice(0, 7),
      tx = D.tx.filter(t => String(t.date || "").startsWith(m));
    const out = tx.filter(t => t.type === "out").reduce((a, t) => a + toPHP(t.amt, t.cur), 0);
    return (
      `Money this month: spent about ${money(out, home())} over ${tx.length} entries.\nRecent:\n` +
      D.tx
        .slice(-12)
        .map(t => `- ${t.date} ${t.type === "in" ? "+" : "-"}${money(t.amt, t.cur)} ${t.note || ""}`)
        .join("\n") +
      "\nSubscriptions:\n" +
      D.subs.map(s => `- ${s.name} ${money(s.amt, s.cur)}/${s.cycle} next ${s.next}`).join("\n") +
      "\n" +
      budgetsText()
    );
  }
  if (hubOf(w) === "jobs")
    return (
      "Jobs (newest first):\n" +
      D.jobs
        .slice()
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 15)
        .map(j => `- [${j.status || "new"}] ${j.title} · fit ${j.fit || "?"} · ${j.pay || ""}`)
        .join("\n")
    );
  // any other window: read what's on it
  if (w !== "today" && hubOf(w) !== "today") {
    const el =
      document.querySelector(`.win[data-win="${hubOf(w)}"]`) ||
      document.querySelector(`.win[data-win="${w}"]`);
    if (!el) return `The ${winLabel(w)} window isn't open. Open it with show, or use the data tool.`;
    return `${winLabel(w)} window, as shown:\n` + clip(el.innerText.replace(/\n{3,}/g, "\n\n"), 6000);
  }
  // today
  const due = calItems()
    .filter(x => !x.done && x.kind !== "opens" && x.e > now - 864e5 && x.t < now + 7 * 864e5)
    .slice(0, 15)
    .map(x => `- ${when(x.t)}${x.multi ? " until " + when(x.e) : ""}: ${x.title}`);
  const classes = classesOn(
    D.timetable,
    D.config.find(x => x._id === "semester"),
    today(),
  );
  return `Today is ${fmt(new Date(), { weekday: "long", month: "long", day: "numeric" })}.\nDue in the next 7 days:\n${due.join("\n") || "(nothing)"}\nClasses today: ${classes.map(x => x.title + " " + x.start + "-" + x.end).join(", ") || "(none)"}\nHabits: ${D.habits.map(h => h.name + ((h.days || []).includes(today()) ? " ✓" : "")).join(", ") || "(none)"}\nInbox: ${D.jots.length} jots`;
}
export const winLabel = w =>
  reg.names[w] || { whiteboard: "Whiteboard", timetable: "Class schedule", budgets: "Budgets" }[w] || w;
/* @-mentions: {k:"win"|"page"|"board"|"src", id, l}. Windows and pages go inline; a source only names itself (the model searches/reads it) */
export function refText(r) {
  if (r.k === "page") {
    const p = D.pages.find(x => x._id === r.id);
    return p ? pageText(p) : `(page ${r.l} was deleted)`;
  }
  if (r.k === "board") return boardText(D.boards.find(x => x._id === r.id));
  if (r.k === "src") return `Source "${r.l}" (id ${r.id}): use search where=sources, or read source=${r.id}.`;
  return `[Open in ${winLabel(r.id)}]\n` + look(r.id);
}

export { clip, findPage, lastWin, low };
