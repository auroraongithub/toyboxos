/* Moodle (the school site set on the server, moodle.json): Timeline (what's due across in-progress courses) | Courses | a course page with its contents,
   assignments and announcements. Read only, through /api/moodle on the sync server (the Moodle token stays on the home server).
   Files open in the Notes reader (doc.mdl, fetched with the bearer header, never a public URL) or save to the device. */
import { useState, useEffect, useRef } from "preact/hooks";
import { on as featOn } from "../core/features.js";
import { html, TZ, openExternal } from "../core/lib.js";
import { ls, usePref } from "../core/pref.js";
import { D, W } from "../core/store.js";
import { toast } from "../core/bus.js";
import { render } from "../core/md.js";
import { api, aiBase, moodleFile, draftMessage } from "../core/ai.js";
import { mdText } from "../core/moodle.js";
import { docType, extract } from "../core/docs.js";
import { pushBack, dropBack, fromBack } from "../core/back.js";
import { Panel, Btn, Group, Empty, Icon, Seg, Tag } from "../ui/index.js";
import { actionSheet, openSheet } from "../ui/sheet.js";
import { openMod } from "../shell/os.js";

import { AI } from "../core/pack.js";
/* ---------- data: one cached request per key, shared by every view; courses + timeline survive a restart ---------- */
const C = new Map(),
  flying = new Map(),
  KEEP = ["courses", "timeline"];
for (const k of KEEP) {
  const v = ls.get("os-mdl-" + k, null);
  if (v) C.set(k, { v, t: 0 });
}
const call = b => api("/api/moodle", b);
/* the server's Moodle address (moodle.json there), remembered for "Open in Moodle" links */
const site = () => ls.get("os-mdl-site", "");
let siteAsked = false;
const askSite = () => {
  if (siteAsked) return;
  siteAsked = true;
  call({ action: "site" }).then(
    r => {
      if (r && r.site) ls.set("os-mdl-site", r.site);
    },
    () => {},
  );
};
function get(key, body, force) {
  const c = C.get(key);
  if (c && !force && Date.now() - c.t < 5 * 60e3) return Promise.resolve(c.v);
  if (!flying.has(key))
    flying.set(
      key,
      (typeof body === "function" ? body() : call(body))
        .then(v => {
          C.set(key, { v, t: Date.now() });
          if (KEEP.includes(key)) ls.set("os-mdl-" + key, v);
          return v;
        })
        .finally(() => flying.delete(key)),
    );
  return flying.get(key);
}
function useMd(key, body) {
  const [s, setS] = useState(() => ({ v: (C.get(key) || {}).v }));
  const load = force => {
    setS(o => ({ ...o, busy: 1, err: "" }));
    get(key, body, force).then(
      v => setS({ v }),
      e => setS(o => ({ v: o.v, err: e.message })),
    );
  };
  useEffect(() => load(false), [key]);
  return { ...s, reload: () => load(true) };
}

/* ---------- helpers ---------- */
const NOW = () => Date.now() / 1000;
const cname = c => mdText(c.displayname || c.fullname);
const inProgress = c => {
  const n = NOW();
  return (!c.startdate || c.startdate <= n) && (!c.enddate || c.enddate >= n);
};
const day = s =>
  new Date(s * 1000).toLocaleDateString("en-PH", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
const time = s =>
  new Date(s * 1000).toLocaleTimeString("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const short = s =>
  new Date(s * 1000).toLocaleDateString("en-PH", { timeZone: TZ, month: "short", day: "numeric" });
const size = n =>
  n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB";
/* Moodle HTML -> markdown (links kept, everything else as text); md.js escapes any raw HTML that's left */
const toMd = h =>
  mdText(
    String(h || "")
      .replace(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_, u, t) => `[${mdText(t) || u}](${u})`,
      )
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**"),
  ).replace(/\n(?!- )/g, "\n\n");
const Md = ({ src }) =>
  html`<div class="md selectable mdl-md" dangerouslySetInnerHTML=${{ __html: render(src) }}/>`;
const dueOf = m => (m.dates || []).find(x => x.dataid === "duedate" || x.dataid === "timeclose");
const due = m => {
  const d = dueOf(m);
  return d ? d.timestamp : 0;
};
const dueWord = (m, t) =>
  (dueOf(m) || {}).dataid === "timeclose"
    ? t < NOW()
      ? "closed "
      : "closes "
    : t < NOW()
      ? "was due "
      : "due ";
const done = m => !!(m.completiondata && m.completiondata.state >= 1);
const KIND = {
  assign: "Assignment",
  quiz: "Quiz",
  feedback: "Feedback",
  forum: "Forum",
  resource: "File",
  folder: "Folder",
  url: "Link",
  page: "Page",
  lesson: "Lesson",
  choice: "Choice",
  workshop: "Workshop",
};
const ICON = {
  assign: "task",
  quiz: "cards",
  feedback: "list",
  forum: "bell",
  resource: "file",
  folder: "folder",
  url: "links",
  page: "notes",
  lesson: "notes",
};
const files = m => (m.contents || []).filter(k => k.type === "file");
const openWeb = u => openExternal(u);

/* timeline = every module with a due/close date in the in-progress courses (one contents call per course, shared with the course page) */
const timeline = async () => {
  const cs = (await get("courses", { action: "courses" })).filter(inProgress),
    out = [];
  await Promise.all(
    cs.map(async c => {
      const secs = await get("c" + c.id, { action: "contents", course: c.id }).catch(() => []);
      for (const s of secs)
        for (const m of s.modules || []) {
          const t = due(m);
          if (t && m.uservisible !== false)
            out.push({
              t,
              id: m.id,
              name: mdText(m.name),
              mod: m.modname,
              url: m.url,
              done: done(m),
              course: c.id,
              cn: cname(c),
            });
        }
    }),
  );
  return out.sort((a, b) => a.t - b.t);
};

/* ---------- files ---------- */
async function bytes(course, m, i) {
  const dl = await call({ action: "download", course, module: m.id, file: i });
  return { dl, buf: await moodleFile(dl.id) };
}
/* a file read in Notes: one page per download (re-opening finds it), filed under the subject whose Course code matches */
async function readInNotes(c, m, i) {
  const f = files(m)[i];
  toast("Opening " + f.filename + "…");
  try {
    const { dl, buf } = await bytes(c.id, m, i),
      ex = D.pages.find(p => p.doc && p.doc.mdl === dl.id);
    if (ex) {
      ls.set("os-page", ex._id);
      openMod("notes", true);
      return;
    }
    const r = await extract(new File([buf], dl.name)),
      key = (c.shortname + " " + cname(c)).toLowerCase();
    const subj = D.pages.find(
      p =>
        p.kind === "subject" &&
        (p.props || []).some(
          ([k, v]) => /course|code/i.test(k) && v && key.includes(String(v).trim().toLowerCase()),
        ),
    );
    const id = "mdl-" + dl.id,
      at = new Date().toISOString();
    W.set("pages", id, {
      title: mdText(m.name) || r.title,
      kind: "note",
      icon: "",
      body: r.text,
      props: [["Course", cname(c)]],
      pin: false,
      parent: subj ? subj._id : "",
      at,
      upd: at,
      doc: { mdl: dl.id, name: dl.name, type: docType(dl.name), pages: r.pages, size: dl.size },
    });
    ls.set("os-page", id);
    openMod("notes", true);
  } catch (e) {
    toast(e.message);
  }
}
async function save(c, m, i) {
  toast("Downloading…");
  try {
    const { dl, buf } = await bytes(c.id, m, i),
      u = URL.createObjectURL(new Blob([buf], { type: dl.type })),
      a = document.createElement("a");
    a.href = u;
    a.download = dl.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 6e4);
    toast("Saved " + dl.name);
  } catch (e) {
    toast(e.message);
  }
}
const ask = (c, m, i) => {
  try {
    draftMessage(
      `From my Moodle course ${c.id} (${cname(c)}), read module ${m.id} file ${i} ("${files(m)[i].filename}") and `,
      { title: mdText(m.name) },
    );
  } catch (e) {
    toast(e.message);
  }
};
async function showPage(c, m) {
  openSheet({
    title: mdText(m.name),
    Body: () => {
      const [t, setT] = useState(null);
      useEffect(() => {
        bytes(c.id, m, 0).then(
          ({ buf }) => setT(toMd(new TextDecoder().decode(buf))),
          e => setT("*" + e.message + "*"),
        );
      }, []);
      return html`<div class="mdl-sheet">${t == null ? html`<${Empty}>Loading…<//>` : html`<${Md} src=${t}/>`}<div class="mdl-acts"><${Btn} icon="globe" onClick=${() => openWeb(m.url)}>Open in Moodle<//></div></div>`;
    },
  });
}

/* what tapping an activity does */
function act(c, m, e, toTab) {
  const fs = files(m),
    web = ["globe", "Open in Moodle", () => openWeb(m.url)],
    at = e.currentTarget;
  if (m.modname === "forum" && m.name.toLowerCase().includes("announce")) return toTab("news");
  if (m.modname === "assign") return toTab("assign", m.instance);
  if (m.modname === "page") return showPage(c, m);
  if (m.modname === "url" && m.contents && m.contents[0])
    return actionSheet(
      mdText(m.name),
      [["links", "Open link", () => openWeb(m.contents[0].fileurl)], web],
      at,
    );
  if (fs.length) {
    const items = [];
    fs.forEach((f, i) => {
      const name = fs.length > 1 ? " " + f.filename : "";
      if (docType(f.filename))
        items.push(
          ["notes", "Read in Notes" + name, () => readInNotes(c, m, i)],
          featOn("ai") ? ["buddy", "Ask " + AI.name + name, () => ask(c, m, i)] : null,
        );
      items.push(["export", "Save to device" + name + " · " + size(f.filesize || 0), () => save(c, m, i)]);
    });
    return actionSheet(mdText(m.name), [...items, web], at);
  }
  openWeb(m.url);
}

/* ---------- views ---------- */
function Problem({ err, reload }) {
  const setup = /not connected|moodle_setup/i.test(err);
  return html`<${Empty} pad><div class="mdl-err">${setup ? "Moodle isn't connected yet. Sync > Moodle says how." : err}</div>
    <div class="mdl-acts">${setup ? html`<${Btn} icon="sync" onClick=${() => openMod("sync", true)}>Open Sync<//>` : null}<${Btn} icon="reset" onClick=${reload}>Try again<//></div><//>`;
}
const Busy = ({ s }) =>
  s.busy && s.v ? html`<div class="mdl-busy" aria-live="polite">Updating…</div>` : null;

function Timeline({ openCourse }) {
  const s = useMd("timeline", timeline),
    [f, setF] = usePref("os-mdl-tl", "7");
  if (s.err && !s.v) return html`<${Problem} err=${s.err} reload=${s.reload}/>`;
  if (!s.v) return html`<${Empty} pad>Checking every course…<//>`;
  const n = NOW(),
    items = s.v
      .filter(x =>
        f === "past"
          ? x.t < n && x.t > n - 30 * 86400 && !x.done
          : x.t >= n - 3600 * 12 && (f === "all" || x.t < n + +f * 86400),
      )
      .sort((a, b) => (f === "past" ? b.t - a.t : a.t - b.t));
  const groups = [];
  for (const x of items) {
    const d = day(x.t),
      g = groups[groups.length - 1];
    if (g && g[0] === d) g[1].push(x);
    else groups.push([d, [x]]);
  }
  return html`<div class="mdl-bar"><${Seg}>${[
    ["7", "7 days"],
    ["30", "30 days"],
    ["all", "All"],
    ["past", "Missed?"],
  ].map(([k, l]) => html`<${Btn} aria-pressed=${String(f === k)} onClick=${() => setF(k)}>${l}<//>`)}<//>
      <span class="sp"/><${Busy} s=${s}/><${Btn} cls="ib" icon="reset" aria-label="Refresh" title="Refresh" onClick=${s.reload}/></div>
    <${Panel}><div class="ll">
      ${
        groups.length
          ? groups.map(
              ([d, xs]) =>
                html`<${Group} title=${d}/>${xs.map(
                  x => html`<div class=${"lr mdl-row" + (x.done ? " done" : "") + (f === "past" ? " late" : "")} key=${x.id} onClick=${() => openCourse(x.course, x.id)}>
          <span class="when">${time(x.t)}</span><${Icon} n=${ICON[x.mod] || "file"}/><span class="tt">${x.name}<small>${KIND[x.mod] || x.mod} · ${x.cn}</small></span>${x.done ? html`<${Tag}>done<//>` : null}</div>`,
                )}`,
            )
          : html`<${Empty} pad>${f === "past" ? "Nothing closed in the last 30 days without being marked done." : "Nothing due " + (f === "all" ? "ahead" : "in the next " + f + " days") + "."}<//>`
      }
    </div><//>`;
}

function Courses({ openCourse }) {
  const s = useMd("courses", { action: "courses" }),
    [f, setF] = usePref("os-mdl-cf", "now");
  if (s.err && !s.v) return html`<${Problem} err=${s.err} reload=${s.reload}/>`;
  if (!s.v) return html`<${Empty} pad>Loading courses…<//>`;
  const n = NOW(),
    cs = s.v
      .filter(c => f === "all" || (f === "now" ? inProgress(c) : c.enddate && c.enddate < n))
      .sort((a, b) => (b.startdate || 0) - (a.startdate || 0) || cname(a).localeCompare(cname(b)));
  return html`<div class="mdl-bar"><${Seg}>${[
    ["now", "In progress"],
    ["past", "Past"],
    ["all", "All"],
  ].map(([k, l]) => html`<${Btn} aria-pressed=${String(f === k)} onClick=${() => setF(k)}>${l}<//>`)}<//>
      <span class="sp"/><${Busy} s=${s}/><${Btn} cls="ib" icon="reset" aria-label="Refresh" title="Refresh" onClick=${s.reload}/></div>
    <${Panel}><div class="ll">${
      cs.length
        ? cs.map(
            c => html`<div class="lr mdl-row" key=${c.id} onClick=${() => openCourse(c.id)}>
        <${Icon} n="subject"/><span class="tt">${cname(c)}<small>${mdText(c.shortname)}</small></span>${c.progress != null ? html`<span class="sub">${Math.round(c.progress)}%</span>` : null}</div>`,
          )
        : html`<${Empty} pad>No courses here.<//>`
    }</div><//>`;
}

function Contents({ c, hi, toTab }) {
  const s = useMd("c" + c.id, { action: "contents", course: c.id }),
    box = useRef();
  useEffect(() => {
    if (!hi || !s.v || !box.current) return;
    const el = box.current.querySelector(`[data-m="${hi}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("hi");
    }
  }, [hi, !!s.v]);
  if (s.err && !s.v) return html`<${Problem} err=${s.err} reload=${s.reload}/>`;
  if (!s.v) return html`<${Empty} pad>Loading the course…<//>`;
  return html`<${Panel}><div class="ll" ref=${box}>${s.v.map(sec => {
    const ms = (sec.modules || []).filter(m => m.uservisible !== false && m.visible !== 0);
    if (!ms.length && !mdText(sec.summary)) return null;
    return html`<${Group} title=${mdText(sec.name) || "General"}/>${mdText(sec.summary) ? html`<div class="mdl-sum"><${Md} src=${toMd(sec.summary)}/></div>` : null}
        ${ms.map(m => {
          const t = due(m),
            fs = files(m);
          return html`<div class=${"lr mdl-row" + (done(m) ? " done" : "")} data-m=${m.id} key=${m.id} onClick=${e => act(c, m, e, toTab)}>
          <${Icon} n=${ICON[m.modname] || "file"}/><span class="tt">${mdText(m.name)}<small>${KIND[m.modname] || m.modname}${fs.length && m.modname === "resource" ? " · " + fs.map(f => f.filename.replace(/^.*\./, "").toUpperCase()).join(", ") : ""}${t ? " · " + dueWord(m, t) + short(t) + ", " + time(t) : ""}</small></span>
          ${done(m) ? html`<${Tag}>done<//>` : null}</div>`;
        })}`;
  })}
    </div><//>`;
}

function Assignments({ c, open }) {
  const s = useMd("a" + c.id, { action: "assignments", course: c.id }),
    [cur, setCur] = useState(open || 0);
  if (s.err && !s.v) return html`<${Problem} err=${s.err} reload=${s.reload}/>`;
  if (!s.v) return html`<${Empty} pad>Loading assignments…<//>`;
  const n = NOW(),
    as = (s.v.courses || [])
      .flatMap(k => k.assignments || [])
      .sort((a, b) => (b.duedate || 0) - (a.duedate || 0));
  const up = as.filter(a => a.duedate >= n).reverse(),
    old = as.filter(a => !(a.duedate >= n));
  const row =
    a => html`<div class=${"lr mdl-row" + (cur === a.id ? " open" : "")} key=${a.id} onClick=${() => setCur(cur === a.id ? 0 : a.id)}>
      <span class="when">${a.duedate ? short(a.duedate) : "no date"}</span><span class="tt">${mdText(a.name)}<small>${a.duedate ? (a.duedate < n ? "closed " : "due ") + day(a.duedate) + ", " + time(a.duedate) : "No due date"}</small></span></div>
    ${
      cur === a.id
        ? html`<div class="mdl-detail">${mdText(a.intro) ? html`<${Md} src=${toMd(a.intro)}/>` : html`<p class="mdl-dim">No instructions.</p>`}
      ${(a.introattachments || []).length ? html`<p class="mdl-dim">Attached in Moodle: ${a.introattachments.map(f => f.filename).join(", ")}</p>` : null}
      <div class="mdl-acts"><${Btn} icon="globe" onClick=${() => openWeb(`${site()}/mod/assign/view.php?id=${a.cmid}`)}>Open in Moodle<//></div></div>`
        : null
    }`;
  return html`<${Panel}><div class="ll">${!as.length ? html`<${Empty} pad>No assignments in this course.<//>` : null}
    ${up.length ? html`<${Group} title="Coming up"/>${up.map(row)}` : null}${old.length ? html`<${Group} title="Earlier"/>${old.map(row)}` : null}</div><//>`;
}

function News({ c }) {
  const f = useMd("f" + c.id, { action: "forums", course: c.id }),
    news = f.v && f.v.find(x => x.type === "news");
  const s = useMd(
      news ? "n" + news.id : "n-",
      news
        ? { action: "discussions", course: c.id, forum: news.id, page: 0 }
        : () => Promise.resolve({ discussions: [] }),
    ),
    [cur, setCur] = useState(0);
  const err = f.err || s.err;
  if (err && !s.v)
    return html`<${Problem} err=${err} reload=${() => {
      f.reload();
      s.reload();
    }}/>`;
  if (!f.v || !s.v) return html`<${Empty} pad>Loading announcements…<//>`;
  const ds = s.v.discussions || [];
  return html`<${Panel}><div class="ll">${
    !news
      ? html`<${Empty} pad>This course has no announcements forum.<//>`
      : !ds.length
        ? html`<${Empty} pad>No announcements yet.<//>`
        : ds.map(
            d => html`<div class=${"lr mdl-row" + (cur === d.id ? " open" : "")} key=${d.id} onClick=${() => setCur(cur === d.id ? 0 : d.id)}>
        <span class="when">${short(d.timemodified || d.created)}</span><span class="tt">${mdText(d.name || d.subject)}<small>${d.userfullname || ""}</small></span>${d.pinned ? html`<${Tag}>pinned<//>` : null}</div>
      ${cur === d.id ? html`<div class="mdl-detail"><${Md} src=${toMd(d.message)}/></div>` : null}`,
          )
  }</div><//>`;
}

const CTABS = [
  ["course", "Course", "subject"],
  ["assign", "Assignments", "task"],
  ["news", "Announcements", "bell"],
];
function Course({ id, hi, back }) {
  const cs = useMd("courses", { action: "courses" }),
    [tab, setTab] = useState("course"),
    [open, setOpen] = useState(0);
  const c = cs.v && cs.v.find(x => x.id === id);
  if (!c)
    return cs.err ? html`<${Problem} err=${cs.err} reload=${cs.reload}/>` : html`<${Empty} pad>Loading…<//>`;
  const toTab = (t, a) => {
    setOpen(a || 0);
    setTab(t);
  };
  return html`<div class="mdl-head"><button class="hbk" onClick=${back}><${Icon} n="back"/>Courses</button><b class="selectable">${cname(c)}</b>
      <${Btn} cls="ib" icon="globe" aria-label="Open in Moodle" title="Open in Moodle" onClick=${() => openWeb(site() + "/course/view.php?id=" + c.id)}/></div>
    <div class="mdl-ctabs" role="tablist">${CTABS.map(([k, l, ic]) => html`<button class="ht" role="tab" key=${k} aria-selected=${String(k === tab)} onClick=${() => toTab(k)}><${Icon} n=${ic}/><span>${l}</span></button>`)}</div>
    ${tab === "assign" ? html`<${Assignments} c=${c} open=${open}/>` : tab === "news" ? html`<${News} c=${c}/>` : html`<${Contents} c=${c} hi=${hi} toTab=${toTab}/>`}`;
}

const TABS = [
  ["timeline", "Timeline", "clock"],
  ["courses", "Courses", "subject"],
];
function Moodle() {
  useEffect(askSite, []);
  const [tab, setTab] = usePref("os-mdl-tab", "timeline"),
    [course, setCourse] = usePref("os-mdl-course", 0),
    [hi, setHi] = useState(0);
  const prev = useRef(course);
  useEffect(() => {
    const p = prev.current;
    prev.current = course;
    if (fromBack() || !!p === !!course) return;
    if (course) pushBack("mdl", () => setCourse(0));
    else dropBack("mdl");
  }, [course]);
  if (!aiBase())
    return html`<${Panel}><${Empty} pad>Turn on Sync first: Moodle goes through your server.<div class="mdl-acts"><${Btn} icon="sync" onClick=${() => openMod("sync", true)}>Open Sync<//></div><//><//>`;
  const openCourse = (id, m) => {
    setHi(m || 0);
    setCourse(id);
  };
  return html`<div class="mdl">${
    course
      ? html`<${Course} key=${course} id=${course} hi=${hi} back=${() => {
          setHi(0);
          setCourse(0);
        }}/>`
      : html`<div class="hubtabs" role="tablist">${TABS.map(([k, l, ic]) => html`<button class="ht" role="tab" key=${k} aria-selected=${String(k === tab)} onClick=${() => setTab(k)}><${Icon} n=${ic}/><span>${l}</span></button>`)}</div>
      ${tab === "courses" ? html`<${Courses} openCourse=${openCourse}/>` : html`<${Timeline} openCourse=${openCourse}/>`}`
  }</div>`;
}

const go = id => {
  ls.set("os-mdl-course", id || 0);
  openMod("moodle", true);
};
export default {
  id: "moodle",
  opt: "moodle",
  name: "Moodle",
  title: "moodle",
  Comp: Moodle,
  cmd: v =>
    ["moodle", "lms", "courses"].includes(v) ? [{ icon: "moodle", l: "Open Moodle", r: () => go(0) }] : [],
  search: q => {
    const cs = (C.get("courses") || {}).v || [],
      l = q.toLowerCase();
    return cs
      .filter(c => (cname(c) + " " + c.shortname).toLowerCase().includes(l))
      .slice(0, 4)
      .map(c => ({ icon: "moodle", l: cname(c), r: () => go(c.id) }));
  },
};
