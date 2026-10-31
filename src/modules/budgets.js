import { useState } from "preact/hooks";
import { html, today, money } from "../core/lib.js";
import { useCols, D, W, toPHP, drop } from "../core/store.js";
import { Group, Btn, Field, Select, curs, Del } from "../ui/index.js";
import { openSheet } from "../ui/sheet.js";
import { categoryKey as key, budgetUsage } from "../core/budgets.js";

import { home } from "../core/profile.js";
export function categoryOptions() {
  const names = [
    "Food",
    "Transport",
    "School",
    "Bills",
    "Shopping",
    ...D.tx.map(x => x.category),
    ...D.budgets.map(x => x.category),
  ];
  const categories = new Map();
  for (const name of names)
    if (key(name) && key(name) !== "uncategorized") categories.set(key(name), name.trim());
  return [...categories.values()].sort((a, b) => a.localeCompare(b));
}
export const categorySelect = () => [["", "Uncategorized"], ...categoryOptions().map(x => [x, x])];

function BudgetForm({ budget = {}, close }) {
  useCols("budgets");
  const [category, setCategory] = useState(budget.category || ""),
    [amt, setAmt] = useState(budget.amt ?? ""),
    [cur, setCur] = useState(budget.cur || home()),
    [err, setErr] = useState("");
  const save = e => {
    e.preventDefault();
    const n = Number(amt),
      name = category.trim();
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Enter a limit greater than zero.");
      return;
    }
    const existing = D.budgets.find(x => key(x.category) === key(name) && x._id !== budget._id);
    if (existing && budget._id) {
      setErr("That category already has a limit. Edit its existing limit instead.");
      return;
    }
    const id = budget._id || existing?._id,
      doc = { category: name, amt: n, cur };
    if (id) W.upd("budgets", id, doc);
    else W.add("budgets", doc);
    close();
  };
  return html`<form class="ask" onSubmit=${save}>
    <label for="budget-category">Category (blank = all spending)</label><${Field} id="budget-category" value=${category} maxlength="40" placeholder="Food" list="budget-categories" onInput=${e => setCategory(e.target.value)}/>
    <datalist id="budget-categories">${categoryOptions().map(x => html`<option value=${x}/>`)}<option value="Uncategorized"/></datalist>
    <label for="budget-amount">Monthly limit</label><${Field} id="budget-amount" type="number" inputMode="decimal" required min="0.01" step="any" value=${amt} onInput=${e => setAmt(e.target.value)}/>
    <${Select} opts=${curs()} value=${cur} onChange=${setCur}/>
    <div class="mini">Repeats each month. Counts logged expenses; income does not reduce spending.</div>
    ${err ? html`<div class="mini" role="alert">${err}</div>` : null}
    <div class="askb">${
      budget._id
        ? html`<${Btn} onClick=${() => {
            drop("budgets", budget._id, "Limit removed");
            close();
          }}>Delete<//>`
        : null
    }<span/><${Btn} onClick=${close}>Cancel<//><button type="submit" class="btn go">Save</button></div>
  </form>`;
}
const editBudget = budget =>
  openSheet({ title: budget ? "Edit limit" : "Add monthly limit", Body: BudgetForm, props: { budget } });

export function Budgets() {
  useCols("budgets", "tx", "config");
  const month = today().slice(0, 7);
  const budgets = D.budgets.slice().sort((a, b) => key(a.category).localeCompare(key(b.category)));
  return html`<${Group} title="Monthly limits" meta=${html`<${Btn} icon="plus" onClick=${() => editBudget()}>Add limit<//>`}/>
    ${budgets.map(b => {
      const { spent, left } = budgetUsage(b, D.tx, month, toPHP);
      return html`<div class="lr" key=${b._id}><span class="tt ed" title="Click to edit" onClick=${() => editBudget(b)}>${b.category || "All spending"}<br/><span class="sub">${money(spent, b.cur)} / ${money(b.amt, b.cur)}</span></span>
        <span class="amt">${money(Math.abs(left), b.cur)} ${left < 0 ? "over" : "left"}</span><${Del} onClick=${() => drop("budgets", b._id, "Limit removed")}/></div>`;
    })}`;
}
