import { useState, useRef, useLayoutEffect, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { toast } from "../core/bus.js";
import { useCols, W, D, drop } from "../core/store.js";
import { Tools, Panel, AddBtn, Field, Combo, Btn, Tabs, Group, Del, Empty, EditRow } from "../ui/index.js";
import { actionSheet, askText } from "../ui/sheet.js";
import { openMod } from "../shell/os.js";

const COLS = [
  ["todo", "To do"],
  ["doing", "Doing"],
  ["done", "Done"],
];
const names = () =>
  [...new Set([...D.projects.map(p => p.name), ...D.tasks.map(x => x.proj).filter(Boolean)])].sort((a, b) =>
    a.localeCompare(b),
  );
const ensure = n => {
  if (n && !names().includes(n)) W.add("projects", { name: n });
};
/* order in a column: `ord` once a card has been dragged, else newest first (the old order) */
const key = x => (typeof x.ord === "number" ? x.ord : -Date.parse(x.at || 0) || 0);
const strip = o => {
  const c = { ...o };
  delete c._id;
  return c;
};

/* ---- projects: rename, delete (keeping or deleting its tasks), all with Undo ---- */
function projectMenu(name, setProj, at) {
  const ps = D.projects.filter(p => p.name === name),
    ts = D.tasks.filter(t => t.proj === name),
    back = () =>
      W.batch([
        ...ps.map(p => ["set", "projects", p._id, strip(p)]),
        ...ts.map(t => ["set", "tasks", t._id, strip(t)]),
      ]);
  const remove = withTasks => {
    W.batch([
      ...ps.map(p => ["del", "projects", p._id]),
      ...ts.map(t => (withTasks ? ["del", "tasks", t._id] : ["set", "tasks", t._id, { ...strip(t), proj: "" }])),
    ]);
    setProj("all");
    toast(withTasks ? "Deleted " + name + " and its tasks" : "Deleted " + name, { label: "Undo", run: back });
  };
  actionSheet(
    name,
    [
      [
        "rename",
        "Rename…",
        async () => {
          const v = ((await askText({ title: "Rename project", value: name, ok: "Rename" })) || "").trim().slice(0, 24);
          if (!v || v === name) return;
          const into = names().includes(v);
          W.batch([
            ...ps.map(p => (into ? ["del", "projects", p._id] : ["set", "projects", p._id, { ...strip(p), name: v }])),
            ...ts.map(t => ["set", "tasks", t._id, { ...strip(t), proj: v }]),
          ]);
          setProj(v);
          toast(into ? "Merged into " + v : "Renamed", { label: "Undo", run: back });
        },
      ],
      "-",
      ["trash", ts.length ? "Delete project, keep its " + ts.length + (ts.length === 1 ? " task" : " tasks") : "Delete project", () => remove(false)],
      ts.length
        ? ["trash", "Delete project and its " + ts.length + (ts.length === 1 ? " task" : " tasks"), () => remove(true), { danger: 1 }]
        : null,
    ],
    at,
  );
}

/* ---- dragging cards (mouse anywhere on a card, touch by its grip): a lifted copy follows the pointer, the
   others slide apart where it will land (FLIP), and it settles into place on drop. Works across and within columns. */
function useDrag(root) {
  const [drag, setDrag] = useState(null); // {id, col, idx, h}
  const before = useRef(null),
    H = useRef(null);
  if (!H.current) H.current = dragger(root, before, setDrag);
  useLayoutEffect(() => {
    const m = before.current;
    before.current = null;
    if (!m || !root.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.current.querySelectorAll(".bd .lr[data-id], .bd .bph").forEach(e => {
      const a = m.get(e.dataset.id || "ph"),
        b = e.getBoundingClientRect();
      if (!a) return e.dataset.id ? null : e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
      const dx = a.left - b.left,
        dy = a.top - b.top;
      if (dx || dy)
        e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], {
          duration: 180,
          easing: "cubic-bezier(.2,.7,.3,1)",
        });
    });
  });
  useEffect(() => H.current.destroy, []);
  return [drag, H.current.start];
}

/* the drag machinery, made once per board so its window listeners can be removed again */
function dragger(root, before, setDrag) {
  let D_ = null;
  const snap = () => {
    const m = new Map();
    root.current &&
      root.current.querySelectorAll(".bd .lr[data-id], .bd .bph").forEach(e => m.set(e.dataset.id || "ph", e.getBoundingClientRect()));
    before.current = m;
  };
  const set = v => {
    snap();
    setDrag(v);
  };
  const where = (x, y) => {
    const s = D_,
      hit = document.elementFromPoint(x, y),
      col = hit && hit.closest(".bd > .ll[data-col]");
    if (!col || !root.current.contains(col)) return null;
    const cards = [...col.querySelectorAll(".lr[data-id]")].filter(e => e.dataset.id !== s.id);
    let idx = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    return { col: col.dataset.col, idx, box: col };
  };
  const scroller = (x, y, box) => {
    const s = D_;
    cancelAnimationFrame(s.raf);
    const cap = box && box.querySelector(".lcap");
    const run = () => {
      let v = 0;
      if (y < 48) v = -10;
      else if (y > innerHeight - 48) v = 10;
      if (v) scrollBy(0, v);
      if (cap && cap.scrollHeight > cap.clientHeight) {
        const r = cap.getBoundingClientRect();
        if (y < r.top + 28 && y > r.top - 20) cap.scrollTop -= 8;
        else if (y > r.bottom - 28 && y < r.bottom + 20) cap.scrollTop += 8;
      }
      s.raf = v || cap ? requestAnimationFrame(run) : 0;
    };
    s.raf = requestAnimationFrame(run);
  };
  const move = e => {
    const s = D_;
    if (!s || e.pointerId !== s.pid) return;
    if (!s.on) {
      if (Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < (s.touch ? 2 : 5)) return;
      lift(s);
    }
    e.preventDefault();
    s.fly.style.transform = `translate(${e.clientX - s.ox}px,${e.clientY - s.oy}px) rotate(-1.2deg) scale(1.03)`;
    const w = where(e.clientX, e.clientY);
    scroller(e.clientX, e.clientY, w && w.box);
    if (w && (w.col !== s.col || w.idx !== s.idx)) {
      s.col = w.col;
      s.idx = w.idx;
      set({ id: s.id, col: w.col, idx: w.idx, h: s.h });
    }
  };
  const lift = s => {
    s.on = true;
    const r = s.el.getBoundingClientRect(),
      fly = s.el.cloneNode(true);
    s.h = r.height;
    s.ox = s.x0 - r.left;
    s.oy = s.y0 - r.top;
    fly.className += " bfly";
    fly.removeAttribute("data-id");
    fly.style.width = r.width + "px";
    fly.style.transform = `translate(${r.left}px,${r.top}px)`;
    document.body.append(fly);
    s.fly = fly;
    document.documentElement.classList.add("bdragging");
    if (navigator.vibrate && s.touch)
      try {
        navigator.vibrate(8);
      } catch {
        // optional
      }
    set({ id: s.id, col: s.col, idx: s.idx, h: s.h });
  };
  const end = e => {
    const s = D_;
    if (!s || (e && e.pointerId !== s.pid)) return;
    D_ = null;
    removeEventListener("pointermove", move, true);
    removeEventListener("pointerup", up, true);
    removeEventListener("pointercancel", cancel, true);
    removeEventListener("keydown", esc, true);
    cancelAnimationFrame(s.raf);
    document.documentElement.classList.remove("bdragging");
    if (!s.on) return;
    /* a drag isn't a click: don't open the card's editor */
    const eat = ev => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", eat, true), 300);
    return s;
  };
  const settle = (s, commit) => {
    const ph = root.current && root.current.querySelector(".bd .bph"),
      r = ph && ph.getBoundingClientRect(),
      fly = s.fly;
    if (commit) commit();
    const done = () => {
      fly.remove();
      set(null);
    };
    if (!r) return done();
    fly.style.transition = "transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s";
    fly.style.transform = `translate(${r.left}px,${r.top}px)`;
    fly.classList.add("land");
    setTimeout(done, 170);
  };
  const up = e => {
    const s = end(e);
    if (!s) return;
    const list = D.tasks
      .filter(x => x._id !== s.id && (x.col || "todo") === s.col && (s.proj === "all" || x.proj === s.proj))
      .sort((a, b) => key(a) - key(b));
    const p = list[s.idx - 1],
      n = list[s.idx];
    const ord = !p && !n ? -Date.now() : !p ? key(n) - 1000 : !n ? key(p) + 1000 : (key(p) + key(n)) / 2;
    settle(s, () => W.upd("tasks", s.id, { col: s.col, ord }));
  };
  const cancel = e => {
    const s = end(e);
    if (s) settle(s);
  };
  const esc = e => {
    if (e.key !== "Escape" || !D_) return;
    e.preventDefault();
    const s = D_;
    s.col = s.c0;
    s.idx = s.i0;
    set({ id: s.id, col: s.c0, idx: s.i0, h: s.h });
    requestAnimationFrame(() => {
      const t = end();
      if (t) settle(t);
    });
  };
  /* pointerdown on a card (mouse) or its grip (touch, pen) */
  const start = (e, x, col, idx, proj) => {
    const touch = e.pointerType !== "mouse",
      grip = e.target.closest(".bgrip");
    if (D_ || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (touch && !grip) return;
    if (!grip && e.target.closest("button,input,textarea,select,a,.ck")) return;
    const el = e.currentTarget;
    D_ = { id: x._id, el, pid: e.pointerId, x0: e.clientX, y0: e.clientY, col, idx, c0: col, i0: idx, proj, touch, on: false };
    if (touch) {
      e.preventDefault();
      lift(D_);
    }
    addEventListener("pointermove", move, { capture: true, passive: false });
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", cancel, true);
    addEventListener("keydown", esc, true);
  };
  const destroy = () => {
    const s = D_;
    if (s) {
      end();
      if (s.fly) s.fly.remove();
    }
  };
  return { start, destroy };
}

function Board() {
  useCols("tasks", "projects");
  const [proj, setProj] = useState("all"),
    [t, setT] = useState(""),
    [pi, setPi] = useState(""),
    [edit, setEdit] = useState(null);
  const root = useRef(),
    [drag, start] = useDrag(root);
  const ps = names(),
    cur = proj !== "all" && !ps.includes(proj) ? "all" : proj;
  const addProj = () => {
    const p = pi.trim();
    if (!p) return;
    ensure(p);
    setProj(p);
    setPi("");
    toast("Project added");
  };
  const addTask = () => {
    const v = t.trim(),
      p = pi.trim();
    if (!v) {
      if (p) addProj();
      return;
    }
    ensure(p);
    W.add("tasks", { title: v, proj: p || (cur !== "all" ? cur : ""), col: "todo" });
    setT("");
  };
  const card = (x, k, ci, idx) =>
    edit === x._id
      ? html`<${EditRow} key=${x._id} specs=${[
          { k: "title", t: "text", ph: "Task", w: "w" },
          { k: "proj", t: "text", ph: "Project" },
        ]} init=${x} onSave=${o => {
          if (o.title) {
            ensure(o.proj);
            W.upd("tasks", x._id, { title: o.title, proj: o.proj });
          }
        }} onCancel=${() => setEdit(null)}/>`
      : html`<div key=${x._id} data-id=${x._id} class=${"lr" + (k === "done" ? " done" : "")} onPointerDown=${e => start(e, x, k, idx, cur)}>
          <span class="bgrip" title="Drag to move" aria-hidden="true"/>
          <span class="tt ed" title="Click to edit" onClick=${() => setEdit(x._id)}>${x.title}</span>
          ${x.proj && cur === "all" && ps.length > 1 ? html`<span class="tag">${x.proj}</span>` : null}
          <span class="acts2">
            ${ci > 0 ? html`<button class="x1" aria-label=${"Move to " + COLS[ci - 1][1]} onClick=${() => W.upd("tasks", x._id, { col: COLS[ci - 1][0] })}>◂</button>` : null}
            ${ci < 2 ? html`<button class="x1" aria-label=${"Move to " + COLS[ci + 1][1]} onClick=${() => W.upd("tasks", x._id, { col: COLS[ci + 1][0] })}>▸</button>` : null}
            <${Del} onClick=${() => drop("tasks", x._id, "Task deleted")}/>
          </span></div>`;
  return html`<${Tools} cls="addrow">
      <${Field} w="w" placeholder="New task" maxlength="120" aria-label="Task" value=${t} onInput=${e => setT(e.target.value)} onEnter=${addTask}/>
      <${Combo} placeholder="Project (type to add)" maxlength="24" aria-label="Project" value=${pi} onInput=${setPi} onEnter=${() => (t.trim() ? addTask() : addProj())} options=${names}/>
      <${AddBtn} onClick=${addTask}/><${Btn} title="Add the project in the field" onClick=${addProj} style="min-width:0">+ Project<//>
    <//>
    <div class="bdtabs"><${Tabs} items=${[["all", "All"], ...ps.map(p => [p, p])]} cur=${cur} onChange=${setProj}/>${cur !== "all" ? html`<button class="x1 bdpm" aria-label=${"Project options: " + cur} title="Rename or delete this project" onClick=${e => projectMenu(cur, setProj, e.currentTarget)}>⋯</button>` : null}</div>
    <${Panel} cls="bdp"><div class="bd" ref=${root}>${COLS.map(([k, l], ci) => {
      let items = D.tasks
        .filter(x => (x.col || "todo") === k && (cur === "all" || x.proj === cur))
        .sort((a, b) => key(a) - key(b));
      const n = items.length;
      if (drag) items = items.filter(x => x._id !== drag.id);
      const rows = items.map((x, i) => card(x, k, ci, i));
      if (drag && drag.col === k)
        rows.splice(Math.min(drag.idx, rows.length), 0, html`<div key="ph" class="bph" data-id="" style=${"height:" + drag.h + "px"}/>`);
      return html`<div class=${"ll" + (drag && drag.col === k ? " dropon" : "")} key=${k} data-col=${k}><${Group} title=${l + " · " + n}/><div class="lcap">
        ${rows}
        ${rows.length ? null : html`<${Empty} pad>—<//>`}</div></div>`;
    })}</div><//>
`;
}
export default {
  id: "board",
  name: "Board",
  title: "board",
  Comp: Board,
  search: q =>
    D.tasks
      .filter(t => (t.title + " " + (t.proj || "")).toLowerCase().includes(q))
      .slice(0, 3)
      .map(t => ({ icon: "board", l: "Task: " + t.title, r: () => openMod("board", true) })),
  cmd: (v, arg) => {
    if (!["todo", "task", "t"].includes(v)) return [];
    if (!arg) return [{ icon: "board", l: "Open Board", r: () => openMod("board", true) }];
    const pm = arg.match(/#(\S+)/),
      title = arg.replace(/#\S+/, "").trim();
    return [
      {
        icon: "board",
        l: "Add task: " + title + (pm ? "  [" + pm[1] + "]" : ""),
        r: () => {
          W.add("tasks", { title, proj: pm ? pm[1] : "", col: "todo" });
          openMod("board");
        },
      },
    ];
  },
};
