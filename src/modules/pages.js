/* Pages: the notes/wiki. Every page is markdown (edited as blocks, see editor.js) with a kind, an icon,
   optional fields, a parent (subjects hold their pages), [[links]], connections and backlinks.
   People/companies/places are the nodes of the graph; subjects + flashcards are the study side (study.js). */
import { useState, useEffect, useRef } from "preact/hooks";
import { html, plural, TZ } from "../core/lib.js";
import { usePref, useMedia, ls } from "../core/pref.js";
import { useCols, onChange, calItems, W, D } from "../core/store.js";
import { toast } from "../core/bus.js";
import { Tools, StatusBar, Btn, Field, Icon, Empty, useWinWidth } from "../ui/index.js";
import { openMod } from "../shell/os.js";
import { wikiTargets, renameLinks, frontMatter } from "../core/md.js";
import { saveFile } from "../core/files.js";
import { extract, docType, DOC_RE, MIME } from "../core/docs.js";
import { DocReader } from "./reader.js";
import { Connections, dropRels, relsOf } from "./rels.js";
import { openSheet, actionSheet, longPress } from "../ui/sheet.js";
import { pushBack, dropBack, fromBack } from "../core/back.js";
import { useScrollKey } from "../ui/gestures.js";
import { BlockEditor } from "./editor.js";
import { IconPick } from "../ui/emoji.js";
import { StudyBox, Deck, ancestors, kids, family, startReview, dueIn, cardsIn } from "./study.js";
import { ART } from "../core/pack.js";

export const KINDS = [
  ["note", "Note"],
  ["subject", "Subject"],
  ["person", "Person"],
  ["company", "Company"],
  ["place", "Place"],
  ["thing", "Thing"],
];
const PLURAL = {
  note: "Notes",
  subject: "Subjects",
  person: "People",
  company: "Companies",
  place: "Places",
  thing: "Things",
};
const FIELDS = {
  subject: ["Course code", "Teacher", "Schedule"],
  person: ["Relation", "Birthday", "Contact"],
  company: ["Website", "What they do"],
  place: ["Address"],
};

const stamp = () => new Date().toISOString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const low = s =>
  String(s || "")
    .trim()
    .toLowerCase();
export const byTitle = t => D.pages.find(p => low(p.title) === low(t));
const freeTitle = t => {
  let x = t,
    n = 2;
  while (byTitle(x)) x = t + " (" + n++ + ")";
  return x;
};
const when = iso => {
  const t = Date.parse(iso || "");
  if (!isFinite(t)) return "";
  const d = Date.now() - t;
  if (d < 6e4) return "now";
  if (d < 36e5) return Math.floor(d / 6e4) + "m";
  if (d < 864e5) return Math.floor(d / 36e5) + "h";
  if (d < 7 * 864e5) return Math.floor(d / 864e5) + "d";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
};
const plain = s =>
  String(s || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/\s::\s/g, " = ")
    .replace(/[#>*_`~|=\\-]+/g, " ")
    .replace(/\[( |x)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const PIcon = ({ p }) =>
  p.icon ? html`<span class="emj">${p.icon}</span>` : html`<${Icon} n=${p.kind || "note"}/>`;

export const openPage = id => {
  ls.set("os-page", id);
  openMod("notes", true);
};
/* create without opening (connections and [[new links]] make pages this way) */
export function makePage(o = {}) {
  const id = uid(),
    kind = o.kind || "note";
  W.set("pages", id, {
    body: "",
    icon: "",
    props: (FIELDS[kind] || []).map(k => [k, ""]),
    pin: false,
    at: stamp(),
    upd: stamp(),
    ...o,
    kind,
    title: freeTitle(o.title || "Untitled"),
  });
  return id;
}
export function newPage(o = {}) {
  const id = makePage(o);
  ls.set("os-page", id);
  ls.set("os-page-new", id);
  openMod("notes", true);
  return id;
}
/* "buy milk" -> page titled "buy milk"; longer text -> first line is the title */
export function quickNote(text, open = false) {
  const t = String(text).trim(),
    i = t.indexOf("\n"),
    title = (i < 0 ? t : t.slice(0, i)).slice(0, 80);
  const id = uid();
  W.set("pages", id, {
    title: freeTitle(title || "Note"),
    kind: "note",
    icon: "",
    body: i < 0 ? (t.length > 80 ? t : "") : t.slice(i + 1).trim(),
    props: [],
    pin: false,
    at: stamp(),
    upd: stamp(),
  });
  if (open) openPage(id);
  else toast("Saved to Notes");
  return id;
}

/* old one-line notes become pages (same id on every device, so two devices migrating don't duplicate) */
const moved = new Set();
onChange(c => {
  if (c !== "notes" && c !== "*") return;
  D.notes.forEach(n => {
    if (moved.has(n._id)) return;
    moved.add(n._id);
    const t = String(n.text || "").trim(),
      i = t.indexOf("\n"),
      line = i < 0 ? t : t.slice(0, i);
    W.set("pages", "n-" + n._id, {
      title: line.slice(0, 80) || "Note",
      kind: "note",
      body: i >= 0 ? t.slice(i + 1).trim() : line.length > 80 ? t : "",
      props: [],
      pin: !!n.pin,
      at: n.at || stamp(),
      upd: n.at || stamp(),
    });
    W.del("notes", n._id);
  });
});

/* ---------- page actions (the ⋯ button and long-press / right-click on a list row share these) ---------- */
const setKind = (p, k) => {
  const have = new Set((p.props || []).map(x => low(x[0])));
  W.upd("pages", p._id, {
    kind: k,
    props: [...(p.props || []), ...(FIELDS[k] || []).filter(f => !have.has(low(f))).map(f => [f, ""])],
    upd: stamp(),
  });
};
/* deletes right away; the toast's Undo puts the page, its sub-pages' parent and its connections back */
export function deletePage(p) {
  const doc = { ...p };
  delete doc._id;
  const ch = kids(p._id).map(c => c._id),
    rs = relsOf(p._id).map(r => {
      const o = { ...r };
      delete o._id;
      return [r._id, o];
    });
  ch.forEach(id => W.upd("pages", id, { parent: p.parent || "" }));
  W.del("pages", p._id);
  dropRels(p._id);
  if (ls.get("os-page", "") === p._id) ls.set("os-page", p.parent || "");
  toast("Deleted “" + (p.title || "Untitled") + "”", {
    label: "Undo",
    run: () => {
      W.set("pages", p._id, doc);
      ch.forEach(id => W.upd("pages", id, { parent: p._id }));
      rs.forEach(([id, o]) => W.set("rels", id, o));
    },
  });
}
function exportPage(p) {
  const fm = (p.props || []).filter(x => x[1]);
  const head =
    fm.length || p.kind !== "note" || p.icon
      ? "---\nkind: " +
        (p.kind || "note") +
        "\n" +
        (p.icon ? "icon: " + p.icon + "\n" : "") +
        fm.map(([k, v]) => k + ": " + v).join("\n") +
        "\n---\n"
      : "";
  const u = URL.createObjectURL(new Blob([head + (p.body || "")], { type: "text/markdown" })),
    a = document.createElement("a");
  a.href = u;
  a.download = (p.title || "page").replace(/[\/:*?"<>|]/g, "-") + ".md";
  a.click();
  URL.revokeObjectURL(u);
}
function MoveTo({ p, close }) {
  const [q, setQ] = useState("");
  const fam = new Set(family(p._id));
  const list = [
    { _id: "", title: "Top level" },
    ...D.pages
      .filter(x => !fam.has(x._id) && (!q || low(x.title).includes(low(q))))
      .sort(
        (a, b) =>
          (a.kind === "subject" ? 0 : 1) - (b.kind === "subject" ? 0 : 1) ||
          String(a.title).localeCompare(String(b.title)),
      ),
  ].slice(0, 60);
  return html`<div class="mvt"><input class="field" type="search" placeholder="Find a page" value=${q} onInput=${e => setQ(e.target.value)}/>
    <div class="acts mvl">${list.map(
      x => html`<button key=${x._id} class=${"mi" + ((p.parent || "") === x._id ? " on" : "")} onClick=${() => {
        close();
        W.upd("pages", p._id, { parent: x._id, upd: stamp() });
        toast(x._id ? "Moved into " + x.title : "Moved to top level");
      }}>
      ${x._id ? html`<${PIcon} p=${x}/>` : html`<${Icon} n="up"/>`}<span>${x.title}</span></button>`,
    )}</div></div>`;
}
const moveSheet = (p, at) => openSheet({ title: "Move into", Body: MoveTo, props: { p }, at });
const kindSheet = (p, at) =>
  actionSheet(
    "Page type",
    KINDS.map(([k, l]) => [k, l, () => setKind(p, k), { on: (p.kind || "note") === k }]),
    at,
  );
export function pageActions(p, at, inList) {
  const kl = (KINDS.find(k => k[0] === (p.kind || "note")) || KINDS[0])[1];
  actionSheet(
    p.title || "Untitled",
    [
      inList ? ["open", "Open", () => openPage(p._id)] : null,
      ["pin", p.pin ? "Unpin" : "Pin to top", () => W.upd("pages", p._id, { pin: !p.pin })],
      [p.kind || "note", "Type", () => kindSheet(p, at), { sub: kl }],
      ["up", "Move into…", () => moveSheet(p, at)],
      ["plus", "New page inside", () => newPage({ title: "Untitled", parent: p._id })],
      inList
        ? null
        : [
            "graph",
            "Connect to a page…",
            () => dispatchEvent(new CustomEvent("os-connect", { detail: p._id })),
          ],
      inList
        ? null
        : ["table", "Add a field", () => dispatchEvent(new CustomEvent("os-field", { detail: p._id }))],
      inList
        ? null
        : ["cards", "Flashcards", () => dispatchEvent(new CustomEvent("os-cards", { detail: p._id }))],
      p.kind === "subject" ? ["import", "Import document…", () => pickDocs(p._id)] : null,
      ["export", "Export .md", () => exportPage(p)],
      "-",
      ["trash", "Delete", () => deletePage(p), { danger: true }],
    ],
    at,
  );
}

/* ---------- list: a tree (subjects open into their pages) unless you search or filter ---------- */
function PageList({ cur, go }) {
  const [q, setQ] = useState(""),
    [kind, setKind] = usePref("os-page-kind", "all"),
    [openIds, setOpen] = usePref("os-page-open", []);
  const imp = useRef();
  const ql = low(q),
    ids = new Set(D.pages.map(p => p._id));
  const sort = (a, b) =>
    (b.pin ? 1 : 0) - (a.pin ? 1 : 0) ||
    (a.kind === "subject" ? 0 : 1) - (b.kind === "subject" ? 0 : 1) ||
    String(b.upd || b.at).localeCompare(String(a.upd || a.at));
  const flat = ql || kind !== "all";
  let rows;
  if (flat)
    rows = D.pages
      .filter(
        p =>
          (kind === "all" || (p.kind || "note") === kind) &&
          (!ql ||
            low(p.title).includes(ql) ||
            low(p.body).includes(ql) ||
            (p.props || []).some(x => low(x[1]).includes(ql))),
      )
      .sort(sort)
      .map(p => ({ p, d: 0 }));
  else {
    rows = [];
    const walk = (list, d) =>
      list.sort(sort).forEach(p => {
        rows.push({ p, d });
        if (openIds.includes(p._id) && d < 6) walk(kids(p._id), d + 1);
      });
    walk(
      D.pages.filter(p => !p.parent || !ids.has(p.parent)),
      0,
    );
  }
  /* keep the open page visible: open its parents */
  useEffect(() => {
    const p = D.pages.find(x => x._id === cur);
    if (!p) return;
    const a = ancestors(p)
      .map(x => x._id)
      .filter(x => !openIds.includes(x));
    if (a.length) setOpen([...openIds, ...a]);
  }, [cur]);
  const counts = {};
  D.pages.forEach(p => {
    const k = p.kind || "note";
    counts[k] = (counts[k] || 0) + 1;
  });
  const tog = id => setOpen(openIds.includes(id) ? openIds.filter(x => x !== id) : [...openIds, id]);
  /* New: every kind, plus importing a file (the only place Import lives now) */
  const newMenu = e =>
    actionSheet(
      "New",
      [
        ...KINDS.map(([k, l]) => [
          k,
          l,
          () => newPage({ title: q.trim() || "Untitled", kind: k, icon: k === "subject" ? "📚" : "" }),
        ]),
        "-",
        ["import", "Import a file…", () => imp.current.click(), { sub: "pdf, docx, epub, md" }],
      ],
      e.currentTarget,
    );
  return html`<div class="pl">
    <${Tools}><${Field} w="w" type="search" placeholder="Search pages" aria-label="Search pages" value=${q} onInput=${e => setQ(e.target.value)}
        onEnter=${() => {
          if (rows[0]) go(rows[0].p._id);
          else if (q.trim()) newPage({ title: q.trim(), kind: kind === "all" ? "note" : kind });
        }}/>
<button class=${"kfilt" + (kind !== "all" ? " on" : "")} aria-label="Show" onClick=${e => actionSheet("Show", [["notes", "All pages", () => setKind("all"), { on: kind === "all" }], ...KINDS.filter(([k]) => counts[k] || k === kind).map(([k]) => [k, PLURAL[k], () => setKind(k), { on: kind === k, sub: String(counts[k] || 0) }])], e.currentTarget)}><${Icon} n=${kind === "all" ? "list" : kind}/><span>${kind === "all" ? "All" : PLURAL[kind]}</span><${Icon} n="chev"/></button>
      <${Btn} go icon="plus" aria-label="New page" title="New page" onClick=${newMenu}>New<//><//>
    <div class="ll plv">${
      rows.length
        ? rows.map(({ p, d }) => {
            const n = kids(p._id).length;
            return html`<div key=${p._id} class=${"pr" + (p._id === cur ? " on" : "")} style=${"--d:" + d} ...${longPress(el => pageActions(p, el, true))}>
        ${!flat && n ? html`<button class=${"tw" + (openIds.includes(p._id) ? " o" : "")} aria-label=${(openIds.includes(p._id) ? "Collapse " : "Expand ") + p.title} onClick=${() => tog(p._id)}/>` : html`<span class="tw0"/>`}
        <button class="prb" onClick=${() => go(p._id)}><${PIcon} p=${p}/><span class="pt"><b>${p.title || "Untitled"}</b><small>${n ? plural(n, "page") + " · " : ""}${
          (p.props || [])
            .filter(x => x[1])
            .map(x => x[1])
            .slice(0, 2)
            .join(" · ") ||
          plain(p.body).slice(0, 70) ||
          " "
        }</small></span>
        <span class="pw">${p.pin ? html`<${Icon} n="pin"/>` : null}${when(p.upd || p.at)}</span></button></div>`;
          })
        : html`<${Empty}>${q ? "Nothing matches. Enter makes a page." : "No pages yet."}<//>`
    }</div>
    <button class="fab" aria-label="New page" onClick=${newMenu}><${Icon} n="plus"/></button>
    ${dueIn(null).length ? html`<div class="plf"><${Btn} icon="cards" onClick=${() => startReview(null, "All subjects")}>Review ${plural(dueIn(null).length, "card")}<//></div>` : null}
    <input ref=${imp} type="file" multiple accept=".md,.markdown,.txt,.pdf,.docx,.epub,image/*" hidden onChange=${e => {
      importFiles(
        [...e.target.files],
        (D.pages.find(x => x._id === cur) || {}).kind === "subject" ? cur : "",
      );
      e.target.value = "";
    }}/>
  </div>`;
}

/* .md files (Obsidian too: front matter -> fields, ![[img.png]] -> the imported image) + any images picked with them */
/* pdf / docx / epub become a page that keeps the original file (sos:<id>, synced) + its extracted text; parent = a subject to file it under */
export async function importDoc(f, parent = "") {
  const type = docType(f.name);
  toast("Reading " + f.name + "…");
  try {
    const r = await extract(f);
    const fid = await saveFile(new File([f], f.name, { type: MIME[type] }), f.name);
    const id = uid();
    W.set("pages", id, {
      title: freeTitle(r.title || f.name),
      kind: "note",
      icon: "",
      body: r.text,
      props: [],
      pin: false,
      parent,
      at: stamp(),
      upd: stamp(),
      doc: { file: fid, name: f.name, type, pages: r.pages, size: f.size },
    });
    if (!r.text.trim()) toast("No text found (scanned?). You can still read it.");
    return id;
  } catch (e) {
    console.warn("import", e);
    toast(e.message || "Couldn't read " + f.name);
    return null;
  }
}
export function pickDocs(parent = "") {
  const i = document.createElement("input");
  i.type = "file";
  i.multiple = true;
  i.accept = ".pdf,.docx,.epub";
  i.onchange = async () => {
    let last = null;
    for (const f of i.files) last = (await importDoc(f, parent)) || last;
    if (last) openPage(last);
  };
  i.click();
}
async function importFiles(files, parent = "") {
  const imgs = {},
    base = n => low(String(n).split(/[\\/]/).pop());
  let n = 0;
  for (const f of files) if (/^image\//.test(f.type)) imgs[base(f.name)] = await saveFile(f, f.name);
  for (const f of files) {
    if (/^image\//.test(f.type)) continue;
    if (DOC_RE.test(f.name)) {
      if (await importDoc(f, parent)) n++;
      continue;
    }
    let [body, props] = frontMatter(await f.text());
    body = body
      .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (m, x) =>
        imgs[base(x)] ? "![](" + "sos:" + imgs[base(x)] + ")" : m,
      )
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, a, x) =>
        imgs[base(decodeURIComponent(x))] ? "![" + a + "](sos:" + imgs[base(decodeURIComponent(x))] + ")" : m,
      );
    const kp = props.find(p => low(p[0]) === "kind" || low(p[0]) === "type"),
      kind = kp && KINDS.some(k => k[0] === low(kp[1])) ? low(kp[1]) : "note";
    const ip = props.find(p => low(p[0]) === "icon");
    W.set("pages", uid(), {
      title: freeTitle(f.name.replace(/\.(md|markdown|txt)$/i, "")),
      kind,
      icon: ip ? ip[1] : "",
      body: body.trim(),
      props: props.filter(p => p !== kp && p !== ip),
      pin: false,
      at: stamp(),
      upd: stamp(),
    });
    n++;
  }
  const ni = Object.keys(imgs).length;
  toast(
    n || ni ? "Imported " + plural(n, "page") + (ni ? " + " + plural(ni, "image") : "") : "Nothing to import",
  );
}

function Props({ p }) {
  const props = p.props || [];
  const [all, setAll] = useState(false);
  const empty = props.filter(x => !x[1]).length,
    hideEmpty = !all && empty > 0 && empty < props.length + 1;
  const save = list => W.upd("pages", p._id, { props: list, upd: stamp() });
  const setAt = (i, j, v) => {
    const l = props.map(x => x.slice());
    l[i][j] = v;
    save(l);
  };
  return html`<div class="pp">${props.map(([k, v], i) =>
    hideEmpty && !v
      ? null
      : html`<div class="ppr" key=${i + ":" + k}>
      <input class="pk" value=${k} aria-label="Field name" maxlength="40" onChange=${e => setAt(i, 0, e.target.value.trim() || k)}/>
      <input class="pval" value=${v} placeholder="—" aria-label=${k} maxlength="300" onChange=${e => setAt(i, 1, e.target.value.trim())}/>
      ${/^https?:\/\//.test(v) ? html`<a class="po" href=${v} target="_blank" rel="noopener noreferrer" aria-label="Open link"><${Icon} n="open"/></a>` : null}
      <button class="x1" aria-label=${"Remove " + k} onClick=${() => save(props.filter((_, j) => j !== i))}>×</button></div>`,
  )}
    <div class="ppf"><button class="ppadd" onClick=${() => {
      setAll(true);
      save([...props, ["Field", ""]]);
    }}><${Icon} n="plus"/>Field</button>
      ${empty && props.length ? html`<button class="ppadd" onClick=${() => setAll(!all)}>${all ? "Hide empty" : "Show " + empty + " empty"}</button>` : null}</div></div>`;
}

/* everything that isn't the note itself (fields, sub-pages and deadlines, cards, connections) sits in one row
   of chips under the title; a chip opens its panel. Nothing to show = no row at all. */
function PageInfo({ p, open, make, go }) {
  useCols("rels", "cards", "pages", "classes", "events");
  const [tab, setTab] = useState(""),
    [adding, setAdding] = useState(false);
  useEffect(() => {
    setTab("");
    setAdding(false);
  }, [p._id]);
  useEffect(() => {
    const cx = e => {
      if (e.detail === p._id) {
        setTab("cx");
        setAdding(true);
      }
    };
    const fd = e => {
      if (e.detail === p._id) {
        setTab("pp");
        W.upd("pages", p._id, { props: [...(p.props || []), ["Field", ""]], upd: stamp() });
      }
    };
    const dk = e => {
      if (e.detail === p._id) setTab("dk");
    };
    addEventListener("os-connect", cx);
    addEventListener("os-field", fd);
    addEventListener("os-cards", dk);
    return () => {
      removeEventListener("os-connect", cx);
      removeEventListener("os-field", fd);
      removeEventListener("os-cards", dk);
    };
  }, [p._id, p.props]);
  const props = p.props || [],
    filled = props.filter(x => x[1]),
    fam = family(p._id),
    cards = cardsIn(fam),
    due = dueIn(fam),
    ch = kids(p._id),
    rs = relsOf(p._id);
  const subj = p.kind === "subject";
  /* a subject's next Moodle/calendar deadline matches its Course code field (same rule as the study box) */
  const code = subj && props.find(x => /course|code/i.test(x[0]) && x[1]),
    cc = code && code[1].trim().toLowerCase(),
    now = Date.now();
  const dl = cc
    ? calItems().filter(
        x =>
          !x.done &&
          x.kind !== "opens" &&
          x.e > now - 864e5 &&
          (String(x.code).toLowerCase().includes(cc) || String(x.title).toLowerCase().includes(cc)),
      )[0]
    : null;
  const chips = [
    dl && [
      "dl",
      "clock",
      "Due " +
        new Date(dl.t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }) +
        ": " +
        dl.title,
    ],
    props.length && [
      "pp",
      "table",
      filled.length === 1
        ? filled[0][0] + ": " + filled[0][1]
        : filled.length
          ? plural(filled.length, "field")
          : plural(props.length, "empty field"),
    ],
    (ch.length || subj) && [
      "sub",
      subj ? "subject" : "notes",
      ch.length ? plural(ch.length, "page") : "Pages",
    ],
    rs.length && ["cx", "graph", plural(rs.length, "connection")],
  ].filter(Boolean);
  if (!chips.length && !cards.length && !tab) return null;
  const t = k => () => {
    setAdding(false);
    setTab(tab === k ? "" : k);
  };
  return html`<div class="pinfo">
    <div class="pchips">${chips.map(([k, ic, l]) => html`<button class="pchip" key=${k} aria-expanded=${String(tab === k)} onClick=${t(k)}><${Icon} n=${ic}/><span>${l}</span></button>`)}
      ${cards.length || tab === "dk" ? html`<button class=${"pchip" + (due.length ? " due" : "")} aria-expanded=${String(tab === "dk")} onClick=${t("dk")}><${Icon} n="cards"/><span>${cards.length ? plural(cards.length, "card") + (due.length ? " · " + due.length + " due" : "") : "Flashcards"}</span></button>` : null}
      ${tab === "cx" && !rs.length ? html`<button class="pchip" aria-expanded="true" onClick=${t("cx")}><${Icon} n="graph"/><span>Connections</span></button>` : null}</div>
    ${tab === "pp" ? html`<${Props} p=${p}/>` : tab === "sub" || tab === "dl" ? html`<${StudyBox} p=${p} open=${open} make=${make} calItems=${calItems} bare/>` : tab === "cx" ? html`<${Connections} p=${p} go=${go} adding=${adding}/>` : tab === "dk" ? html`<${Deck} p=${p}/>` : null}
  </div>`;
}

function PageView({ p, back }) {
  const [body, setBody] = useState(p.body || ""),
    [title, setTitle] = useState(p.title || ""),
    [edit, setEdit] = useState(false);
  const timer = useRef(0),
    pending = useRef(null),
    tref = useRef();
  useEffect(() => {
    if (pending.current == null) setBody(p.body || "");
  }, [p.body]);
  useEffect(() => {
    setTitle(p.title || "");
  }, [p.title]);
  /* a brand-new page starts with the title selected */
  useEffect(() => {
    if (ls.get("os-page-new", "") === p._id) {
      ls.set("os-page-new", "");
      setTimeout(() => {
        const t = tref.current;
        if (t) {
          t.focus();
          t.select();
        }
      }, 60);
    }
  }, []);
  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current != null) {
      const v = pending.current;
      pending.current = null;
      if (v !== p.body) W.upd("pages", p._id, { body: v, upd: stamp() });
    }
  };
  useEffect(() => flush, []);
  const type = v => {
    setBody(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  const go = t => {
    flush();
    const ex = byTitle(t);
    if (ex) openPage(ex._id);
    else {
      const id = makePage({ title: t });
      openPage(id);
    }
  };
  const rename = e => {
    const old = p.title || "",
      nt = e.target.value.trim();
    if (!nt || nt === old) {
      setTitle(old);
      return;
    }
    if (byTitle(nt) && byTitle(nt)._id !== p._id) {
      toast("A page with that name exists");
      setTitle(old);
      return;
    }
    W.upd("pages", p._id, { title: nt, upd: stamp() });
    let n = 0;
    D.pages.forEach(o => {
      if (o._id !== p._id && wikiTargets(o.body).has(low(old))) {
        W.upd("pages", o._id, { body: renameLinks(o.body, old, nt) });
        n++;
      }
    });
    if (n) toast("Updated links in " + plural(n, "page"));
  };
  const back2 = D.pages.filter(o => o._id !== p._id && wikiTargets(o.body).has(low(p.title)));
  const up = ancestors(p).slice(-1)[0];
  const words = (body.replace(/[#>*_`~|\\-]/g, " ").match(/\S+/g) || []).length,
    crumbs = ancestors(p);
  return html`<div class="pv">
    <${Tools} frm=${false} cls="pvt">${
      back
        ? html`<button class="bk" onClick=${() => {
            flush();
            if (up) openPage(up._id);
            else back();
          }}><${Icon} n="back"/><span>${up ? (up.icon ? up.icon + " " : "") + up.title : "Notes"}</span></button>`
        : null
    }
      <span class="sp"/>
      <${Btn} cls="ib" icon="pin" aria-label=${p.pin ? "Unpin" : "Pin"} title=${p.pin ? "Unpin" : "Pin"} aria-pressed=${String(!!p.pin)} onClick=${() => W.upd("pages", p._id, { pin: !p.pin })}/>
      <${Btn} cls="ib" icon="more" aria-label="Page options" title="Page options" onClick=${e => {
        flush();
        pageActions({ ...p, body: body }, e.currentTarget);
      }}/><//>
    <div class=${"pbody" + (p.doc && !edit ? " pdoc" : "")}>
      ${
        crumbs.length
          ? html`<div class="crumbs">${crumbs.map(
              c =>
                html`<button onClick=${() => {
                  flush();
                  openPage(c._id);
                }}>${c.icon || ""} ${c.title}</button><span>›</span>`,
            )}</div>`
          : null
      }
      <div class="ph"><${IconPick} value=${p.icon || ""} kind=${p.kind || "note"} onPick=${v => W.upd("pages", p._id, { icon: v, upd: stamp() })}/>
        <textarea class="ptitle" ref=${tref} rows="1" value=${title} aria-label="Title" maxlength="120" placeholder="Untitled"
          onInput=${e => {
            const v = e.target.value.replace(/\s*\n\s*/g, " ");
            if (v !== e.target.value) e.target.value = v;
            setTitle(v);
          }} onBlur=${rename} onKeyDown=${e => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.target.blur();
              setTimeout(() => {
                const c = document.querySelector(".pv .bed .ce,.pv .bed textarea");
                if (c) c.focus();
              }, 40);
            }
          }}/></div>
      ${
        p.doc && !edit
          ? null
          : html`<${PageInfo} p=${p} go=${go} open=${id => {
              flush();
              openPage(id);
            }} make=${() => {
              flush();
              newPage({ title: "Untitled", parent: p._id });
            }}/>`
      }
      ${
        p.doc && !edit
          ? html`<${DocReader} p=${p} onEdit=${() => setEdit(true)}/>`
          : html`${
              p.doc
                ? html`<button class="ppadd" onClick=${() => {
                    flush();
                    setEdit(false);
                  }}>Back to reader</button>`
                : null
            }<${BlockEditor} value=${p.body || ""} onChange=${type} onWiki=${go} onNewPage=${t => makePage({ title: t })}/>`
      }
      ${back2.length ? html`<div class="bl"><small>Linked from</small>${back2.map(o => html`<button key=${o._id} class="blk" onClick=${() => go(o.title)}><${PIcon} p=${o}/>${o.title}</button>`)}</div>` : null}
    </div>
    <${StatusBar} keep items=${[plural(words, "word"), when(p.upd || p.at) ? "edited " + when(p.upd || p.at) : null]}/>
  </div>`;
}

function Pages() {
  useCols("pages", "cards");
  /* two panes only when the window has room for both; a narrow desktop window works like the phone (list, then page) */
  const desk = useMedia("(min-width:861px)"),
    box = useRef(),
    room = useWinWidth(box),
    wide = desk && (room === "m" || room === "l");
  const [cur, setCur] = usePref("os-page", "");
  const page = D.pages.find(p => p._id === cur);
  /* phone: inside a page the hub tabs step aside, like a pushed screen */
  useEffect(() => {
    document.body.toggleAttribute("data-detail", !!page && !desk);
    return () => document.body.removeAttribute("data-detail");
  }, [!!page, desk]);
  /* back button: page to page, then back to the list */
  useScrollKey(wide ? "" : cur, false);
  const pc = useRef(cur);
  useEffect(() => {
    if (cur && !wide) pushBack("page", () => setCur(""));
  }, []); /* Notes reopened on a page: back goes to the list first */
  useEffect(() => {
    const p = pc.current;
    pc.current = cur;
    if (wide || p === cur || fromBack()) return;
    if (cur) pushBack("page", () => setCur(p));
    else dropBack("page", true);
  }, [cur]);
  return html`<div ref=${box} class=${"pg" + (wide ? " two" : "")}>
    ${wide || !page ? html`<${PageList} cur=${cur} go=${id => setCur(id)}/>` : null}
    ${
      page
        ? html`<${PageView} key=${page._id} p=${page} back=${wide ? null : () => setCur("")}/>`
        : wide
          ? html`<div class="pv pnone">${ART.emptyNotes ? html`<img src=${ART.emptyNotes} alt=""/>` : null}<p>Pick a page, or make one.</p><${Btn} go icon="plus" onClick=${() => newPage()}>New page<//><${Btn} icon="subject" onClick=${() => newPage({ title: "New subject", kind: "subject", icon: "📚" })}>New subject<//></div>`
          : null
    }
  </div>`;
}

export default {
  id: "notes",
  name: "Notes",
  title: "notes",
  Comp: Pages,
  tab: true,
  search: q =>
    D.pages
      .filter(p => low(p.title).includes(q) || low(p.body).includes(q))
      .slice(0, 4)
      .map(p => ({
        icon: p.kind || "note",
        l: (KINDS.find(k => k[0] === (p.kind || "note")) || KINDS[0])[1] + ": " + p.title,
        r: () => openPage(p._id),
      })),
  cmd: (v, arg) => {
    if (["note", "n"].includes(v))
      return [
        arg
          ? { icon: "note", l: "Note: " + arg, r: () => quickNote(arg, true) }
          : { icon: "notes", l: "Open Notes", r: () => openMod("notes", true) },
      ];
    if (v === "page")
      return [
        {
          icon: "note",
          l: "New page" + (arg ? ": " + arg : ""),
          r: () => newPage({ title: arg || "Untitled" }),
        },
      ];
    if (["review", "study", "cards"].includes(v)) {
      const n = dueIn(null).length;
      return [
        {
          icon: "cards",
          l: n ? "Review " + plural(n, "flashcard") : "No flashcards due",
          r: () => startReview(null, "All subjects"),
        },
      ];
    }
    const k = KINDS.find(x => x[0] === v);
    if (k)
      return [
        arg
          ? {
              icon: k[0],
              l: "New " + k[1].toLowerCase() + ": " + arg,
              r: () => {
                const ex = byTitle(arg);
                if (ex) openPage(ex._id);
                else newPage({ title: arg, kind: k[0], icon: k[0] === "subject" ? "📚" : "" });
              },
            }
          : { l: v + " Name   (makes a " + k[1].toLowerCase() + " page)", hint: true },
      ];
    return [];
  },
};
