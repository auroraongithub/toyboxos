import { amount } from "../core/nlp.js";
import { useState } from "preact/hooks";
import { html, money } from "../core/lib.js";
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
  Check,
  Star,
  Del,
  Empty,
  EditRow,
} from "../ui/index.js";
import { openMod } from "../shell/os.js";

import { home, curPick } from "../core/profile.js";
function Wishlist() {
  useCols("wishes", "config");
  const [n, setN] = useState(""),
    [p, setP] = useState(""),
    [c, setC] = useState(curPick()),
    [l, setL] = useState(""),
    [edit, setEdit] = useState(null);
  const add = () => {
    const v = n.trim();
    if (!v) return;
    W.add("wishes", { name: v, price: parseFloat(p) || 0, cur: c, link: l.trim(), got: false, star: false });
    setN("");
    setP("");
    setL("");
  };
  const w = D.wishes
    .slice()
    .sort(
      (a, b) =>
        (a.got ? 1 : 0) - (b.got ? 1 : 0) ||
        (b.star ? 1 : 0) - (a.star ? 1 : 0) ||
        String(b.at).localeCompare(String(a.at)),
    );
  const want = w.filter(x => !x.got),
    tot = want.reduce((a, x) => a + toPHP(x.price || 0, x.cur), 0);
  return html`<${Tools} cls="addrow">
      <${Field} w="w" placeholder="Something you want" maxlength="80" aria-label="Item" value=${n} onInput=${e => setN(e.target.value)} onEnter=${add}/>
      <${Field} w="s" type="number" inputMode="decimal" min="0" step="any" placeholder="Price" style="width:84px;flex:0 1 84px" aria-label="Price" value=${p} onInput=${e => setP(e.target.value)} onEnter=${add}/>
      <${Select} opts=${curs()} value=${c} onChange=${setC}/>
      <${Field} type="url" maxlength="300" placeholder="Link (optional)" aria-label="Link" value=${l} onInput=${e => setL(e.target.value)} onEnter=${add}/>
      <${AddBtn} onClick=${add}/>
    <//>
    <${Panel}><${List}>${
      w.length
        ? w.map(x =>
            edit === x._id
              ? html`<${EditRow} key=${x._id} specs=${[
                  { k: "name", t: "text", ph: "Item", w: "w" },
                  { k: "price", t: "num", ph: "Price" },
                  { k: "cur", t: "cur" },
                  { k: "link", t: "text", ph: "Link" },
                ]} init=${x}
          onSave=${o => {
            if (o.name) W.upd("wishes", x._id, { name: o.name, price: o.price, cur: o.cur, link: o.link });
          }} onCancel=${() => setEdit(null)}/>`
              : html`<div key=${x._id} class=${"lr" + (x.got ? " done" : "")}>
        <${Check} on=${x.got} label="Got it" onClick=${() => W.upd("wishes", x._id, { got: !x.got })}/>
        <${Star} on=${x.star} label="Priority" onClick=${() => W.upd("wishes", x._id, { star: !x.star })}/>
        <span class="tt ed" title="Click to edit" onClick=${() => setEdit(x._id)}>${x.name}</span>
        ${x.link ? html`<a class="tag" href=${x.link} target="_blank" rel="noopener" style="text-decoration:none">link ↗</a>` : null}
        ${x.price ? html`<span class="amt">${money(x.price, x.cur)}</span>` : null}
        <${Del} onClick=${() => drop("wishes", x._id)}/></div>`,
          )
        : html`<${Empty}>Nothing here yet.<//>`
    }<//><//>
    <${StatusBar} keep items=${[want.length + " wanted", money(tot, home()), want.some(x => x.cur !== home()) ? fxNote() : null]}/>`;
}
const num = s => parseFloat(s.replace(/,/g, ""));
export default {
  id: "wishlist",
  name: "Wishlist",
  title: "wishlist",
  Comp: Wishlist,
  search: q =>
    D.wishes
      .filter(w => w.name.toLowerCase().includes(q))
      .slice(0, 3)
      .map(w => ({ icon: "wishlist", l: "Wish: " + w.name, r: () => openMod("wishlist", true) })),
  cmd: (v, arg) => {
    if (v !== "wish") return [];
    const am = amount(arg),
      mm = am && am.rest ? [0, am.rest, am.cur === "USD" ? "$" : "", String(am.amt)] : null;
    const mk = (name, price, cur) => () => {
      W.add("wishes", { name, price, cur, link: "", got: false, star: false });
      openMod("wishlist");
    };
    if (mm)
      return [
        {
          icon: "wishlist",
          l: "Wish: " + mm[1] + " · " + money(num(mm[3]), mm[2] ? "USD" : home()),
          r: mk(mm[1], num(mm[3]), mm[2] ? "USD" : home()),
        },
      ];
    return arg
      ? [{ icon: "wishlist", l: "Wish: " + arg, r: mk(arg, 0, home()) }]
      : [{ icon: "wishlist", l: "Open Wishlist", r: () => openMod("wishlist", true) }];
  },
};
