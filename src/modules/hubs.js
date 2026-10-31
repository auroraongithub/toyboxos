/* Five hubs instead of twelve windows. Each hub is one window / one phone tab with a strip of parts;
   openMod("calendar") etc. still works: os.js maps a part id to its hub and selects that part. */
import { html } from "../core/lib.js";
import { usePref } from "../core/pref.js";
import { useEffect, useRef } from "preact/hooks";
import { pushBack, dropBack, fromBack } from "../core/back.js";
import { useScrollKey } from "../ui/gestures.js";
import { Icon, AppIcon } from "../ui/index.js";
import today, { QuickFab } from "./today.js";
import jobs from "./jobs.js";
import calendar from "./calendar.js";
import board from "./board.js";
import reminders from "./reminders.js";
import notes from "./pages.js";
import inbox from "./inbox.js";
import graph from "./graph.js";
import whiteboard from "./whiteboard.js";
import timer from "./timer.js";
import money, { Spending, SubsView } from "./money.js";
import { LoansView } from "./loans.js";
import wishlist from "./wishlist.js";
import links from "./links.js";
import habits from "./habits.js";
import sync from "./sync.js";
import theme from "./theme.js";
import profile from "./profile.js";
import models from "./aimodels.js";
import buddy from "./buddy.js";
import gcalc from "./gcalc.js";
import nijika from "./nijika.js";
import moodle from "./moodle.js";
import store from "./store.js";

import { AI } from "../core/pack.js";
/* part = [id, label, Comp, icon, opts]; opts.hide = no tab of its own (opened from the hub's first part, with a
   back bar), opts.under = shown under another tab (Notes > Tools > Draw keeps "Tools" lit and names the tool) */
const P = (m, label, Comp, icon, o) => [m.id, label, Comp || m.Comp, icon || m.id, o || {}];

/* Notes > Tools: a launcher for the parts that are tools rather than notes */
function ToolGrid({ hub }) {
  const tools = hub.parts.filter(p => p[4].under === "tools");
  return html`<div class="tgrid">${tools.map(([k, l, , ic]) => html`<button class="tgi" key=${k} onClick=${() => hub.setSub(k)}><${AppIcon} id=${k} n=${ic}/><b>${l}</b></button>`)}</div>`;
}

function Hub({ id, parts }) {
  const [sub, setSub] = usePref("os-sub-" + id, parts[0][0]);
  const cur = parts.find(p => p[0] === sub) || parts[0],
    C = cur[2],
    o = cur[4] || {};
  const tabs = parts.filter(p => !p[4].hide);
  /* back button: from Habits/Timer/a tool back to where you opened it */
  const prev = useRef(cur[0]);
  useEffect(() => {
    const p = prev.current;
    prev.current = cur[0];
    if (p === cur[0] || fromBack()) return;
    const was = (parts.find(x => x[0] === p) || [])[4] || {};
    if (o.hide && !was.hide) pushBack("part", () => setSub(p));
    else if (!o.hide && was.hide) dropBack("part");
  }, [cur[0]]);
  useScrollKey(id + ":" + cur[0], true);
  const lit = o.under || cur[0];
  return html`${
    tabs.length > 1
      ? html`<div class="hubtabs" role="tablist" data-deep=${o.hide ? "1" : null}>${tabs.map(
          ([k, l, , ic]) => {
            const on = k === lit,
              inTool = on && o.under === k;
            return html`<button class="ht" role="tab" key=${k} aria-selected=${String(on)} onClick=${() => setSub(k)}><${AppIcon} id=${inTool ? cur[0] : k} n=${inTool ? cur[3] : ic}/><span>${inTool ? l + " · " + cur[1] : l}</span></button>`;
          },
        )}</div>`
      : null
  }
    ${o.hide && !o.under ? html`<div class="hubback"><button class="hbk" onClick=${() => setSub(tabs[0][0])}><${Icon} n="back"/>${tabs[0][1]}</button><b>${cur[1]}</b></div>` : null}
    <${C} key=${cur[0]} hub=${{ id, parts, setSub }}/><${QuickFab} part=${cur[0]}/>`;
}
const hub = (id, name, parts, o = {}) => ({
  id,
  name,
  title: id,
  parts,
  tab: true,
  ...o,
  Comp: () => html`<${Hub} id=${id} parts=${parts}/>`,
});

export const HUBS = [
  hub("today", "Today", [
    P(today, "Today"),
    P(habits, "Habits", null, null, { hide: 1 }),
    P(timer, "Timer", null, "pomodoro", { hide: 1 }),
  ]),
  hub("plan", "Plan", [P(calendar, "Calendar"), P(board, "Board"), P(reminders, "Reminders", null, "bell")]),
  hub("notes", "Notes", [
    P(notes, "Pages", null, "notes"),
    P(inbox, "Inbox"),
    ["tools", "Tools", ToolGrid, "grid", {}],
    P(whiteboard, "Draw", null, null, { hide: 1, under: "tools" }),
    P(graph, "Graph", null, null, { hide: 1, under: "tools" }),
    P(gcalc, "Calc", null, null, { hide: 1, under: "tools" }),
    P(links, "Links", null, null, { hide: 1, under: "tools" }),
  ]),
  /* the assistant can be renamed at runtime (core/look.js): its hub reads the name live */
  Object.defineProperties(hub("buddy", "", [P(buddy, "Chat")], { opt: "ai" }), {
    name: { get: () => AI.name, enumerable: true },
    title: { get: () => AI.name.toLowerCase(), enumerable: true },
  }),
  hub("money", "Money", [
    ["money", "Spending", Spending, "money", {}],
    ["subs", "Subs", SubsView, "subs", {}],
    ["loans", "Loans", LoansView, "money", {}],
    P(wishlist, "Wishlist"),
  ]),
  hub("jobs", "Jobs", [P(jobs, "Jobs")], { mod: false, opt: "jobs" }),
];
/* windows that aren't hubs (opened from the settings sheet) */
export const EXTRA = [
  { ...sync, tab: false },
  { ...nijika, tab: false },
  { ...theme, tab: false },
  { ...store, tab: false },
  { ...profile, tab: false },
  { ...moodle, tab: false },
  { ...models, tab: false },
];
export const ALL_MODULES = [
  today,
  jobs,
  calendar,
  board,
  reminders,
  notes,
  inbox,
  graph,
  whiteboard,
  timer,
  money,
  wishlist,
  links,
  habits,
  sync,
  buddy,
  gcalc,
  nijika,
  theme,
  store,
  moodle,
  profile,
  models,
];
