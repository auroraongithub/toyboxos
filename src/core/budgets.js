export const categoryKey = s => (s || "").trim().toLowerCase();

/* #food in quick-add selects an existing category's spelling, or starts a new one. */
export function expenseCategory(text, categories = []) {
  const match = text.match(/(?:^|\s)#([\p{L}\p{N}_-]+)/u);
  if (!match) return { note: text, category: "" };
  const name = match[1].replace(/_/g, " ");
  return {
    note: text.replace(match[0], " ").trim(),
    category: categories.find(x => categoryKey(x) === categoryKey(name)) || name,
  };
}

export function budgetUsage(budget, transactions, month, convert) {
  const spent =
    transactions
      .filter(
        x =>
          x.type === "out" &&
          (x.date || "").slice(0, 7) === month &&
          (!budget.category || categoryKey(x.category || "Uncategorized") === categoryKey(budget.category)),
      )
      .reduce((n, x) => n + convert(x.amt, x.cur), 0) / convert(1, budget.cur);
  return { spent, left: Math.round((budget.amt - spent) * 100) / 100 || 0 };
}
