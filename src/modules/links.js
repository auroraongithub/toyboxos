import { useState } from "preact/hooks";
import { html, openExternal } from "../core/lib.js";
import { useCols, W, D, drop } from "../core/store.js";
import { Tools, Panel, List, StatusBar, AddBtn, Field, Del, Empty, EditRow } from "../ui/index.js";
import { openMod } from "../shell/os.js";

const norm = u => {
  u = (u || "").trim();
  return u && !/^[a-z]+:\/\//i.test(u) ? "https://" + u : u;
};
const host = u => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch (e) {
    return u;
  }
};
function Links() {
  useCols("links");
  const [n, setN] = useState(""),
    [u, setU] = useState(""),
    [edit, setEdit] = useState(null);
  const add = () => {
    const url = norm(u);
    let name = n.trim() || host(url);
    if (!url) return;
    W.add("links", { name, url });
    setN("");
    setU("");
  };
  const ls = D.links.slice().sort((a, b) => a.name.localeCompare(b.name));
  return html`<${Tools} cls="addrow"><${Field} w="s" placeholder="Name" maxlength="30" aria-label="Name" style="flex:0 1 130px" value=${n} onInput=${e => setN(e.target.value)} onEnter=${add}/>
      <${Field} w="w" placeholder="Address (onlinejobs.ph)" maxlength="300" aria-label="Address" value=${u} onInput=${e => setU(e.target.value)} onEnter=${add}/><${AddBtn} onClick=${add}/><//>
    <${Panel}><${List}>${
      ls.length
        ? ls.map(l =>
            edit === l._id
              ? html`<${EditRow} key=${l._id} specs=${[
                  { k: "name", t: "text", ph: "Name" },
                  { k: "url", t: "text", ph: "Address", w: "w" },
                ]} init=${l} onSave=${o => {
                  if (o.url) W.upd("links", l._id, { name: o.name || host(o.url), url: norm(o.url) });
                }} onCancel=${() => setEdit(null)}/>`
              : html`<div key=${l._id} class="lr"><span class="logo">${(l.name || "?")[0].toUpperCase()}</span>
        <a class="tt" href=${l.url} target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${l.name}</a>
        <span class="sub ed" title="Click to edit" onClick=${() => setEdit(l._id)}>${host(l.url)}</span><${Del} onClick=${() => drop("links", l._id, "Link deleted")}/></div>`,
          )
        : html`<${Empty}>No links yet.<//>`
    }<//><//>
`;
}
export default {
  id: "links",
  name: "Links",
  title: "links",
  Comp: Links,
  search: q =>
    D.links
      .filter(l => (l.name + " " + l.url).toLowerCase().includes(q))
      .slice(0, 3)
      .map(l => ({ icon: "links", l: "Link: " + l.name, r: () => openExternal(l.url) })),
  cmd: (v, arg) =>
    v === "link" && arg
      ? (() => {
          const p = arg.split(/\s+/);
          const url = norm(p[p.length - 1]);
          const name = p.length > 1 ? p.slice(0, -1).join(" ") : host(url);
          return [
            {
              icon: "links",
              l: "Add link: " + name + " · " + host(url),
              r: () => {
                W.add("links", { name, url });
                openMod("links");
              },
            },
          ];
        })()
      : [],
};
