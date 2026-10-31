import { useState, useEffect, useRef } from "preact/hooks";
import { useMods, on as featOn } from "../core/features.js";
import {
  html,
  fmt,
  dkey,
  today,
  dayLabel,
  rangeLabel,
  timeLabel,
  ago,
  money,
  addDays,
  mmss,
  plural,
} from "../core/lib.js";
import { useCols, calItems, D, W } from "../core/store.js";
import { Panel, StatusBar, Group, Check, Field, Btn, Icon, tick as buzzTick } from "../ui/index.js";
import { nextDue } from "./money.js";
import { openMod } from "../shell/os.js";
import { streak, toggle as toggleHabit } from "./habits.js";
import { timerState, useTimer, start, pause } from "./timer.js";
import { bestIn } from "../shell/route.js";
import { openSheet } from "../ui/sheet.js";
import { quickNote } from "./pages.js";
import { addJot, jots, LONG } from "./inbox.js";
import { AutoField } from "../ui/suggest.js";
import { when as remWhen } from "../core/alarms.js";
import { dueIn, family, startReview } from "./study.js";
import { usePref } from "../core/pref.js";
import { classesOn } from "../core/schedule.js";

/* title first, when/score on the right: the thing you need to do is what you read first */
const Line = ({ d, t, tag, to, check, lead }) =>
  html`<div class="tl">${check || null}<button class="tlb" onClick=${() => openMod(to, true)}>${lead != null ? html`<span class="ld">${lead}</span>` : null}<span class="tt">${t}</span>${d ? html`<span class="d">${d}</span>` : null}${tag ? html`<span class="tag">${tag}</span>` : null}</button></div>`;
const Sec = ({ title, meta, to, children }) =>
  html`<div class="ts"><${Group} title=${html`<button class="gl" onClick=${() => openMod(to, true)}>${title}</button>`} meta=${meta}/><div class="lcap">${children}</div></div>`;

/* "in 3h 20m" / "2d" */
const until = t => {
  const m = Math.round((t - Date.now()) / 6e4);
  if (m < 0) return "now";
  if (m < 60) return "in " + m + "m";
  if (m < 36 * 60) return "in " + Math.floor(m / 60) + "h" + (m % 60 ? " " + (m % 60) + "m" : "");
  return "in " + Math.round(m / 1440) + "d";
};

/* one box for everything: "event quiz fri 3pm", "spent 250 lunch", "todo x"... anything else becomes a note.
   ctx (the + sheet on another screen) makes plain text mean that screen's thing */
const fallback = s => s.length <= LONG && s.indexOf(String.fromCharCode(10)) < 0;
function Quick({ ctx, ph, done, auto }) {
  const [q, setQ] = useState("");
  const r = useRef();
  useEffect(() => {
    if (auto) setTimeout(() => r.current && r.current.focus(), 60);
  }, []);
  const s = q.trim(),
    a = s ? bestIn(s, ctx) : null;
  const go = () => {
    if (!s) return;
    if (a) a.r();
    else if (fallback(s)) addJot(s);
    else quickNote(s);
    setQ("");
    done && done();
  };
  // say what Enter will do, so a loosely typed line never surprises you
  return html`<div class="qk"><${AutoField} inputRef=${r} placeholder=${ph || "Jot an idea · alarm 7am · quiz fri 3pm"} aria-label="Quick add" value=${q} onInput=${e => setQ(e.target.value)} onEnter=${go}/><${Btn} go icon="plus" aria-label="Add" onClick=${go}/>
    ${s ? html`<div class="qprev">${a ? html`<${Icon} n=${a.icon || "plus"}/>${a.l}` : fallback(s) ? html`<${Icon} n="inbox"/>Jot: ${s}` : html`<${Icon} n="note"/>New page`}</div>` : null}</div>`;
}
/* phones: one + on every screen that adds things; it opens the same box, aimed at that screen */
const CTX = {
  calendar: ["event", "quiz fri 3pm #cs101 · bday dec 12"],
  board: ["todo", "fix the nav #portfolio"],
  reminders: ["remind", "5pm call mom · in 20m stretch"],
  money: ["spent", "250 lunch #food · $5 coffee · +5000 salary"],
  subs: ["sub", "netflix 549"],
  wishlist: ["wish", "keyboard 3500"],
  inbox: ["jot", "an idea, a link, anything"],
  links: ["link", "example.com"],
  habits: ["habit", "read 20 min"],
  jobs: ["job", "frontend dev at Acme · applied designer at Studio"],
};
export const hasQuick = part => !!CTX[part];
export const openQuick = part => {
  const c = CTX[part] || [];
  openSheet({
    title: "Add",
    Body: ({ close }) => html`<${Quick} ctx=${c[0]} ph=${c[1]} done=${close} auto/>`,
  });
};
export function QuickFab({ part }) {
  const [mode] = usePref("os-calmode", "list");
  return CTX[part] && !(part === "calendar" && mode === "classes")
    ? html`<button class="fab qfab" aria-label="Add" onClick=${() => openQuick(part)}><${Icon} n="plus"/></button>`
    : null;
}

function Today() {
  useCols(
    "classes",
    "events",
    "ticks",
    "subs",
    "jobs",
    "pomos",
    "tasks",
    "habits",
    "pages",
    "cards",
    "jots",
    "reminders",
    "timetable",
    "config",
  );
  useTimer();
  useMods();
  const now = Date.now(),
    ci = calItems(),
    tm = timerState();
  const classes = classesOn(
    D.timetable,
    D.config.find(x => x._id === "semester"),
    today(),
  );
  const open = ci.filter(x => !x.done && x.kind !== "opens");
  const late = open.filter(x => x.e < now - 36e5 && x.e > now - 10 * 864e5);
  const due = open.filter(x => x.e >= now - 36e5 && x.t < now + 8 * 864e5).slice(0, 5);
  const next = due[0];
  const subs = D.subs
    .map(s => ({ s, d: nextDue(s) }))
    .filter(x => x.d <= addDays(today(), 14))
    .sort((a, b) => a.d.localeCompare(b.d))
    .slice(0, 4);
  const nw = D.jobs.filter(j => (j.status || "new") === "new").sort((a, b) => (b.fit || 0) - (a.fit || 0));
  const pm = D.pomos.filter(p => dkey(new Date(p.at)) === today());
  const doing = D.tasks.filter(t => t.col === "doing").slice(0, 3);
  const hs = D.habits.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const study = D.pages
    .filter(p => p.kind === "subject")
    .map(p => ({ p, n: dueIn(family(p._id)).length }))
    .filter(x => x.n)
    .sort((a, b) => b.n - a.n);
  const jl = jots();
  const rems = D.reminders
    .filter(r => !r.done && Date.parse(r.at) < now + 3 * 864e5)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(0, 3);
  const tick = x =>
    html`<${Check} on=${x.done} onClick=${() => (x.src === "moodle" ? W.set("ticks", x.id, { done: !x.done }) : W.upd("events", x.id, { done: !x.done }))}/>`;
  /* only sections with something in them; the page stays short on a phone */
  const left = [
    classes.length &&
      html`<${Sec} title="Classes today" to="calendar">${classes.map(x => html`<${Line} d=${timeLabel(x.t) + "–" + timeLabel(x.e)} t=${x.title} tag=${x.room} to="calendar"/>`)}<//>`,
    (due.length || late.length) &&
      html`<${Sec} title="Due" meta=${late.length ? late.length + " overdue" : ""} to="calendar">
      ${late.slice(0, 3).map(x => html`<${Line} d="late" t=${x.title} tag=${x.code} to="calendar" check=${tick(x)}/>`)}
      ${due.map(x => html`<${Line} d=${x.multi ? rangeLabel(dkey(new Date(x.t)), dkey(new Date(x.e))) : dayLabel(dkey(new Date(x.t))) + (x.allDay ? "" : " " + timeLabel(x.t))} t=${x.title} tag=${x.code} to="calendar" check=${tick(x)}/>`)}<//>`,
    study.length &&
      html`<${Sec} title="Study" meta=${
        plural(
          study.reduce((a, x) => a + x.n, 0),
          "card",
        ) + " due"
      } to="notes">
      ${study.slice(0, 4).map(x => html`<div class="tl"><button class="tlb" onClick=${() => startReview(family(x.p._id), x.p.title)}><span class="tt">${x.p.icon ? x.p.icon + " " : ""}${x.p.title}</span><span class="d">${x.n} due</span><span class="tag">review</span></button></div>`)}<//>`,
    rems.length &&
      html`<${Sec} title="Reminders" meta=${rems.length > 2 ? "next" : ""} to="reminders">${rems.map(r => html`<${Line} d=${remWhen(Date.parse(r.at))} t=${(r.loud ? "⏰ " : "") + (r.title || "Reminder")} to="reminders"/>`)}<//>`,
    jl.length &&
      html`<${Sec} title="Inbox" meta=${jl.length + (jl.length === 1 ? " jot" : " jots")} to="inbox">${jl.slice(0, 3).map(j => html`<${Line} t=${j.text} to="inbox"/>`)}<//>`,
    hs.length &&
      html`<${Sec} title="Habits" meta=${hs.filter(h => (h.days || []).includes(today())).length + "/" + hs.length} to="habits">
      <div class="hchips">${hs.map(h => {
        const on = (h.days || []).includes(today()),
          s = streak(h);
        return html`<button class="hchip" key=${h._id} aria-pressed=${String(on)} onClick=${() => {
          if (!on) buzzTick();
          toggleHabit(h);
        }}><i/>${h.name}${s ? html`<small>${s}d</small>` : null}</button>`;
      })}</div><//>`,
  ].filter(Boolean);
  const right = [
    nw.length &&
      featOn("jobs") &&
      nw.length > 0 &&
      html`<${Sec} title="Jobs" meta=${nw.length + " new"} to="jobs">${nw.slice(0, 3).map(j => html`<${Line} lead=${j.fit || "–"} t=${j.title} tag=${j.pay || ""} to="jobs"/>`)}<//>`,
    subs.length &&
      html`<${Sec} title="Charges" to="money">${subs.map(x => html`<${Line} d=${ago(x.d)} t=${x.s.name} tag=${money(x.s.amt, x.s.cur)} to="money"/>`)}<//>`,
    doing.length &&
      html`<${Sec} title="Doing" to="board">${doing.map(t => html`<${Line} t=${t.title} tag=${t.proj || ""} to="board"/>`)}<//>`,
  ].filter(Boolean);
  return html`<${Panel}>
    <div class="now">
      <div class="nx" onClick=${() => openMod("calendar", true)}>${
        next
          ? html`<small>Next</small><b>${next.title}</b><span>${next.t < now && next.e >= now ? "until " + rangeLabel(dkey(new Date(next.e))) : until(next.t)}${next.code ? " · " + next.code : ""}</span>`
          : html`<small>Next</small><b>Nothing due this week</b><span>${late.length ? late.length + " overdue" : "all clear"}</span>`
      }</div>
      <div class=${"tmr" + (tm.running ? " on" : "")}><button class="tpl" aria-label=${tm.running ? "Pause" : "Start focus"} title=${tm.running ? "Pause" : "Start focus"} onClick=${() => (tm.running ? pause() : start())}><${Icon} n=${tm.running ? "pause" : "play"}/></button>
        <button class="topen" aria-label="Open the timer" title="Open the timer" onClick=${() => openMod("pomodoro", true)}><b>${mmss(tm.left)}</b><small>${tm.mode === "focus" ? pm.length + " × 25m" : tm.mode === "short" ? "break" : "long break"}</small></button></div>
    </div>
    <${Quick}/>
    ${
      left.length || right.length
        ? html`<div class="tg"><div class="tcol">${left}</div><div class="tcol">${right}</div></div>`
        : html`<div class="mini nil2">Nothing waiting. ${featOn("jobs") ? "Jobs, deadlines" : "Deadlines"} and habits show up here.</div>`
    }
  <//>`;
}
export default { id: "today", name: "Today", title: "today", Comp: Today, tab: true };
