/* The assistant's tools: what each tool call does on this device (notes search, data, the home server, GitHub, Moodle). */
import { ls } from "./pref.js";
import { D, W, meta } from "./store.js";
import { syncConfig, syncNow } from "./sync.js";
import { toast } from "./bus.js";
import { hubOf, openMod, reg } from "../shell/os.js";
import { capabilities, planChanges } from "./workspace.js";
import { AI } from "./pack.js";
import { moodleTool } from "./moodle.js";
import { clip, findPage, lastWin, look, low, winLabel } from "./ai-look.js";
import { RES_MAX } from "./ai-tools.js";
import { ST, U, aiBase, api, emit } from "./ai.js";

/* ---------- tools ---------- */
const TOK = /[\p{L}\p{N}]{2,}/gu;
function searchNotes(q) {
  const ws = [...new Set(String(q).toLowerCase().match(TOK) || [])];
  if (!ws.length) return [];
  const n = D.pages.length || 1;
  const df = Object.fromEntries(
    ws.map(w => [w, D.pages.filter(p => (low(p.title) + " " + low(p.body)).includes(w)).length]),
  );
  return D.pages
    .map(p => {
      const t = low(p.title),
        b = low(p.body);
      let s = 0;
      ws.forEach(w => {
        const idf = Math.log(1 + n / (1 + df[w]));
        if (t.includes(w)) s += 3 * idf;
        const c = b.split(w).length - 1;
        if (c) s += idf * (1 + Math.log(c));
      });
      return { p, s };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map(({ p }) => {
      const b = p.body || "",
        i = Math.max(
          0,
          ws
            .map(w => low(b).indexOf(w))
            .filter(i => i >= 0)
            .sort((a, b) => a - b)[0] || 0,
        );
      return `(Notes: ${p.title}) [page id ${p._id}] …${b.slice(Math.max(0, i - 160), i + 340).replace(/\s+/g, " ")}…`;
    });
}

let CUR = { chat: null };
/* The user's standing instructions for Osage (config/osage), sent right after SYSTEM: the prompt cache only resets when they change */
export const styleNotes = () => {
  const c = D.config.find(x => x._id === "osage");
  return (c && c.style) || "";
};
export const setStyleNotes = t =>
  W.set("config", "osage", {
    style: String(t || "")
      .trim()
      .slice(0, 3000),
    upd: new Date().toISOString(),
  });
function editStyle(text, mode) {
  text = String(text || "").trim();
  const cur = styleNotes();
  let lines = cur ? cur.split("\n").filter(l => l.trim()) : [];
  if (mode === "replace") lines = text ? text.split("\n").filter(l => l.trim()) : [];
  else if (mode === "remove") {
    const n = lines.length;
    lines = lines.filter(l => !low(l).includes(low(text)));
    if (lines.length === n) return "Nothing matched. Current instructions:\n" + (cur || "(none)");
  } else if (text) lines.push(/^[-*]\s/.test(text) ? text : "- " + text);
  setStyleNotes(lines.join("\n"));
  return "Saved. Your instructions now:\n" + (lines.join("\n") || "(none)");
}

/* ---------- home server (admin service, tailnet only) ----------
   Reads run straight away; anything that changes the server waits for the user's Allow on an approval card in the chat
   (ST.ask). Credentials never go to the model: paths/commands that mention them are refused before any request. */
const SECRET =
  /token|[_.-]key\b|key\.txt|apikey|api_key|\.ssh\b|id_rsa|id_ed25519|keystore|moodle-calendar|\.env\b|secret|passw|\.netrc|credential|shadow\b/i;
export function approve(title, detail) {
  return new Promise(res => {
    const done = v => {
      if (ST.ask && ST.ask.done === done) {
        ST.ask = null;
        emit();
      }
      res(v);
    };
    ST.ask = { title, detail, done };
    emit();
    if (ST.ctrl) ST.ctrl.signal.addEventListener("abort", () => done(false), { once: true });
  });
}
const size = n =>
  n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB";
async function nijika(a) {
  const adm = await import("./admin.js");
  if (!adm.adminCfg().token)
    return `The home server isn't paired on this device yet (Home server window > ⚙). Tell ${U().name}.`;
  if ([a.path, a.cmd, a.prompt].some(x => x && SECRET.test(x)))
    return `Blocked: that touches credentials. Those stay out of chats; ${U().name} can do it ${U().self} in the home server's terminal.`;
  const q = adm.qs,
    no = `${U().Name} denied it. Don't try the same thing again; ask what ${U().he} ${U().v("wants")} instead.`;
  switch (a.do) {
    case "ls": {
      const r = await adm.api("/api/fs/ls?" + q({ p: a.path || "~" }));
      return (
        r.p +
        " (" +
        r.items.length +
        " items)\n" +
        r.items
          .slice(0, 150)
          .map(e => (e.d ? e.n + "/" : e.n + "  " + size(e.s)))
          .join("\n") +
        (r.items.length > 150 ? "\n…" : "")
      );
    }
    case "read": {
      const r = await adm.api("/api/fs/read?" + q({ p: a.path || "" })),
        t = r.text,
        at = Math.max(0, a.at || 0),
        n = 8000;
      return (
        r.p +
        " (" +
        t.length +
        " chars, from " +
        at +
        "):\n" +
        t.slice(at, at + n) +
        (at + n < t.length ? "\n[more: read at=" + (at + n) + "]" : "")
      );
    }
    case "services": {
      const r = await adm.api("/api/svc");
      return [
        "docker: " + (r.docker || []).map(d => d.name + " " + d.state).join(", "),
        "user units: " + (r.user || []).map(u => u.name + " " + u.state).join(", "),
        "system units: " + (r.system || []).map(u => u.name + " " + u.state).join(", "),
      ].join("\n");
    }
    case "logs": {
      const r = await adm.api("/api/svc/logs?" + q({ kind: a.kind || "docker", name: a.name || "", n: 80 }));
      return clip(r.text || r.out || JSON.stringify(r), 8000);
    }
    case "write": {
      if (!a.path) return "Say which file.";
      if (!(await approve("Write a file on the home server", a.path + "\n\n" + clip(a.text || "", 1500))))
        return no;
      await adm.api("/api/fs/write", { p: a.path, text: a.text || "" });
      return "Wrote " + a.path + " (" + size((a.text || "").length) + ").";
    }
    case "run":
    case "hermes": {
      const cmd =
        a.do === "hermes"
          ? "hermes -z '" + String(a.prompt || "").replace(/'/g, "'\\''") + "'"
          : String(a.cmd || "");
      if (!cmd.trim() || (a.do === "hermes" && !a.prompt)) return "Nothing to run.";
      if (
        !(await approve(
          a.do === "hermes" ? "Give Hermes a task" : "Run on the home server",
          a.do === "hermes" ? a.prompt : cmd,
        ))
      )
        return no;
      const r = await adm.api("/api/exec", { cmd, t: a.do === "hermes" ? 300 : 90 });
      return "exit " + r.code + (r.out ? "\n" + r.out : "") + (r.err ? "\nstderr: " + r.err : "");
    }
    case "service": {
      if (!a.name || !a.act) return "Say which service and what to do.";
      if (
        !(await approve(
          a.act[0].toUpperCase() + a.act.slice(1) + " a service",
          (a.kind || "docker") + ": " + a.name,
        ))
      )
        return no;
      const r = await adm.api("/api/svc/act", { kind: a.kind || "docker", name: a.name, act: a.act });
      return r.ok === false ? "Failed: " + (r.err || "") : "Done: " + a.act + " " + a.name + ".";
    }
  }
  return "Unknown home server action.";
}

async function changeData(changes) {
  if (meta.ro) throw new Error("Read-only right now. Nothing was changed.");
  const plan = planChanges(changes, D),
    deleted = plan.ops.filter(x => x[0] === "del");
  if (deleted.length) {
    const detail = plan.result.map(x => x.op + " " + x.col + ": " + clip(x.label, 100)).join("\n");
    if (!(await approve("Apply changes (" + deleted.length + " deletions)", detail)))
      return `${U().Name} said no. Nothing was changed.`;
    for (const [op, col, id, old] of plan.undo) {
      const current = D[col].find(x => x._id === id),
        doc = current ? (({ _id, ...v }) => v)(current) : null;
      if (JSON.stringify(doc) !== JSON.stringify(op === "set" ? old : null))
        throw new Error(
          "Data changed while approval was open. Read it again and retry; nothing was changed.",
        );
    }
  }
  if (plan.ops.length) {
    if (!(await W.batch(plan.ops)))
      throw new Error("Couldn't save the changes. Check storage/sync and try again.");
    toast(AI.name + " updated " + plan.ops.length + " items", {
      label: "Undo",
      run: () => W.batch(plan.undo),
    });
  }
  return JSON.stringify({ changed: plan.ops.length, items: plan.result });
}

/* Discovery + validated writes keep new modules connected without one tool per screen. */
async function data(a) {
  const { COLS } = await import("./store.js");
  if (!COLS.includes(a.col)) return "Can't use collection " + a.col + ". Use capabilities.";
  if (["add", "update", "delete"].includes(a.do))
    return changeData([{ op: a.do, col: a.col, id: a.id, fields: a.fields }]);
  const rows = D[a.col] || [],
    one = x => {
      const { _id, ...o } = x;
      return _id + " " + clip(JSON.stringify(o), 300);
    };
  switch (a.do) {
    case "list": {
      const l = low(a.q),
        hit = rows
          .filter(x => !l || low(JSON.stringify(x)).includes(l))
          .sort((x, y) => String(y.at || y.start || "").localeCompare(String(x.at || x.start || "")));
      const at = Math.max(0, a.at | 0);
      return (
        a.col +
        ": " +
        hit.length +
        " of " +
        rows.length +
        "\n" +
        hit
          .slice(at, at + 30)
          .map(one)
          .join("\n") +
        (at + 30 < hit.length ? "\n[more: data list at=" + (at + 30) + "]" : "")
      );
    }
    case "get": {
      const x = rows.find(r => r._id === a.id);
      return x ? clip(JSON.stringify(x), RES_MAX) : "No " + a.col + " with id " + a.id;
    }
  }
  return "Unknown data action.";
}

async function control(a) {
  if (a.do.startsWith("timer_")) {
    const timer = await import("../modules/timer.js");
    switch (a.do) {
      case "timer_start":
        timer.start();
        break;
      case "timer_pause":
        timer.pause();
        break;
      case "timer_reset":
        timer.setMode(timer.timerState().mode);
        break;
      case "timer_mode":
        if (!["focus", "short", "long"].includes(a.value)) return "Choose focus, short or long.";
        timer.setMode(a.value);
        break;
      case "timer_label":
        timer.setLabel(String(a.value || "").slice(0, 60));
        break;
      default:
        return "Unknown timer action.";
    }
    return JSON.stringify(timer.timerState());
  }
  if (a.do === "calculate") {
    const { calc, convert, fmtNum } = await import("./calc.js"),
      expression = String(a.value || "");
    if (expression.length > 1000) return "Expression is too long.";
    const converted = convert(expression);
    if (converted != null) return converted;
    const value = calc(expression);
    return value == null ? "Couldn't calculate that expression." : fmtNum(value);
  }
  if (a.do === "skin") {
    const { SKINS, applySkin } = await import("../shell/skins.js");
    if (!a.value) return SKINS.map(([id, label]) => id + ": " + label).join("\n");
    if (!SKINS.some(x => x[0] === a.value)) return "Unknown skin. List the presets first.";
    applySkin(a.value);
    return "Applied skin " + a.value + ".";
  }
  if (a.do === "tile") {
    const { tileWindows } = await import("../ui/index.js");
    tileWindows();
    return "Tiled the open windows.";
  }
  return "Unknown app control.";
}

/* GitHub through the admin service (token stays on the server, only this repo); writes wait for the user's Allow */
async function github(a) {
  const adm = await import("./admin.js");
  if (!adm.adminCfg().token)
    return `The home server isn't paired on this device yet (Home server window > ⚙). Tell ${U().name}.`;
  const g = async (path, method, body) => {
    const r = await adm.api("/api/gh", { path, method, body });
    if (r.status >= 300)
      throw new Error("GitHub " + r.status + (r.data && r.data.message ? ": " + r.data.message : ""));
    return r.data;
  };
  const n = a.n | 0,
    no = `${U().Name} said no. Leave it.`,
    need = () => (n ? null : "Say which number (n).");
  const ago = t => {
    const d = (Date.now() - Date.parse(t)) / 36e5;
    return d < 1 ? "just now" : d < 48 ? Math.round(d) + "h ago" : Math.round(d / 24) + "d ago";
  };
  switch (a.do) {
    case "prs": {
      const l = await g("pulls?state=open&per_page=20");
      return l.length
        ? l
            .map(
              p =>
                `#${p.number} ${p.title} (${p.user.login}, ${p.head.ref} → ${p.base.ref}, ${p.draft ? "draft, " : ""}updated ${ago(p.updated_at)})`,
            )
            .join("\n")
        : "No open PRs.";
    }
    case "pr": {
      if (need()) return need();
      const p = await g("pulls/" + n),
        f = await g("pulls/" + n + "/files?per_page=60");
      let checks = "";
      try {
        const c = await g("commits/" + p.head.sha + "/check-runs");
        checks = (c.check_runs || []).map(x => x.name + ": " + (x.conclusion || x.status)).join(", ");
      } catch {
        // check results are optional extra detail
      }
      return `#${n} ${p.title} [${p.state}${p.merged ? ", merged" : ""}${p.draft ? ", draft" : ""}] by ${p.user.login}, ${p.head.ref} → ${p.base.ref}
mergeable: ${p.mergeable == null ? "checking" : p.mergeable ? "yes" : "no (conflicts)"}${checks ? "\nchecks: " + checks : ""}
+${p.additions} -${p.deletions} in ${p.changed_files} files:
${f.map(x => `- ${x.filename} (${x.status}, +${x.additions} -${x.deletions})`).join("\n")}

${clip(p.body || "(no description)", 3000)}`;
    }
    case "diff": {
      if (need()) return need();
      const f = await g("pulls/" + n + "/files?per_page=60");
      const t = f
          .map(x => `--- ${x.filename} (${x.status})\n${x.patch || "(binary or too big to show)"}`)
          .join("\n\n"),
        at = Math.max(0, a.at || 0),
        k = 9000;
      return t.slice(at, at + k) + (at + k < t.length ? `\n[more: diff at=${at + k}]` : "");
    }
    case "issues": {
      const l = (await g("issues?state=open&per_page=20")).filter(i => !i.pull_request);
      return l.length
        ? l.map(i => `#${i.number} ${i.title} (${i.user.login}, ${ago(i.updated_at)})`).join("\n")
        : "No open issues.";
    }
    case "commits": {
      const l = await g("commits?sha=main&per_page=12");
      return l
        .map(
          c =>
            `${c.sha.slice(0, 7)} ${clip(c.commit.message.split("\n")[0], 90)} (${ago(c.commit.author.date)})`,
        )
        .join("\n");
    }
    case "merge": {
      if (need()) return need();
      const p = await g("pulls/" + n);
      if (p.state !== "open") return `#${n} isn't open.`;
      if (p.mergeable === false) return `#${n} has conflicts; it can't merge.`;
      if (
        !(await approve(
          "Merge PR #" + n + " (goes live in ~3 min)",
          `${p.title}\n${p.head.ref} → ${p.base.ref}, +${p.additions} -${p.deletions} in ${p.changed_files} files`,
        ))
      )
        return no;
      const r = await g("pulls/" + n + "/merge", "PUT", { merge_method: "squash" });
      return r.merged
        ? `Merged #${n}. The home server deploys it within a few minutes.`
        : "Merge failed: " + (r.message || "");
    }
    case "comment": {
      if (need()) return need();
      if (!a.text) return "Say what to write.";
      if (!(await approve("Comment on #" + n, a.text))) return no;
      await g("issues/" + n + "/comments", "POST", { body: a.text });
      return "Commented on #" + n + ".";
    }
    case "close": {
      if (need()) return need();
      if (!(await approve("Close #" + n, a.text || ""))) return no;
      await g("issues/" + n, "PATCH", { state: "closed" });
      return "Closed #" + n + ".";
    }
    case "issue": {
      if (!a.title) return "Give a title.";
      if (!(await approve("Open an issue", a.title + (a.text ? "\n\n" + a.text : "")))) return no;
      const r = await g("issues", "POST", { title: a.title, body: a.text || "" });
      return "Opened #" + r.number + ".";
    }
  }
  return "Unknown github action.";
}

/* Moodle files come back through the bearer-only GET (no URL ever reaches the model) and are read with the document parsers */
export async function moodleFile(id) {
  const r = await fetch(aiBase() + "/api/moodle/file/" + id, {
    headers: { Authorization: "Bearer " + syncConfig().token },
  });
  if (!r.ok) throw new Error("Download failed (" + r.status + ").");
  return r.arrayBuffer();
}
const moodleRead = async dl => {
  const { extract } = await import("./docs.js");
  return (await extract(new File([await moodleFile(dl.id)], dl.name))).text;
};

async function run(name, a) {
  switch (name) {
    case "moodle":
      return moodleTool(a, {
        call: b => api("/api/moodle", b),
        readFile: moodleRead,
        save: async b => {
          const r = await api("/api/moodle/save", b);
          syncNow();
          return r.t;
        },
      });
    case "capabilities":
      return JSON.stringify(capabilities(a.col, D));
    case "apply_changes":
      return changeData(a.changes);
    case "control":
      return control(a);
    case "github":
      return github(a);
    case "data":
      return data(a);
    case "nijika":
      return nijika(a);
    case "set_style":
      return editStyle(a.text, a.mode);
    case "draft_app": {
      const draft = await api("/api/change/create", { request: a.request });
      const m = await import("../modules/app-changes.js");
      m.openChanges(null, draft.id);
      return `Draft started. ${U().Name} can check progress, cost, preview and code changes in Change the app. Only ${U().his} Apply button publishes it; do not poll using AI calls.`;
    }
    case "look":
      return look(a.window);
    case "search": {
      const where = a.where || "all",
        out = [];
      if (where !== "sources") out.push(...searchNotes(a.q));
      /* sources are only searched when this chat uses some, or when he asks for sources outright */
      const mine = (CUR.chat && CUR.chat.src) || [];
      if (D.sources.length && (where === "sources" || (where === "all" && mine.length))) {
        const src = mine;
        try {
          const r = await api("/api/src/search", { q: a.q, src, k: 5 });
          r.hits.forEach(h =>
            out.push(`(${h.title}) [source ${h.src}, part ${h.i}] ${h.text.replace(/\s+/g, " ")}`),
          );
        } catch (e) {
          out.push("(sources unavailable: " + e.message + ")");
        }
      }
      return out.length ? out.join("\n\n") : "Nothing found for that. Try other words, or the web.";
    }
    case "read": {
      if (a.source) {
        const r = await api("/api/src/read", { src: a.source, i: a.at || 0, n: 3 });
        return (
          `${r.title}, parts ${r.from}-${r.from + r.parts.length - 1} of ${r.total}:\n\n` +
          r.parts.join("\n\n") +
          (r.from + r.parts.length < r.total ? `\n[more: read source at=${r.from + r.parts.length}]` : "")
        );
      }
      const p = findPage(a.page);
      if (!p) return "No page called " + a.page + ". Use search to find it.";
      const b = p.body || "",
        at = Math.max(0, a.at || 0),
        n = 7000;
      return (
        `Page "${p.title}" (${b.length} chars, from ${at}):\n` +
        b.slice(at, at + n) +
        (at + n < b.length ? `\n[more: read page at=${at + n}]` : "")
      );
    }
    case "web_search": {
      const r = await api("/api/web/search", { q: a.q });
      return r.results.map((x, i) => `${i + 1}. ${x.title}\n${x.url}\n${x.snippet}`).join("\n\n");
    }
    case "read_url": {
      const r = await api("/api/web/read", { url: a.url, from: a.at || 0 });
      return (
        `${r.title} (${r.total} chars, from ${r.from}):\n${r.text}` +
        (r.more ? `\n[more: read_url at=${r.from + r.text.length}]` : "")
      );
    }
    case "write_page": {
      const pages = await import("../modules/pages.js");
      const ex = findPage(a.title),
        stamp = new Date().toISOString();
      if (a.mode !== "new" && ex && low(ex.title) === low(a.title)) {
        W.upd("pages", ex._id, {
          body: a.mode === "replace" ? a.body : (ex.body || "").replace(/\s+$/, "") + "\n\n" + a.body,
          upd: stamp,
        });
        return (a.mode === "replace" ? "Replaced" : "Appended to") + ` "${ex.title}".`;
      }
      if (a.kind === "subject" && ex && ex.kind === "subject" && low(ex.title) === low(a.title))
        return `Subject "${ex.title}" already exists (id ${ex._id}); file pages under it.`;
      const par = a.under ? findPage(a.under) : null;
      const id = pages.makePage({
        title: a.title,
        body: a.body,
        ...(a.kind === "subject" ? { kind: "subject" } : {}),
        ...(par ? { parent: par._id } : {}),
      });
      return `Created ${a.kind === "subject" ? "subject" : "page"} "${a.title}" (id ${id})${par ? " under " + par.title : ""}.`;
    }
    case "add_cards": {
      /* cards go in the page's deck, not into the note text */
      const cards = (a.cards || [])
        .filter(c => c && c.q && c.a)
        .map(c => ({ q: String(c.q).trim(), a: String(c.a).replace(/\n/g, " ").trim() }));
      if (!cards.length) return "No cards given.";
      const { addCards } = await import("../modules/study.js");
      let p = findPage(a.page);
      if (!p) {
        const pages = await import("../modules/pages.js");
        const id = pages.makePage({ title: a.page });
        W.upd("pages", id, { deck: cards });
        return `Made page "${a.page}" (id ${id}) with ${cards.length} flashcards.`;
      }
      addCards(p, cards);
      return `Added ${cards.length} flashcards to "${p.title}".`;
    }
    case "quick": {
      const { best } = await import("../shell/route.js");
      const act = best(a.line);
      if (!act) return `Couldn't read "${a.line}" as a reminder/event/todo. Rephrase it.`;
      // run it without dragging the user away from the chat
      const keep = ["os-view", "os-open"].map(k => [k, ls.get(k)]);
      act.r();
      keep.forEach(([k, v]) => v !== undefined && ls.set(k, v));
      return "Done: " + act.l;
    }
    case "show": {
      if (a.review) {
        const st = await import("../modules/study.js");
        const p = findPage(a.page);
        const ids = p ? st.family(p._id) : null,
          n = st.dueIn(ids).length;
        if (!n) return "No flashcards due there.";
        st.startReview(ids, p ? p.title : "All subjects");
        return `Started a review of ${n} cards.`;
      }
      if (a.page) {
        const p = findPage(a.page);
        if (!p) return "No such page.";
        const pages = await import("../modules/pages.js");
        pages.openPage(p._id);
        return `Opened "${p.title}".`;
      }
      if (a.window) {
        let window = a.window;
        if (window === "timetable" || window === "schedule") {
          ls.set("os-calmode", "classes");
          window = "calendar";
        }
        if (window === "budgets") window = "money";
        if (window === "timer") window = "pomodoro";
        if (!reg.ids.includes(hubOf(window))) return "Unknown window. Use look or capabilities to find it.";
        openMod(window, true);
        return "Opened " + winLabel(a.window) + ".";
      }
      return "Say what to show.";
    }
  }
  return "Unknown tool " + name;
}
const LABEL = {
  set_style: a => (a.mode === "remove" ? "Dropped one of your rules" : "Updated your rules"),
  look: a => "Looked at " + winLabel(a.window || lastWin()),
  search: a => "Searched “" + a.q + "”",
  read: a => "Read " + (a.source ? "a source" : "“" + (a.page || "") + "”") + (a.at ? " (more)" : ""),
  capabilities: a => "Checked " + (a.col || "app") + " capabilities",
  apply_changes: a => "App changes (" + (a.changes || []).length + ")",
  control: a => "App control: " + a.do.replace(/_/g, " "),
  draft_app: () => "Prepared an app-change draft",
  web_search: a => "Searched " + String(a.q).slice(0, 40),
  read_url: a =>
    "Read " +
    String(a.url)
      .replace(/^https?:\/\/(www\.)?/, "")
      .slice(0, 40),
  write_page: a => (a.mode === "new" ? "Wrote " : "Updated ") + "“" + a.title + "”",
  github: a =>
    ({
      prs: "Checked open PRs",
      pr: "Read PR #" + a.n,
      diff: "Read PR #" + a.n + "'s changes",
      issues: "Checked issues",
      commits: "Checked recent commits",
      merge: "Merged PR #" + a.n,
      comment: "Commented on #" + a.n,
      close: "Closed #" + a.n,
      issue: "Opened an issue",
    })[a.do] || "GitHub",
  ask: () => "Asked a question",
  moodle: a =>
    ({
      courses: "Checked Moodle courses",
      course: "Opened a Moodle course",
      assignments: "Checked Moodle assignments",
      announcements: "Read Moodle announcements",
      read: "Read a Moodle file",
      save: "Saved a Moodle file to Notes",
    })[a.do] || "Moodle",
  data: a =>
    ({
      list: "Looked at " + a.col,
      get: "Looked at " + a.col,
      add: "Added to " + a.col,
      update: "Updated " + a.col,
      delete: "Deleted from " + a.col,
    })[a.do] || a.col,
  nijika: a =>
    ({
      ls: "Looked in " + (a.path || "~"),
      read: "Read " + (a.path || "a file"),
      services: "Checked the home server's services",
      logs: "Read " + (a.name || "") + " logs",
      write: "Wrote " + (a.path || "a file"),
      run: "Ran " + clip(a.cmd || "", 40),
      service: (a.act || "") + " " + (a.name || ""),
      hermes: "Asked Hermes",
    })[a.do] || "Home server",
  add_cards: a => "Added " + (a.cards || []).length + " flashcards",
  quick: a => a.line,
  show: a => (a.review ? "Started a review" : "Opened " + (a.page || winLabel(a.window))),
};
export const toolLabel = (name, args) => {
  try {
    return (LABEL[name] || (() => name))(args || {});
  } catch (e) {
    return name;
  }
};

export { CUR, run };
