/* Connections between pages: rels {a, b, label}. a -> b reads "a <label> b" (Mom · works at · Acme).
   Shown on both pages, drawn as solid edges in the graph ([[links]] are the dashed ones). */
import { useState, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { useCols, W, D } from "../core/store.js";
import { Combo, Select, Btn, Icon } from "../ui/index.js";
import { KINDS, byTitle, makePage } from "./pages.js";

/* topics link to topics, people to people/places: the labels offered first follow the page's kind */
export const TOPIC = [
  "related to",
  "part of",
  "example of",
  "leads to",
  "depends on",
  "opposite of",
  "see also",
];
export const LABELS = [
  "friend",
  "family",
  "partner",
  "works at",
  "studied at",
  "lives in",
  "met at",
  "client of",
  "knows",
  "part of",
  "owns",
];
const PEOPLE = new Set(["person", "company", "place"]);
const low = s =>
  String(s || "")
    .trim()
    .toLowerCase();
export const relsOf = id => D.rels.filter(r => r.a === id || r.b === id);
export const dropRels = id => relsOf(id).forEach(r => W.del("rels", r._id));
export const labelsInUse = (kind = "note") => [
  ...new Set([
    ...D.rels.map(r => r.label).filter(Boolean),
    ...(PEOPLE.has(kind) ? [...LABELS, ...TOPIC] : [...TOPIC, ...LABELS]),
  ]),
];

/* connect page id -> title (made if it doesn't exist, as `kind`) */
export function connect(id, label, title, kind = "note") {
  const t = String(title || "").trim();
  if (!t) return null;
  const ex = byTitle(t),
    b = ex ? ex._id : makePage({ title: t, kind });
  if (b === id) return null;
  const l = String(label || "")
    .trim()
    .toLowerCase()
    .slice(0, 40);
  if (D.rels.some(r => r.a === id && r.b === b && low(r.label) === l)) return b;
  W.add("rels", { a: id, b, label: l });
  return b;
}

/* the add row: "<label> <page>" (+ kind when the page is new) */
export function AddRel({ id, onDone, compact }) {
  const me = D.pages.find(x => x._id === id),
    mk = (me && me.kind) || "note";
  const [l, setL] = useState(""),
    [t, setT] = useState(""),
    [k, setK] = useState(mk === "subject" ? "note" : mk);
  const isNew = t.trim() && !byTitle(t);
  const go = () => {
    if (!t.trim()) return;
    connect(id, l, t, k);
    setT("");
    if (onDone) onDone();
  };
  return html`<div class=${"cxa" + (compact ? " c" : "")}>
    <${Combo} value=${l} onInput=${setL} options=${() => labelsInUse(mk)} placeholder=${PEOPLE.has(mk) ? "how (works at…)" : "how (related to…)"} aria-label="Connection label" maxlength="40"/>
    <${Combo} value=${t} onInput=${setT} options=${() => D.pages.filter(p => p._id !== id).map(p => p.title)} placeholder="which page" aria-label="Connect to" maxlength="120" onEnter=${go}/>
    ${isNew ? html`<${Select} opts=${KINDS} value=${k} onChange=${setK}/>` : null}
    <${Btn} go icon="plus" onClick=${go}>Link<//>
  </div>`;
}

export function Connections({ p, go, adding: start }) {
  useCols("rels", "pages");
  const [adding, setAdding] = useState(!!start);
  useEffect(() => {
    if (start) setAdding(true);
  }, [start]);
  const page = id => D.pages.find(x => x._id === id);
  const rs = relsOf(p._id)
    .map(r => ({ r, out: r.a === p._id, o: page(r.a === p._id ? r.b : r.a) }))
    .filter(x => x.o)
    .sort(
      (x, y) =>
        String(x.r.label).localeCompare(String(y.r.label)) ||
        String(x.o.title).localeCompare(String(y.o.title)),
    );
  return html`<div class="cx">
    <div class="cxh"><small>Connections${rs.length ? " · " + rs.length : ""}</small><button class="ppadd" onClick=${() => setAdding(!adding)}><${Icon} n=${adding ? "skip" : "plus"}/>${adding ? "Close" : "Connect"}</button></div>
    ${rs.map(
      ({ r, out, o }) => html`<div class="cxr" key=${r._id}>
      ${out ? null : html`<button class="blk" onClick=${() => go(o.title)}><${Icon} n=${o.kind || "note"}/>${o.title}</button>`}
      <span class="cl">${r.label || "linked"}</span><span class="ca" aria-hidden="true">→</span>
      ${out ? html`<button class="blk" onClick=${() => go(o.title)}><${Icon} n=${o.kind || "note"}/>${o.title}</button>` : html`<span class="cme">this</span>`}
      <button class="x1" aria-label="Remove connection" onClick=${() => W.del("rels", r._id)}>×</button></div>`,
    )}
    ${adding ? html`<${AddRel} id=${p._id}/>` : null}
  </div>`;
}
