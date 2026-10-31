import { useState } from "preact/hooks";
import { html, plural } from "../core/lib.js";
import { toast } from "../core/bus.js";
import { useCols, W, D, drop } from "../core/store.js";
import {
  Tools,
  Panel,
  List,
  StatusBar,
  AddBtn,
  Field,
  Combo,
  Btn,
  Tabs,
  Group,
  Del,
  Empty,
  EditRow,
} from "../ui/index.js";
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

function Board() {
  useCols("tasks", "projects");
  const [proj, setProj] = useState("all"),
    [t, setT] = useState(""),
    [pi, setPi] = useState(""),
    [edit, setEdit] = useState(null),
    [over, setOver] = useState("");
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
  return html`<${Tools} cls="addrow">
      <${Field} w="w" placeholder="New task" maxlength="120" aria-label="Task" value=${t} onInput=${e => setT(e.target.value)} onEnter=${addTask}/>
      <${Combo} placeholder="Project (type to add)" maxlength="24" aria-label="Project" value=${pi} onInput=${setPi} onEnter=${() => (t.trim() ? addTask() : addProj())} options=${names}/>
      <${AddBtn} onClick=${addTask}/><${Btn} title="Add the project in the field" onClick=${addProj} style="min-width:0">+ Project<//>
    <//>
    <div><${Tabs} items=${[["all", "All"], ...ps.map(p => [p, p])]} cur=${cur} onChange=${setProj}/></div>
    <${Panel}><div class="bd">${COLS.map(([k, l], ci) => {
      const items = D.tasks
        .filter(x => (x.col || "todo") === k && (cur === "all" || x.proj === cur))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      /* desktop: drag a card onto another column to move it */
      const dz = {
        onDragOver: e => {
          if (!e.dataTransfer.types.includes("text/sos-task")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (over !== k) setOver(k);
        },
        onDragLeave: e => {
          if (!e.currentTarget.contains(e.relatedTarget)) setOver("");
        },
        onDrop: e => {
          const id = e.dataTransfer.getData("text/sos-task");
          setOver("");
          if (id) W.upd("tasks", id, { col: k });
        },
      };
      return html`<div class=${"ll" + (over === k ? " dropon" : "")} key=${k} ...${dz}><${Group} title=${l + " · " + items.length}/><div class="lcap">
        ${items.map(x =>
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
            : html`<div key=${x._id} class=${"lr" + (k === "done" ? " done" : "")} draggable=${matchMedia("(pointer:fine)").matches ? "true" : null}
              onDragStart=${e => {
                e.dataTransfer.setData("text/sos-task", x._id);
                e.dataTransfer.effectAllowed = "move";
                e.currentTarget.classList.add("drag");
              }} onDragEnd=${e => {
                e.currentTarget.classList.remove("drag");
                setOver("");
              }}>
            <span class="tt ed" title="Click to edit" onClick=${() => setEdit(x._id)}>${x.title}</span>
            ${x.proj && cur === "all" && ps.length > 1 ? html`<span class="tag">${x.proj}</span>` : null}
            <span class="acts2">
              ${ci > 0 ? html`<button class="x1" aria-label=${"Move to " + COLS[ci - 1][1]} onClick=${() => W.upd("tasks", x._id, { col: COLS[ci - 1][0] })}>◂</button>` : null}
              ${ci < 2 ? html`<button class="x1" aria-label=${"Move to " + COLS[ci + 1][1]} onClick=${() => W.upd("tasks", x._id, { col: COLS[ci + 1][0] })}>▸</button>` : null}
              <${Del} onClick=${() => drop("tasks", x._id, "Task deleted")}/>
            </span></div>`,
        )}
        ${items.length ? null : html`<${Empty} pad>—<//>`}</div></div>`;
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
