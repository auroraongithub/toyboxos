import { amount, when } from "../core/nlp.js";
import { addLoan } from "./loans.js";
import { useState } from "preact/hooks";
import { html, fmt, dAt, today, addMonths, ago, money, plural } from "../core/lib.js";
import { ls } from "../core/pref.js";
import { useCols, W, D, toPHP, fxNote, drop } from "../core/store.js";
import {
  Tools,
  Panel,
  List,
  StatusBar,
  AddBtn,
  Field,
  Select,
  curs,
  CYC,
  TYP,
  Tabs,
  Btn,
  Del,
  Empty,
  EditRow,
  Group,
  Brand,
} from "../ui/index.js";
import { brands, brandFor } from "../ui/icons.js";
import { openMod } from "../shell/os.js";
import { Budgets, categorySelect, categoryOptions } from "./budgets.js";
import { expenseCategory } from "../core/budgets.js";

import { home, curPick } from "../core/profile.js";
export const nextDue = s => {
  let d = s.next || today();
  let g = 0;
  const step = s.cycle === "yr" ? 12 : 1;
  while (d < today() && g++ < 600) d = addMonths(d, step);
  return d;
};

function LogForm() {
  const [type, setType] = useState("out"),
    [am, setAm] = useState(""),
    [cur, setCur] = useState(curPick()),
    [nt, setNt] = useState(""),
    [category, setCategory] = useState("");
  const add = () => {
    const a = parseFloat(am);
    if (!(a > 0)) return;
    W.add("tx", {
      type,
      amt: a,
      cur,
      note: nt.trim(),
      category: type === "out" ? category : "",
      date: today(),
    });
    setAm("");
    setNt("");
  };
  return html`<${Tools} cls="addrow"><${Field} w="s" type="number" inputMode="decimal" min="0" step="any" placeholder="Amount" style="width:96px;flex:0 1 96px" aria-label="Amount" value=${am} onInput=${e => setAm(e.target.value)} onEnter=${add}/>
    <${Select} opts=${curs()} value=${cur} onChange=${x => {
      setCur(x);
      ls.set("os-cur", x);
    }}/><${Select} opts=${TYP} value=${type} onChange=${setType}/>
    <${Field} w="w" placeholder="What for" maxlength="60" aria-label="Note" value=${nt} onInput=${e => setNt(e.target.value)} onEnter=${add}/>
    ${type === "out" ? html`<${Select} opts=${categorySelect()} value=${category} onChange=${setCategory}/>` : null}
    <${AddBtn} onClick=${add}/><//>`;
}
function SubForm() {
  const [q, setQ] = useState(""),
    [chosen, setChosen] = useState(null),
    [am, setAm] = useState(""),
    [cur, setCur] = useState(curPick()),
    [cy, setCy] = useState("mo"),
    [nx, setNx] = useState(addMonths(today(), 1));
  const v = q.trim().toLowerCase();
  const hits =
    !v || (chosen && chosen.name.toLowerCase() === v)
      ? []
      : Object.entries(brands)
          .filter(([k, i]) => i.t.toLowerCase().includes(v) || k.includes(v))
          .slice(0, 8);
  const add = () => {
    const a = parseFloat(am),
      n = q.trim();
    if (!n || !(a >= 0) || !nx) return;
    W.add("subs", {
      name: n,
      slug: chosen && chosen.name === n ? chosen.slug : brandFor(n),
      amt: a,
      cur,
      cycle: cy,
      next: nx,
    });
    setChosen(null);
    setQ("");
    setAm("");
  };
  return html`<${Tools} cls="addrow">
    <${Field} w="w" placeholder="Service (netflix, spotify…)" maxlength="40" aria-label="Service" value=${q} onInput=${e => {
      setQ(e.target.value);
      setChosen(null);
    }} onEnter=${add}/>
    <${Field} w="s" type="number" inputMode="decimal" min="0" step="any" placeholder="Price" style="width:84px;flex:0 1 84px" aria-label="Price" value=${am} onInput=${e => setAm(e.target.value)} onEnter=${add}/>
    <${Select} opts=${curs()} value=${cur} onChange=${setCur}/><${Select} opts=${CYC} value=${cy} onChange=${setCy}/>
    <${Field} w="s" type="date" aria-label="Next charge" value=${nx} onInput=${e => setNx(e.target.value)}/>
    <${AddBtn} onClick=${add}/>
    ${
      hits.length
        ? html`<div class="pick" style="flex-basis:100%">${hits.map(
            ([k, i]) =>
              html`<${Btn} onClick=${() => {
                setChosen({ name: i.t, slug: k });
                setQ(i.t);
              }}><${Brand} slug=${k}/>${i.t}<//>`,
          )}</div>`
        : null
    }
  <//>`;
}
function Log() {
  const [edit, setEdit] = useState(null);
  const mk = today().slice(0, 7);
  const mine = D.tx
    .filter(x => (x.date || "").slice(0, 7) === mk)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.at).localeCompare(String(a.at)));
  return html`<${Group} title=${fmt(new Date(), { month: "long", year: "numeric" })}/>
    ${mine.map(x =>
      edit === x._id
        ? html`<${EditRow} key=${x._id} specs=${[
            { k: "type", t: "type" },
            { k: "amt", t: "num", ph: "Amount" },
            { k: "cur", t: "cur" },
            { k: "note", t: "text", ph: "What for", w: "w" },
            { k: "category", t: "text", ph: "Category" },
            { k: "date", t: "date" },
          ]} init=${x}
          onSave=${p => {
            if (p.amt > 0)
              W.upd("tx", x._id, {
                type: p.type,
                amt: p.amt,
                cur: p.cur,
                note: p.note,
                category: p.type === "out" ? p.category : "",
                date: p.date || x.date,
              });
          }} onCancel=${() => setEdit(null)}/>`
        : html`<div key=${x._id} class="lr"><span class="when" style="min-width:44px">${fmt(dAt(x.date), { month: "short", day: "numeric" })}</span>
        <span class="tt ed" style="font-weight:400" title="Click to edit" onClick=${() => setEdit(x._id)}>${x.note || (x.type === "in" ? "Income" : "Expense")}${x.category && x.type === "out" ? html`<span class="sub"> · ${x.category}</span>` : null}</span>
        <span class=${"amt" + (x.type === "in" ? " in" : "")}>${money(x.amt, x.cur)}</span><${Del} onClick=${() => drop("tx", x._id)}/></div>`,
    )}
    ${mine.length ? null : html`<${Empty}>Nothing logged this month.<//>`}`;
}
function Subs() {
  const [edit, setEdit] = useState(null);
  const subs = D.subs.map(s => ({ s, d: nextDue(s) })).sort((a, b) => a.d.localeCompare(b.d));
  return html`${subs.map(({ s, d }) =>
    edit === s._id
      ? html`<${EditRow} key=${s._id} specs=${[
          { k: "name", t: "text", ph: "Name", w: "w" },
          { k: "amt", t: "num", ph: "Price" },
          { k: "cur", t: "cur" },
          { k: "cycle", t: "cycle" },
          { k: "next", t: "date" },
        ]} init=${s}
        onSave=${o => {
          if (o.name)
            W.upd("subs", s._id, {
              name: o.name,
              slug: o.name === s.name ? s.slug : brandFor(o.name),
              amt: o.amt,
              cur: o.cur,
              cycle: o.cycle,
              next: o.next || s.next,
            });
        }} onCancel=${() => setEdit(null)}/>`
      : html`<div key=${s._id} class="lr"><span class="logo">${(s.slug && brands[s.slug] && s.slug) || brandFor(s.name) ? html`<${Brand} slug=${(s.slug && brands[s.slug] && s.slug) || brandFor(s.name)}/>` : (s.name || "?")[0].toUpperCase()}</span>
      <span class="tt ed" title="Click to edit" onClick=${() => setEdit(s._id)}>${s.name}</span><span class="sub">${ago(d)}</span>
      <span class="amt">${money(s.amt, s.cur) + (s.cycle === "yr" ? "/yr" : "")}</span><${Del} onClick=${() => drop("subs", s._id, "Subscription deleted")}/></div>`,
  )}
    ${subs.length ? null : html`<${Empty}>No subscriptions yet.<//>`}`;
}
const monthTx = () => {
  const mk = today().slice(0, 7);
  return D.tx.filter(x => (x.date || "").slice(0, 7) === mk);
};
function stats(tab) {
  if (tab === "log") {
    const mine = monthTx();
    return mine.length
      ? [
          mine.length + (mine.length === 1 ? " entry" : " entries"),
          mine.some(x => x.cur !== home()) ? fxNote() : null,
        ]
      : ["This month"];
  }
  return D.subs.length
    ? [plural(D.subs.length, "subscription"), D.subs.some(s => s.cur !== home()) ? fxNote() : null]
    : ["No subscriptions"];
}
/* the month's numbers up top, where a phone looks first */
function Sum({ tab }) {
  if (tab === "log") {
    const mine = monthTx();
    if (!mine.length) return null;
    const i = mine.filter(x => x.type === "in").reduce((a, x) => a + toPHP(x.amt, x.cur), 0),
      o = mine.filter(x => x.type === "out").reduce((a, x) => a + toPHP(x.amt, x.cur), 0);
    return html`<div class="msum"><div class="big"><small>Spent this month</small><b>${money(o, home())}</b></div>
      <div><small>In</small><b>${money(i, home())}</b></div><div><small>Net</small><b>${(i - o < 0 ? "-" : "") + money(Math.abs(i - o), home())}</b></div>${mine.some(x => x.cur !== home()) ? html`<em class="mfx">${fxNote()}</em>` : null}</div>`;
  }
  if (!D.subs.length) return null;
  const m = D.subs.reduce((a, s) => a + toPHP(s.cycle === "yr" ? s.amt / 12 : s.amt, s.cur), 0);
  return html`<div class="msum"><div class="big"><small>Subscriptions a month</small><b>${money(m, home())}</b></div><div><small>A year</small><b>${money(m * 12, home())}</b></div>${D.subs.some(s => s.cur !== home()) ? html`<em class="mfx">${fxNote()}</em>` : null}</div>`;
}
function Money() {
  useCols("tx", "subs", "config", "budgets", "loans");
  const [tab, setTab] = useState("log");
  return html`${tab === "log" ? html`<${LogForm}/>` : html`<${SubForm}/>`}
    <${Tabs} items=${[
      ["log", "Log"],
      ["subs", "Subscriptions"],
    ]} cur=${tab} onChange=${setTab}/>
    <${Panel}><${List}>${tab === "log" ? html`<${Budgets}/><${Log}/>` : html`<${Subs}/>`}<//><//><${StatusBar} keep items=${stats(tab)}/>`;
}
/* the Money hub shows these as its own tabs */
export function Spending() {
  useCols("tx", "config", "budgets");
  return html`<${Sum} tab="log"/><${LogForm}/><${Panel}><${List}><${Budgets}/><${Log}/><//><//>`;
}
export function SubsView() {
  useCols("subs", "config");
  return html`<${Sum} tab="subs"/><${SubForm}/><${Panel}><${List}><${Subs}/><//><//>`;
}
export default {
  id: "money",
  name: "Money",
  title: "money",
  Comp: Money,
  search: q =>
    [
      ...D.subs.filter(s => s.name.toLowerCase().includes(q)).map(s => "Subscription: " + s.name),
      ...(D.loans || [])
        .filter(l => !l.paid && l.name.toLowerCase().includes(q))
        .map(l => "Loan: " + l.name + " · " + money(l.amt, l.cur)),
      ...D.tx
        .filter(x => (x.note || "").toLowerCase().includes(q))
        .slice(0, 2)
        .map(x => "Money: " + x.note + " · " + money(x.amt, x.cur)),
    ]
      .slice(0, 3)
      .map(l => ({ icon: "money", l, r: () => openMod(l.startsWith("Sub") ? "subs" : "money", true) })),
  cmd: (v, arg) => {
    const out = [];
    const num = s => parseFloat(s.replace(/,/g, ""));
    const exp = ["spent", "spend", "paid", "exp", "expense", "bought"].includes(v),
      inc = ["earned", "got", "income", "earn", "received", "salary"].includes(v);
    if (exp || inc) {
      const mm = amount(v === "bought" ? arg : arg);
      if (mm) {
        const a = mm.amt,
          cu = mm.cur,
          { note, category } = inc
            ? { note: mm.rest, category: "" }
            : expenseCategory(mm.rest, categoryOptions());
        out.push({
          icon: "money",
          l:
            (inc ? "Earned " : "Spent ") +
            money(a, cu) +
            (note ? " · " + note : "") +
            (category ? " · " + category : ""),
          r: () => {
            W.add("tx", { type: inc ? "in" : "out", amt: a, cur: cu, note, category, date: today() });
            openMod("money");
          },
        });
      } else out.push({ l: (inc ? "earned" : "spent") + " 250 lunch   ($ for USD)", hint: true });
    }
    if (v === "sub") {
      const am = amount(arg),
        mm =
          am && am.rest
            ? [
                0,
                am.rest.replace(/\s*(\/|a|per)?\s*(mo|month|monthly)$/i, ""),
                am.cur === "USD" ? "$" : "",
                String(am.amt),
              ]
            : null;
      if (mm) {
        const slug = brandFor(mm[1]),
          nm = slug ? brands[slug].t : mm[1],
          a = num(mm[3]),
          cu = mm[2] ? "USD" : home();
        out.push({
          icon: "money",
          l: "Subscription: " + nm + " · " + money(a, cu) + "/mo",
          r: () => {
            W.add("subs", { name: nm, slug, amt: a, cur: cu, cycle: "mo", next: addMonths(today(), 1) });
            openMod("subs");
          },
        });
      } else out.push({ l: "sub netflix 549", hint: true });
    }
    if (["loan", "owe", "lent", "lend"].includes(v)) {
      const am = amount(arg),
        p = am ? when(am.rest, { loose: false }) : null,
        name = p
          ? p.title
              .replace(/^(from|to|for)\s+/i, "")
              .replace(/\s*due\s*$/i, "")
              .trim()
          : "",
        dir = v === "lent" || v === "lend" ? "owed" : "owe";
      if (am && name)
        out.push({
          icon: "money",
          l:
            (dir === "owed" ? "Lent " : "Loan: ") +
            name +
            " · " +
            money(am.amt, am.cur) +
            (p.date ? " · due " + p.date : ""),
          r: () => {
            addLoan({ name, amt: am.amt, cur: am.cur, dir, due: p.date || "" });
            openMod("loans");
          },
        });
      else out.push({ l: "loan 2480 tala due dec 27   (lent 500 juan = they owe you)", hint: true });
    }
    return out;
  },
};
