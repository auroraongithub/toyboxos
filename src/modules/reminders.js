/* Reminders: quick reminders and real alarms. "5pm call mom", "in 20m stretch", "tomorrow 7am wake up daily".
   Rings on Android (notification / alarm sound, even with the app closed) and on desktop (alarm screen + system notification). */
import { useState, useEffect } from "preact/hooks";
import { html, plural } from "../core/lib.js";
import { useCols, W, D } from "../core/store.js";
import { toast } from "../core/bus.js";
import { Tools, Panel, List, StatusBar, Btn, Seg, Del, Empty, Icon, Group, Check } from "../ui/index.js";
import { AutoField } from "../ui/suggest.js";
import { actionSheet, askText, openSheet } from "../ui/sheet.js";
import { openMod } from "../shell/os.js";
import { parseRemind, addReminder, when, parseAhead, aheadFor } from "../core/alarms.js";
import { intent } from "../core/nlp.js";
import {
  PRESETS,
  ownSounds,
  defaultSound,
  soundName,
  setDefaultSound,
  preview,
  stopPreview,
  addOwnSound,
  removeOwnSound,
} from "../core/sounds.js";

const RPT = { daily: "daily", weekly: "weekly", weekdays: "weekdays" };
const list = () => D.reminders.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));

/* "tomorrow 8am" -> a new time for the same reminder */
async function retime(r) {
  const v = await askText({
    title: "Change time",
    label: "When? (5pm, tomorrow 8am, fri 14:30, in 2h)",
    placeholder: "tomorrow 8am",
    ok: "Set",
  });
  if (v === null) return;
  const p = parseRemind(v);
  if (!p) {
    toast("Couldn't read a time from that");
    return;
  }
  W.upd("reminders", r._id, {
    at: new Date(p.at).toISOString(),
    done: false,
    ...(p.repeat ? { repeat: p.repeat } : {}),
  });
}
/* days before: "3,1" nudges 3 days and 1 day ahead, "none" turns them off */
async function reahead(r) {
  const v = await askText({
    title: "Remind ahead",
    label: "Days before (3,1 · 7 · none)",
    value: (r.ahead || []).join(","),
    placeholder: "3,1",
    ok: "Set",
  });
  if (v === null) return;
  const a = /^\s*(none|off|no|0)?\s*$/i.test(v) ? [] : parseAhead(v),
    ok = aheadFor(Date.parse(r.at), a);
  if (a.length && !ok.length) {
    toast("That's too soon for a heads-up that far ahead");
    return;
  }
  W.upd("reminders", r._id, { ahead: ok });
  toast(ok.length ? "Heads-up " + ok.join(" and ") + " days before" : "No heads-up");
}
export function reminderMenu(r, at) {
  actionSheet(
    r.title || "Reminder",
    [
      r.done
        ? [
            "undo",
            "Turn back on",
            () =>
              W.upd("reminders", r._id, {
                done: false,
                at: new Date(Math.max(Date.now() + 6e4, Date.parse(r.at))).toISOString(),
              }),
          ]
        : ["applied", "Done", () => W.upd("reminders", r._id, { done: true })],
      [
        "clock",
        "Snooze 10 min",
        () => W.upd("reminders", r._id, { at: new Date(Date.now() + 6e5).toISOString(), done: false }),
      ],
      ["edit", "Change time…", () => retime(r)],
      [
        "bell",
        "Remind ahead…" + (r.ahead && r.ahead.length ? " (" + r.ahead.join(", ") + " d)" : ""),
        () => reahead(r),
      ],
      [
        r.loud ? "note" : "pomodoro",
        r.loud ? "Make it a quiet reminder" : "Make it a loud alarm",
        () => W.upd("reminders", r._id, { loud: !r.loud }),
      ],
      r.loud
        ? [
            "alarm",
            "Sound: " + (r.sound ? soundName(r.sound) : "default") + "…",
            () => pickSound("Sound for this alarm", r.sound || "", k => W.upd("reminders", r._id, { sound: k }), true, at),
          ]
        : null,
      "-",
      [
        "trash",
        "Delete",
        () => {
          const o = { ...r };
          delete o._id;
          W.del("reminders", r._id);
          toast("Deleted", { label: "Undo", run: () => W.set("reminders", r._id, o) });
        },
      ],
    ],
    at,
  );
}

/* the alarm sound list: tap one to hear it and pick it; your own files under the presets.
   cur "" = "use the default" (only offered for one alarm, with def) */
function SoundPicker({ cur, onPick, def }) {
  useCols("config");
  const [sel, setSel] = useState(cur);
  useEffect(() => stopPreview, []);
  const pick = k => {
    setSel(k);
    onPick(k);
    if (k) preview(k);
    else stopPreview();
  };
  const row = (k, l, extra) =>
    html`<div class=${"lr snd" + (sel === k ? " on" : "")} key=${k || "def"} role="radio" aria-checked=${sel === k} tabindex="0" onClick=${() => pick(k)} onKeyDown=${e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(k))}>
      <span class="sndr" aria-hidden="true"/><span class="tt">${l}</span>${k ? html`<button class="x1 sndp" aria-label=${"Play " + l} title="Play" onClick=${e => {
        e.stopPropagation();
        preview(k);
      }}><${Icon} n="play"/></button>` : null}${extra || null}</div>`;
  const own = ownSounds();
  return html`<div class="ll sndl" role="radiogroup" aria-label="Alarm sound">
    ${def ? row("", "Default (" + soundName(defaultSound()) + ")") : null}
    ${PRESETS.map(([k, l]) => row(k, l))}
    ${own.length ? html`<${Group} title="Your sounds"/>` : null}
    ${own.map(o => row("f:" + o.id, o.name, html`<${Del} onClick=${e => {
      e && e.stopPropagation && e.stopPropagation();
      removeOwnSound(o.id);
      if (sel === "f:" + o.id) setSel(def ? "" : "classic");
    }}/>`))}
    <label class="btn sndadd"><${Icon} n="plus"/>Add a sound file…<input type="file" accept="audio/*" hidden onChange=${async e => {
      const k = await addOwnSound(e.target.files[0]);
      e.target.value = "";
      if (k) pick(k);
    }}/></label></div>`;
}
export const pickSound = (title, cur, onPick, def, at) =>
  openSheet({ title, Body: SoundPicker, props: { cur, onPick, def }, at, onClose: stopPreview });
const pickDefault = at => pickSound("Alarm sound", defaultSound(), setDefaultSound, false, at);

function Row({ r }) {
  const past = !r.done && Date.parse(r.at) < Date.now();
  return html`<div class=${"lr rm" + (r.done ? " done" : "") + (past ? " late" : "")} key=${r._id}>
    <${Check} on=${r.done} label="Done" onClick=${() => W.upd("reminders", r._id, { done: !r.done })}/>
    <button class="rmb" onClick=${e => reminderMenu(r, e.currentTarget)}>
      <${Icon} n=${r.loud ? "alarm" : "bell"}/><span class="tt">${r.title || "Reminder"}</span>
      <span class="when">${when(Date.parse(r.at))}</span>${r.repeat ? html`<span class="tag">${RPT[r.repeat] || r.repeat}</span>` : null}${r.ahead && r.ahead.length && !r.done ? html`<span class="tag" title="Heads-up days before">${r.ahead.join("·")}d before</span>` : null}</button>
    <${Del} onClick=${() => {
      const o = { ...r };
      delete o._id;
      W.del("reminders", r._id);
      toast("Deleted", { label: "Undo", run: () => W.set("reminders", r._id, o) });
    }}/></div>`;
}

function Reminders() {
  useCols("reminders", "config");
  const [q, setQ] = useState(""),
    [showDone, setShowDone] = useState(false);
  const it = intent(q),
    said = it.v === "alarm" || it.v === "remind" ? it : null,
    lo0 = said ? said.v === "alarm" : false,
    lo = lo0;
  const p = q.trim() ? parseRemind(said ? said.arg : q) : null;
  /* two buttons that each add: Remind (quiet) and Alarm (loud); Enter follows what you typed ("alarm 7am"), else quiet */
  const add = a => {
    if (!q.trim()) return;
    if (!p) {
      toast("Add a time: 5pm, tomorrow 8am, in 20m");
      return;
    }
    const lo = typeof a === "boolean" && !said ? a : lo0;
    addReminder({ title: p.title || (lo ? "Alarm" : "Reminder"), at: p.at, loud: lo, repeat: p.repeat });
    setQ("");
    toast((lo ? "Alarm set for " : "Reminder set for ") + when(p.at));
  };
  const all = list(),
    up = all.filter(r => !r.done),
    done = all.filter(r => r.done).reverse();
  return html`<${Tools} cls="addrow"><${AutoField} mode="cal" placeholder="5pm call mom · in 20m stretch" aria-label="New reminder" value=${q} onInput=${e => setQ(e.target.value)} onEnter=${add}/>
      <${Btn} go icon="bell" aria-label="Add reminder" title="Quiet reminder" onClick=${() => add(false)}>Remind<//>
      <${Btn} icon="alarm" aria-label="Add alarm" title="Loud alarm" onClick=${() => add(true)}>Alarm<//>
      ${q.trim() ? html`<div class="qprev">${p ? html`<${Icon} n=${lo ? "alarm" : "bell"}/>${when(p.at)}${p.repeat ? " · " + p.repeat : ""}${p.title ? "" : " · (no title)"}` : "Add a time: 5pm, tomorrow 8am, fri 14:30, in 20m"}</div>` : null}<//>
    <${Panel}><${List}>${up.length ? up.map(r => html`<${Row} r=${r}/>`) : html`<${Empty}>Nothing set. Try “in 20m stretch” or “7am wake up daily”.<//>`}
      <button class="lr sndset" onClick=${e => pickDefault(e.currentTarget)}><${Icon} n="alarm"/><span class="tt">Alarm sound</span><span class="when">${soundName(defaultSound())} ›</span></button>
      ${done.length ? html`<${Group} title="Done" meta=${html`<button class="gl" onClick=${() => setShowDone(!showDone)}>${showDone ? "hide" : "show " + done.length}</button>`}/>${showDone ? done.slice(0, 15).map(r => html`<${Row} r=${r}/>`) : null}` : null}<//><//>
`;
}

export default {
  id: "reminders",
  name: "Reminders",
  title: "reminders",
  Comp: Reminders,
  search: q =>
    D.reminders
      .filter(r => !r.done && String(r.title).toLowerCase().includes(q))
      .slice(0, 3)
      .map(r => ({
        icon: r.loud ? "alarm" : "bell",
        l: "Reminder: " + r.title + " · " + when(Date.parse(r.at)),
        r: () => openMod("reminders", true),
      })),
  cmd: (v, arg) => {
    const al = ["alarm", "wake"].includes(v);
    if (!(al || ["remind", "reminder", "r", "rem"].includes(v))) return [];
    if (!arg)
      return [
        { icon: "bell", l: "Open Reminders", r: () => openMod("reminders", true) },
        { l: v + " 5pm call mom   (also: in 20m · tomorrow 8am · daily)", hint: true },
      ];
    const p = parseRemind(arg.replace(/^(me\s+)?(to|for|at|about)\s+/i, ""));
    if (!p) return [{ l: v + " 5pm call mom   (needs a time: 5pm · in 20m · tomorrow 8am)", hint: true }];
    return [
      {
        icon: al ? "alarm" : "bell",
        l:
          (al ? "Alarm: " : "Remind: ") +
          (p.title || "Reminder") +
          " · " +
          when(p.at) +
          (p.repeat ? " · " + p.repeat : ""),
        r: () => {
          addReminder({
            title: p.title || (al ? "Alarm" : "Reminder"),
            at: p.at,
            loud: al,
            repeat: p.repeat,
          });
          toast((al ? "Alarm set for " : "Reminder set for ") + when(p.at));
        },
      },
    ];
  },
};
