import { useState, useRef } from "preact/hooks";
import { AutoField } from "../ui/suggest.js";
import { askPermission } from "../core/alarms.js";
import { when as nlpWhen } from "../core/nlp.js";
import {
  html,
  fmt,
  dkey,
  today,
  dAt,
  addDays,
  addMonths,
  dayLabel,
  rangeLabel,
  timeLabel,
  hm,
  pad2,
} from "../core/lib.js";
import { usePref } from "../core/pref.js";
import { useCols, W, calItems, itemDays, drop } from "../core/store.js";
import {
  Tools,
  Panel,
  List,
  StatusBar,
  AddBtn,
  Field,
  Btn,
  Seg,
  Group,
  Check,
  Del,
  Empty,
  EditRow,
  Icon,
} from "../ui/index.js";
import { openMod } from "../shell/os.js";
import { Schedule, ClassDay } from "./schedule.js";

const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function Entry({ x, edit, setEdit }) {
  if (edit === x.id && x.src === "own")
    return html`<${EditRow} specs=${[
      { k: "title", t: "text", ph: "Title", w: "w" },
      { k: "date", t: "date" },
      { k: "time", t: "time" },
      { k: "end", t: "date", ph: "End day" },
      { k: "tag", t: "text", ph: "Tag" },
    ]}
      init=${{ title: x.title, date: dkey(new Date(x.t)), time: x.allDay ? "" : hm(x.t), end: x.multi ? dkey(new Date(x.e)) : "", tag: x.code }}
      onSave=${o => {
        if (o.title && o.date)
          W.upd("events", x.id, {
            title: o.title,
            start: dAt(o.date, o.time || "23:59").toISOString(),
            end: o.end && o.end > o.date ? dAt(o.end, o.time || "23:59").toISOString() : "",
            allDay: !o.time,
            tag: o.tag,
          });
      }} onCancel=${() => setEdit(null)}/>`;
  const late = !x.done && x.e < Date.now() && x.kind !== "opens";
  return html`<div class=${"lr" + (x.done ? " done" : "") + (x.kind === "opens" ? " dim" : "") + (late ? " late" : "")}>
    ${x.kind !== "opens" ? html`<${Check} on=${x.done} onClick=${() => (x.src === "moodle" ? W.set("ticks", x.id, { done: !x.done }) : W.upd("events", x.id, { done: !x.done }))}/>` : html`<span style="width:17px;flex:none"/>`}
    <span class=${"when" + (x.multi ? " rg" : "")}>${x.multi ? rangeLabel(dkey(new Date(x.t)), dkey(new Date(x.e))) : x.allDay ? "all day" : timeLabel(x.t)}</span>${x.remind ? html`<${Icon} n="bell"/>` : null}
    <span class=${"tt" + (x.src === "own" ? " ed" : "")} title=${x.src === "own" ? "Click to edit" : ""} onClick=${x.src === "own" ? () => setEdit(x.id) : null}>${x.title}</span>
    ${x.code ? html`<span class=${"tag" + (x.src === "moodle" ? " k" : "")}>${x.code}</span>` : null}
    ${x.src === "own" ? html`<${Del} onClick=${() => drop("events", x.id)}/>` : null}
  </div>`;
}

function ListView({ past, edit, setEdit }) {
  const t0 = +dAt(today(), "00:00"),
    it = calItems();
  const late = it.filter(x => !x.done && x.kind !== "opens" && x.e < t0 && x.e > t0 - 21 * 864e5);
  let main = it.filter(x => x.e >= t0);
  if (past)
    main = it
      .filter(x => x.e < t0)
      .reverse()
      .concat(main);
  const out = [];
  if (late.length && !past) {
    out.push(html`<${Group} title="Overdue"/>`);
    late.forEach(x => out.push(html`<${Entry} key=${x.id} x=${x} edit=${edit} setEdit=${setEdit}/>`));
  }
  let cur = "";
  main.forEach(x => {
    const k = x.t < t0 && x.e >= t0 ? today() : dkey(new Date(x.t));
    if (k !== cur) {
      cur = k;
      out.push(html`<${Group} title=${dayLabel(k)}/>`);
    }
    out.push(html`<${Entry} key=${x.id} x=${x} edit=${edit} setEdit=${setEdit}/>`);
  });
  return html`<${Panel}><div class="ll">${out.length ? out : html`<${Empty}>Nothing scheduled.<//>`}</div><//><${StatusBar} items=${[late.length ? late.length + " overdue" : null]}/>`;
}

function Boxes({ month, setMonth, sel, setSel, edit, setEdit }) {
  const first = month + "-01",
    dow = dAt(first).getUTCDay(),
    gs = addDays(first, -dow),
    td = today();
  const by = {};
  calItems().forEach(x => itemDays(x).forEach(k => (by[k] = by[k] || []).push(x)));
  const inp = useRef();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const k = addDays(gs, i),
      its = (by[k] || []).filter(x => x.kind !== "opens");
    cells.push(html`<button key=${k} class=${"mc" + (k.slice(0, 7) !== month ? " oth" : "") + (k === td ? " td" : "") + (k === sel ? " sel" : "")} aria-label=${dayLabel(k) + ", " + its.length + " entries"}
      onClick=${() => {
        setSel(k);
        if (k.slice(0, 7) !== month) setMonth(k.slice(0, 7));
      }} onDblClick=${() => {
        setSel(k);
        setTimeout(() => inp.current && inp.current.focus(), 30);
      }}>
      <span class="dn">${+k.slice(8)}</span>
      ${its.slice(0, 3).map(x => html`<span class=${"cc" + (x.src === "moodle" ? " k" : "") + (x.done ? " dn2" : "") + (x.multi ? " sp" + (k === dkey(new Date(x.t)) || i % 7 === 0 ? " sb" : "") + (k === dkey(new Date(x.e)) || i % 7 === 6 ? " se" : "") : "")}>${x.multi && k !== dkey(new Date(x.t)) && i % 7 !== 0 ? " " : x.title}</span>`)}
      ${its.length > 3 ? html`<span class="cm">+${its.length - 3}</span>` : null}
      ${its.length > 2 ? html`<span class="cmp">+${its.length - 2}</span>` : null}
    </button>`);
  }
  const day = by[sel] || [];
  const inMonth = Object.entries(by)
    .filter(([k]) => k.slice(0, 7) === month)
    .reduce((a, [, v]) => a + v.filter(x => x.kind !== "opens").length, 0);
  return html`<${Panel}><div><div class="mg">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => html`<div class="mgh">${d}</div>`)}${cells}</div>
    <div class="ll"><${Group} title=${dayLabel(sel) + (sel === today() ? "" : " · " + fmt(dAt(sel), { month: "short", day: "numeric" }))}/><${ClassDay} day=${sel}/>
      ${day.length ? day.map(x => html`<${Entry} key=${x.id} x=${x} edit=${edit} setEdit=${setEdit}/>`) : html`<${Empty} pad>No events on this day.<//>`}</div>
    <${QuickAdd} cls="daybar" day=${sel} inputRef=${inp}/></div><//>`;
}

/* one field: "quiz fri 3pm #cs101". No date given = the day passed in. A preview line shows how it was read. */
function QuickAdd({ day, cls = "", inputRef, pre, post }) {
  const [t, setT] = useState("");
  const w = parse(t, day);
  const add = () => {
    if (!w.title) return;
    W.add("events", {
      title: w.title,
      start: dAt(w.date, w.time || "23:59").toISOString(),
      ...(w.end ? { end: dAt(w.end, w.time || "23:59").toISOString() } : {}),
      allDay: !w.time,
      tag: w.tag,
      done: false,
      ...(w.remind ? { remind: w.remind } : {}),
    });
    if (w.remind) askPermission();
    setT("");
  };
  return html`<${Tools} cls=${"qadd " + cls}>${pre}<${AutoField} mode="cal" inputRef=${inputRef} placeholder="Add · quiz fri 3pm #cs101 !15m" aria-label="New entry" value=${t} onInput=${e => setT(e.target.value)} onEnter=${add}/><${AddBtn} onClick=${add}/>${post}
    ${w.title ? html`<div class="qprev">${rangeLabel(w.date, w.end)}${w.time ? " · " + timeLabel(dAt(w.date, w.time).getTime()) : " · all day"}${w.tag ? html` <span class="tag">${w.tag}</span>` : null}${w.remind ? html` · <${Icon} n="bell"/>${w.remind >= 60 && w.remind % 60 === 0 ? w.remind / 60 + "h" : w.remind + "m"} before` : null}</div>` : null}<//>`;
}
const parse = (s, day) => parseWhen(s, day);

function Calendar() {
  useCols("classes", "events", "ticks");
  const [mode, setMode] = usePref("os-calmode", "list");
  const [past, setPast] = useState(false),
    [month, setMonth] = useState(today().slice(0, 7)),
    [sel, setSel] = useState(today()),
    [edit, setEdit] = useState(null);
  const go = n => () => setMonth(addMonths(month + "-01", n).slice(0, 7));
  const seg = html`<${Seg}>${[
    ["list", "List", "list"],
    ["box", "Boxes", "grid"],
    ["classes", "Classes", "calendar"],
  ].map(
    ([k, l, i]) =>
      html`<${Btn} icon=${i} aria-label=${l} aria-pressed=${String(mode === k)} onClick=${() => {
        setMode(k);
        setEdit(null);
      }}><span class="lbl">${l}</span><//>`,
  )}<//>`;
  if (mode === "classes") return html`<${Tools}>${seg}<//><${Schedule}/>`;
  return html`${
    mode === "list"
      ? html`<${QuickAdd} cls="calq" day=${today()} pre=${seg} post=${html`<${Btn} cls="pastb" icon="clock" aria-label="Show past" aria-pressed=${String(past)} onClick=${() => setPast(!past)}><span class="lbl">Past</span><//>`}/>`
      : html`<${Tools} cls="calm">${seg}<${Btn} wide=${30} aria-label="Previous month" onClick=${go(-1)}>◂<//><b class="mon"><span class="ml">${fmt(dAt(month + "-01"), { month: "long", year: "numeric" })}</span><span class="ms">${fmt(dAt(month + "-01"), { month: "short", year: "numeric" })}</span></b><${Btn} wide=${30} aria-label="Next month" onClick=${go(1)}>▸<//>
        <${Btn} cls="tdy" onClick=${() => {
          setMonth(today().slice(0, 7));
          setSel(today());
        }}>Today<//><//>`
  }
    ${mode === "box" ? html`<${Boxes} month=${month} setMonth=${setMonth} sel=${sel} setSel=${setSel} edit=${edit} setEdit=${setEdit}/>` : html`<${ListView} past=${past} edit=${edit} setEdit=${setEdit}/>`}`;
}

/* "quiz fri 3pm #cs101 !15m", "report due 11-02", "bday dec 12", "meeting tmrw 2pm 30 min before" */
function parseWhen(s, day) {
  const p = nlpWhen(s);
  let date = p.date,
    time = p.time;
  if (!date && p.rel) {
    const at = Date.now() + p.rel;
    date = dkey(new Date(at));
    time = time || hm(at);
  }
  if (!date && time)
    date =
      dAt(day || today(), time).getTime() > Date.now() || (day && day !== today())
        ? day || today()
        : addDays(today(), 1);
  return {
    date: date || day || null,
    end: date ? p.end : null,
    time,
    title: p.title,
    tag: (p.tags[0] || "").slice(0, 14),
    remind: p.before,
    has: p.hasWhen,
  };
}
export default {
  id: "calendar",
  name: "Calendar",
  title: "calendar",
  Comp: Calendar,
  tab: true,
  search: q =>
    calItems()
      .filter(x => x.title.toLowerCase().includes(q))
      .slice(0, 3)
      .map(x => ({
        icon: "calendar",
        l: "Event: " + x.title + " · " + dayLabel(dkey(new Date(x.t))),
        r: () => openMod("calendar", true),
      })),
  cmd: (v, arg) => {
    if (!["event", "due", "cal", "ev"].includes(v)) return [];
    const w = parseWhen(arg);
    return w.title && w.date
      ? [
          {
            icon: "calendar",
            l:
              "Event: " +
              w.title +
              " · " +
              rangeLabel(w.date, w.end) +
              (w.time ? " " + timeLabel(dAt(w.date, w.time).getTime()) : "") +
              (w.remind ? " · alert " + w.remind + "m before" : ""),
            r: () => {
              W.add("events", {
                title: w.title,
                start: dAt(w.date, w.time || "23:59").toISOString(),
                ...(w.end ? { end: dAt(w.end, w.time || "23:59").toISOString() } : {}),
                allDay: !w.time,
                tag: w.tag,
                done: false,
                ...(w.remind ? { remind: w.remind } : {}),
              });
              if (w.remind) askPermission();
              openMod("calendar");
            },
          },
        ]
      : [{ l: "event quiz fri 3pm   (add a date: fri, 11-02, tmrw)", hint: true }];
  },
};
