/* Loans: what you owe and what people owe you. Not spending: a loan is an open balance with a due date.
   Unpaid loans with a due date nudge you 3 days and 1 day before, and on the day (core/alarms.js reads `loans` directly). */
import { useState } from "preact/hooks";
import { html, money, ago, today } from "../core/lib.js";
import { ls } from "../core/pref.js";
import { useCols, W, D, toPHP, fxNote, drop } from "../core/store.js";
import { toast } from "../core/bus.js";
import {
  Tools,
  Panel,
  List,
  AddBtn,
  Field,
  Select,
  curs,
  Check,
  Del,
  Empty,
  EditRow,
  Group,
  DIRS,
} from "../ui/index.js";

import { home, curPick } from "../core/profile.js";
const SPECS = [
  { k: "name", t: "text", ph: "Who / what", w: "w" },
  { k: "amt", t: "num", ph: "Amount" },
  { k: "cur", t: "cur" },
  { k: "dir", t: "dir" },
  { k: "due", t: "date" },
];
const open = () =>
  D.loans
    .filter(l => !l.paid)
    .sort(
      (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || String(a.at).localeCompare(String(b.at)),
    );

/* paying off a loan you owe can also go in the log as one expense (Undo-style button on the toast) */
export function setPaid(l, paid) {
  W.upd("loans", l._id, { paid });
  if (paid && l.dir !== "owed")
    toast("Marked paid", {
      label: "Log expense",
      run: () =>
        W.add("tx", {
          type: "out",
          amt: l.amt,
          cur: l.cur,
          note: "Loan: " + l.name,
          category: "",
          date: today(),
        }),
    });
  else if (paid)
    toast("Marked paid", {
      label: "Log income",
      run: () =>
        W.add("tx", {
          type: "in",
          amt: l.amt,
          cur: l.cur,
          note: "Loan paid back: " + l.name,
          category: "",
          date: today(),
        }),
    });
}
export const addLoan = o =>
  W.add("loans", {
    name: o.name,
    amt: o.amt,
    cur: o.cur || home(),
    dir: o.dir || "owe",
    due: o.due || "",
    paid: false,
  });

function Form() {
  const [n, setN] = useState(""),
    [a, setA] = useState(""),
    [c, setC] = useState(curPick()),
    [d, setD] = useState("owe"),
    [due, setDue] = useState("");
  const add = () => {
    const v = n.trim(),
      x = parseFloat(a);
    if (!v || !(x > 0)) return;
    addLoan({ name: v, amt: x, cur: c, dir: d, due });
    setN("");
    setA("");
    setDue("");
  };
  return html`<${Tools} cls="addrow">
    <${Field} w="w" placeholder="Who / what (tala, juan…)" maxlength="60" aria-label="Loan" value=${n} onInput=${e => setN(e.target.value)} onEnter=${add}/>
    <${Field} w="s" type="number" inputMode="decimal" min="0" step="any" placeholder="Amount" style="width:84px;flex:0 1 84px" aria-label="Amount" value=${a} onInput=${e => setA(e.target.value)} onEnter=${add}/>
    <${Select} opts=${curs()} value=${c} onChange=${setC}/><${Select} opts=${DIRS} value=${d} onChange=${setD}/>
    <${Field} w="s" type="date" aria-label="Due" value=${due} onInput=${e => setDue(e.target.value)}/>
    <${AddBtn} onClick=${add}/><//>`;
}

function Sum() {
  const l = open();
  if (!l.length) return null;
  const sum = dir => l.filter(x => (x.dir || "owe") === dir).reduce((s, x) => s + toPHP(x.amt, x.cur), 0);
  return html`<div class="msum"><div class="big"><small>You owe</small><b>${money(sum("owe"), home())}</b></div>
    <div><small>Owed to you</small><b>${money(sum("owed"), home())}</b></div>${l.some(x => x.cur !== home()) ? html`<em class="mfx">${fxNote()}</em>` : null}</div>`;
}

function Row({ l, edit, setEdit }) {
  if (edit === l._id)
    return html`<${EditRow} key=${l._id} specs=${SPECS} init=${l}
    onSave=${o => {
      if (o.name && o.amt > 0)
        W.upd("loans", l._id, { name: o.name, amt: o.amt, cur: o.cur, dir: o.dir || "owe", due: o.due });
    }} onCancel=${() => setEdit(null)}/>`;
  const late = !l.paid && l.due && l.due < today();
  return html`<div key=${l._id} class=${"lr" + (l.paid ? " done" : "") + (late ? " late" : "")}>
    <${Check} on=${l.paid} label="Paid" onClick=${() => setPaid(l, !l.paid)}/>
    <span class="tt ed" title="Click to edit" onClick=${() => setEdit(l._id)}>${l.name}</span>
    ${l.dir === "owed" ? html`<span class="tag">owes you</span>` : null}
    ${l.due && !l.paid ? html`<span class="sub">${late ? ago(l.due).replace(" ago", " late") : ago(l.due)}</span>` : null}
    <span class=${"amt" + (l.dir === "owed" ? " in" : "")}>${money(l.amt, l.cur)}</span><${Del} onClick=${() => drop("loans", l._id, "Loan deleted")}/></div>`;
}

export function LoansView() {
  useCols("loans", "tx", "config");
  const [edit, setEdit] = useState(null),
    [all, setAll] = useState(false);
  const o = open(),
    paid = D.loans
      .filter(l => l.paid)
      .sort((a, b) => String(b.upd || b.at).localeCompare(String(a.upd || a.at)));
  return html`<${Sum}/><${Form}/><${Panel}><${List}>
    ${o.length ? o.map(l => html`<${Row} l=${l} edit=${edit} setEdit=${setEdit}/>`) : html`<${Empty}>No open loans. Try “loan 2480 tala due dec 27”.<//>`}
    ${paid.length ? html`<${Group} title="Paid" meta=${html`<button class="gl" onClick=${() => setAll(!all)}>${all ? "hide" : "show " + paid.length}</button>`}/>${all ? paid.slice(0, 15).map(l => html`<${Row} l=${l} edit=${edit} setEdit=${setEdit}/>`) : null}` : null}
  <//><//>`;
}
