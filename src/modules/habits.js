import { useState } from "preact/hooks";
import { html, today, addDays } from "../core/lib.js";
import { useCols, W, D, drop } from "../core/store.js";
import { Tools, Panel, List, StatusBar, AddBtn, Field, Check, Del, Empty, Tag } from "../ui/index.js";
import { openMod } from "../shell/os.js";

export const streak = h => {
  const s = new Set(h.days || []);
  let d = s.has(today()) ? today() : addDays(today(), -1),
    n = 0;
  while (s.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
};
export const toggle = h => {
  const s = new Set(h.days || []),
    t = today();
  s.has(t) ? s.delete(t) : s.add(t);
  W.upd("habits", h._id, { days: [...s].sort().slice(-120) });
};
function Habit({ h }) {
  const [ed, setEd] = useState(false),
    [v, setV] = useState(h.name);
  const done = (h.days || []).includes(today()),
    st = streak(h),
    set = new Set(h.days || []);
  const fin = () => {
    setEd(false);
    const t = v.trim();
    if (t && t !== h.name) W.upd("habits", h._id, { name: t });
    else setV(h.name);
  };
  return html`<div class=${"lr" + (done ? " done" : "")}>
    <${Check} on=${done} label="Done today" onClick=${() => toggle(h)}/>
    ${
      ed
        ? html`<${Field} w="w" autofocus inputRef=${r => r && r.focus()} value=${v} onInput=${e => setV(e.target.value)} onBlur=${fin} onEnter=${fin} onEsc=${() => {
            setV(h.name);
            setEd(false);
          }}/>`
        : html`<span class="tt ed" title="Click to edit" onClick=${() => setEd(true)}>${h.name}</span>`
    }
    <span class="hb" aria-hidden="true">${[6, 5, 4, 3, 2, 1, 0].map(i => html`<i class=${set.has(addDays(today(), -i)) ? "on" : ""}/>`)}</span>
    ${st ? html`<${Tag}>${st}d<//>` : null}<${Del} onClick=${() => drop("habits", h._id, "Habit deleted")}/></div>`;
}
function Habits() {
  useCols("habits");
  const [n, setN] = useState("");
  const add = () => {
    const v = n.trim();
    if (!v) return;
    W.add("habits", { name: v, days: [] });
    setN("");
  };
  const hs = D.habits.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const dn = hs.filter(h => (h.days || []).includes(today())).length;
  return html`<${Tools} cls="addrow"><${Field} w="w" placeholder="New habit" maxlength="40" aria-label="Habit" value=${n} onInput=${e => setN(e.target.value)} onEnter=${add}/><${AddBtn} onClick=${add}/><//>
    <${Panel}><${List}>${hs.length ? hs.map(h => html`<${Habit} key=${h._id} h=${h}/>`) : html`<${Empty}>No habits yet.<//>`}<//><//>
    <${StatusBar} keep items=${[dn + "/" + hs.length + " today"]}/>`;
}
export default {
  id: "habits",
  name: "Habits",
  title: "habits",
  Comp: Habits,
  search: q =>
    D.habits
      .filter(h => h.name.toLowerCase().includes(q))
      .slice(0, 2)
      .map(h => ({ icon: "habits", l: "Habit: " + h.name, r: () => openMod("habits", true) })),
  cmd: (v, arg) =>
    v === "habit"
      ? [
          arg
            ? {
                icon: "habits",
                l: "Add habit: " + arg,
                r: () => {
                  W.add("habits", { name: arg, days: [] });
                  openMod("habits");
                },
              }
            : { icon: "habits", l: "Open Habits", r: () => openMod("habits", true) },
        ]
      : [],
};
