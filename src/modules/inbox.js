/* Inbox: one-line jots. Each jot is its own tiny doc (so two devices jotting at once never overwrite each other);
   tap "page" to grow one into a real page. Long text or an explicit `note ...` still makes a page. */
import { useState } from "preact/hooks";
import { html, plural } from "../core/lib.js";
import { useCols, W, D } from "../core/store.js";
import { toast } from "../core/bus.js";
import { Tools, Panel, List, StatusBar, Btn, Del, Empty, Icon } from "../ui/index.js";
import { AutoField } from "../ui/suggest.js";
import { openMod } from "../shell/os.js";
import { newPage } from "./pages.js";

export const LONG = 100;
export const jots = () => D.jots.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
export const addJot = t => {
  t = String(t).trim();
  if (!t) return;
  W.add("jots", { text: t });
  toast("Jotted to Inbox");
};
/* turn a jot into a page (the page title is the jot), then drop the jot */
export function jotToPage(j) {
  const id = newPage({ title: j.text.slice(0, 80), body: j.text.length > 80 ? j.text : "" });
  W.del("jots", j._id);
  return id;
}

function Inbox() {
  useCols("jots", "pages");
  const [q, setQ] = useState("");
  const add = () => {
    if (!q.trim()) return;
    addJot(q);
    setQ("");
  };
  const list = jots();
  return html`<${Tools} cls="addrow"><${AutoField} placeholder="Jot an idea" aria-label="New jot" value=${q} onInput=${e => setQ(e.target.value)} onEnter=${add}/><${Btn} go icon="plus" aria-label="Add jot" onClick=${add}>Add<//><//>
    <${Panel}><${List}>${
      list.length
        ? list.map(
            j => html`<div class="lr jot" key=${j._id}>
        <span class="tt">${j.text}</span>
        <${Btn} cls="jb" icon="note" aria-label="Make this a page" title="Make this a page" onClick=${() => jotToPage(j)}><span class="jbl">Page</span><//>
        <${Del} onClick=${() => {
          const o = { ...j };
          delete o._id;
          W.del("jots", j._id);
          toast("Jot deleted", { label: "Undo", run: () => W.set("jots", j._id, o) });
        }}/></div>`,
          )
        : html`<${Empty}>Inbox is empty. Jot anything here, sort it out later.<//>`
    }<//><//>
`;
}
export default {
  id: "inbox",
  name: "Inbox",
  title: "inbox",
  Comp: Inbox,
  search: q =>
    D.jots
      .filter(j => j.text.toLowerCase().includes(q))
      .slice(0, 3)
      .map(j => ({ icon: "inbox", l: "Jot: " + j.text.slice(0, 50), r: () => openMod("inbox", true) })),
  cmd: (v, arg) =>
    ["jot", "j", "idea"].includes(v)
      ? [
          arg
            ? { icon: "inbox", l: "Jot: " + arg, r: () => addJot(arg) }
            : { icon: "inbox", l: "Open Inbox", r: () => openMod("inbox", true) },
        ]
      : [],
};
