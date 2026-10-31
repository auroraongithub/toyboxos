/* Quick-add autocomplete: grey ghost text after what you typed; Tab, → at the end, the ⇥ button or a swipe right accepts it.
   complete(text, mode) returns the full suggested text (always starts with `text`) or "". */
import { useState, useRef, useLayoutEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { D } from "../core/store.js";
import { brands } from "./icons.js";

const VERBS = [
  "event",
  "todo",
  "spent",
  "earned",
  "sub",
  "habit",
  "note",
  "page",
  "person",
  "company",
  "place",
  "thing",
  "subject",
  "review",
  "timer",
  "link",
];
const DAYS = [
  "today",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const KIND_VERBS = {
  person: "person",
  company: "company",
  place: "place",
  thing: "thing",
  subject: "subject",
  page: null,
  link: null,
};
const low = s => String(s || "").toLowerCase();
const uniq = a => [...new Set(a.filter(Boolean))];
const tags = () =>
  uniq(
    [...D.events.map(e => e.tag), ...D.classes.map(c => c.code)].map(t =>
      String(t || "")
        .replace(/^#/, "")
        .toLowerCase(),
    ),
  );
/* first candidate that extends `typed` (case-insensitive), returned as the missing tail */
const tail = (typed, list) => {
  const t = low(typed);
  if (!t) return "";
  const hit = list.find(x => low(x).startsWith(t) && low(x) !== t);
  return hit ? hit.slice(typed.length) : "";
};

export function complete(text, mode = "quick") {
  if (!text || (/\s$/.test(text) && mode !== "quick")) return "";
  const m = text.match(/^(\S+)(\s+)([\s\S]*)$/),
    last = (text.match(/(\S*)$/) || ["", ""])[1];
  if (last.startsWith("#")) return text + tail(last.slice(1), tags());
  if (mode === "cal") {
    return /\s$/.test(text) ? "" : text + tail(last, DAYS);
  }
  if (!m) {
    const t = tail(text, VERBS);
    return t ? text + t + " " : "";
  }
  const verb = low(m[1]),
    arg = m[3];
  if (/\s$/.test(text)) return "";
  if (verb in KIND_VERBS) {
    const k = KIND_VERBS[verb];
    return (
      text +
      tail(
        arg,
        D.pages.filter(p => !k || p.kind === k).map(p => p.title),
      )
    );
  }
  if (["event", "ev", "todo", "task", "due"].includes(verb)) return text + tail(last, DAYS);
  if (verb === "sub")
    return (
      text +
      tail(
        arg,
        Object.values(brands).map(b => b.t),
      )
    );
  if (verb === "habit")
    return (
      text +
      tail(
        arg,
        D.habits.map(h => h.name),
      )
    );
  if (["spent", "earned"].includes(verb) && /^\$?[\d.,]+\s+\S/.test(arg)) {
    const note = arg.replace(/^\$?[\d.,]+\s+/, "");
    return text + tail(note, uniq(D.tx.map(x => x.note)));
  }
  return "";
}

/* drop-in for <Field>: same props + mode; handles Enter/Esc itself */
export function AutoField({
  value,
  onInput,
  onEnter,
  onEsc,
  mode = "quick",
  inputRef,
  w = "w",
  cls = "",
  ...p
}) {
  const sug = value ? complete(value, mode) : "",
    rest = sug && sug.length > value.length ? sug.slice(value.length) : "";
  const r = useRef(),
    [st, setSt] = useState(""),
    sw = useRef(null),
    pend = useRef(false);
  /* after accepting, the caret goes to the end once the new value is in the box (not on a timer, which raced fast typing) */
  useLayoutEffect(() => {
    if (pend.current && r.current) {
      pend.current = false;
      const n = r.current.value.length;
      r.current.setSelectionRange(n, n);
    }
  }, [value]);
  useLayoutEffect(() => {
    const el = r.current;
    if (!el) return;
    const c = getComputedStyle(el);
    setSt(
      `font:${c.fontStyle} ${c.fontWeight} ${c.fontSize}/${c.lineHeight} ${c.fontFamily};padding-left:${parseFloat(c.paddingLeft) + parseFloat(c.borderLeftWidth)}px;`,
    );
  }, []);
  const accept = () => {
    if (!rest) return false;
    pend.current = true;
    onInput({ target: { value: sug } });
    if (r.current) r.current.focus();
    return true;
  };
  const fits = r.current ? r.current.scrollWidth <= r.current.clientWidth + 1 : true;
  return html`<div class=${"af " + w}>
    <input ref=${e => {
      r.current = e;
      if (inputRef) inputRef.current = e;
    }} class=${"field " + w + (cls ? " " + cls : "")} value=${value} maxlength="200" autocomplete="off" autocapitalize="off" enterkeyhint="done"
      onInput=${onInput}
      onKeyDown=${e => {
        if (
          (e.key === "Tab" && !e.shiftKey) ||
          (e.key === "ArrowRight" && e.target.selectionStart === value.length)
        ) {
          if (accept()) e.preventDefault();
        } else if (e.key === "Enter" && onEnter) onEnter(e);
        else if (e.key === "Escape" && onEsc) onEsc(e);
      }}
      onPointerDown=${e => {
        sw.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp=${e => {
        const s = sw.current;
        sw.current = null;
        if (s && e.clientX - s.x > 40 && Math.abs(e.clientY - s.y) < 30) accept();
      }}
      ...${p}/>
    ${rest && fits ? html`<div class="afg" aria-hidden="true" style=${st}><span>${value}</span><b>${rest}</b></div>` : null}
    ${rest ? html`<button type="button" class="afb" aria-label=${"Complete: " + sug} title="Tab to complete" onPointerDown=${e => e.preventDefault()} onClick=${accept}>⇥</button>` : null}
  </div>`;
}
