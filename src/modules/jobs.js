/* Jobs: the daily scored feed (when the server has one) and a tracker for jobs you add yourself.
   Stages: new (the feed's inbox) > saved > applied > interview > offer, or closed (stored as "skip"). */
import { useState } from "preact/hooks";
import { html, today, openExternal } from "../core/lib.js";
import { usePref } from "../core/pref.js";
import { useCols, W, D, meta, drop } from "../core/store.js";
import { hasCap } from "../core/features.js";
import { Tools, Panel, Field, Tabs, Icon, Btn, Select, AddBtn } from "../ui/index.js";
import { openMod } from "../shell/os.js";
import { actionSheet, openSheet } from "../ui/sheet.js";

const STATUS = [
  ["new", "New"],
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["skip", "Closed"],
];
const LABEL = Object.fromEntries(STATUS);
const STAGES = STATUS.slice(1);
const TYPES = { Any: "Flexible", "Full Time": "Full-time", "Part Time": "Part-time", Gig: "Gig" };
const st = j => j.status || "new";
function age(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  if (!m) return "";
  const days = Math.floor((Date.now() - new Date(+m[1], +m[2] - 1, +m[3]).getTime()) / 864e5);
  return days < 1
    ? "today"
    : days < 14
      ? days + "d"
      : days < 60
        ? Math.floor(days / 7) + "w"
        : Math.floor(days / 30) + "mo";
}
export function payTier(j) {
  const p = (j.pay || "").toLowerCase(),
    flags = (j.flags || []).join(" ").toLowerCase();
  if (!p || /not listed|tbd|negotiable/.test(p)) return "none";
  if (/low pay/.test(flags)) return "low";
  const nums = (p.match(/\d[\d,]*\.?\d*/g) || []).map(n => parseFloat(n.replace(/,/g, "")));
  if (!nums.length) return "none";
  const top = Math.max(...nums);
  if (/hour|hr/.test(p)) return top >= 10 ? "good" : top >= 7 ? "mid" : "low";
  if (/month|p\/m|mo\b/.test(p)) return top >= 1000 ? "good" : top >= 600 ? "mid" : "low";
  return "good";
}
const cleanPay = p =>
  !p
    ? "not listed"
    : p
        .replace(/^(\d[\d.]*)\s*\(likely \$\/hr\)/i, "$$$1/hr")
        .replace(/\s*\(likely \$\/hr\)/i, "")
        .replace(/\s*USD/i, "")
        .replace(/\/hour/i, "/hr");

/* the list shows the rate itself; "(likely ...)" notes and the rest stay in the tooltip and the expanded row */
const shortPay = p => {
  const c = cleanPay(p),
    s = c.replace(/\s*\(.*$/, "").trim(),
    lk = c.match(/\(likely ([^)]*?)(?: depending[^)]*)?\)/i);
  return s && (/[$₱€£]|php|usd|negotiable|listed/i.test(s) || !lk) ? s : lk ? lk[1] : c;
};

/* feed jobs carry a fit score; the ones you add yourself don't */
const fromFeed = j => typeof j.fit === "number";
const feedOn = () => hasCap("jobs");
const setStage = (j, k) => W.upd("jobs", j._id, { status: k, statusAt: new Date().toISOString() });
/* "Frontend dev at Acme https://…" -> {title, company, url} */
const parseLine = s => {
  const url = (s.match(/https?:\/\/\S+/) || [""])[0];
  const rest = s.replace(url, "").trim();
  const m = rest.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
  return { title: (m ? m[1] : rest).trim(), company: m ? m[2].trim() : "", url };
};

function JobForm({ job = {}, close }) {
  const [f, setF] = useState({
    title: job.title || "",
    company: job.company || "",
    url: job.url || "",
    pay: job.pay || "",
    status: job.status && job.status !== "new" ? job.status : "applied",
    notes: job.notes || "",
  });
  const set = k => e => setF({ ...f, [k]: e && e.target ? e.target.value : e });
  const save = e => {
    e.preventDefault();
    const title = f.title.trim();
    if (!title) return;
    const url = f.url.trim();
    const doc = {
      title,
      company: f.company.trim(),
      url: /^https?:\/\//i.test(url) ? url : url ? "https://" + url : "",
      pay: f.pay.trim(),
      notes: f.notes.trim(),
    };
    if (job._id) {
      W.upd("jobs", job._id, doc);
      if (f.status !== st(job)) setStage(job, f.status);
    } else W.add("jobs", { ...doc, status: f.status, statusAt: new Date().toISOString(), posted: today() });
    close();
  };
  return html`<form class="ask" onSubmit=${save}>
    <label for="job-title">Role</label><${Field} id="job-title" required maxlength="120" placeholder="Frontend developer" value=${f.title} onInput=${set("title")}/>
    <label for="job-company">Company</label><${Field} id="job-company" maxlength="80" placeholder="Acme" value=${f.company} onInput=${set("company")}/>
    <label for="job-url">Link</label><${Field} id="job-url" maxlength="300" placeholder="https://" value=${f.url} onInput=${set("url")}/>
    <label for="job-pay">Pay</label><${Field} id="job-pay" maxlength="60" placeholder="$12/hr" value=${f.pay} onInput=${set("pay")}/>
    <label>Stage</label><${Select} opts=${STAGES} value=${f.status} onChange=${set("status")}/>
    <label for="job-notes">Notes</label><textarea id="job-notes" class="field" rows="3" maxlength="2000" placeholder="Who you talked to, the next step" value=${f.notes} onInput=${set("notes")}></textarea>
    <div class="askb">${
      job._id
        ? html`<${Btn} onClick=${() => {
            drop("jobs", job._id, "Job removed");
            close();
          }}>Delete<//>`
        : null
    }<span/><${Btn} onClick=${close}>Cancel<//><button type="submit" class="btn go">Save</button></div>
  </form>`;
}
export const editJob = job =>
  openSheet({ title: job ? "Edit job" : "Add a job", Body: JobForm, props: { job } });

function Job({ j, open, toggle }) {
  const feed = fromFeed(j),
    fit = Math.round(j.fit || 0),
    s = st(j),
    flags = (j.flags || []).filter(Boolean),
    a = age(j.posted || j.at),
    type = TYPES[j.type] || j.type || "";
  return html`<div class=${"item" + (open ? " open" : "") + (s === "skip" ? " gone" : "")}>
    <button class="row" aria-expanded=${String(open)} onClick=${toggle}>
      <span class="fit" aria-label=${feed ? "Fit " + fit + " out of 100" : null}>${feed ? fit : ""}</span>
      <span class="ttl">${j.title || "Untitled"}${j.company ? html`<span class="muted"> · ${j.company}</span>` : null}</span>
      <span class="rate">${j.pay || feed ? html`<span class=${"plate " + payTier(j)} title=${j.pay || ""}>${shortPay(j.pay)}</span>` : null}</span>
      <span class="c-type muted" data-age=${a ? "  ·  " + a : ""}>${feed ? type : LABEL[s]}</span><span class="c-age muted">${a}</span>
    </button>
    ${
      open
        ? html`<div class="detail">
      ${j.why ? html`<p>${j.why}</p>` : null}
      ${j.notes ? html`<p class="selectable jnote">${j.notes}</p>` : null}
      ${flags.length ? html`<p class="warn">${flags.map((f, i) => (i ? f : f.charAt(0).toUpperCase() + f.slice(1))).join(", ")}</p>` : null}
      <div class="acts">
        ${j.url ? html`<button class="btn ib go" title="Open job" onClick=${() => openExternal(j.url)}><${Icon} n="open"/>Open</button>` : null}
        <span class="jstage"><${Select} opts=${feed ? STATUS : STAGES} value=${s} onChange=${k => !meta.ro && setStage(j, k)}/></span>
        <button class="btn ib" title="Edit" aria-label="Edit job" disabled=${meta.ro} onClick=${() => editJob(j)}><${Icon} n="edit"/><span class="al">Edit</span></button>
      </div></div>`
        : null
    }
  </div>`;
}

function Jobs() {
  useCols("jobs");
  const [prefs, setPrefs] = usePref("os-prefs", { status: "new", sort: "fit" });
  const [q, setQ] = useState(""),
    [open, setOpen] = useState(null);
  const counts = Object.fromEntries(STATUS.map(([k]) => [k, D.jobs.filter(j => st(j) === k).length]));
  // New is the feed's inbox: without a feed (and nothing in it) the tracker starts at Saved
  const tabs = STATUS.filter(([k]) => k !== "new" || feedOn() || counts.new);
  const status = tabs.some(t => t[0] === prefs.status) ? prefs.status : tabs[0][0];
  const anyFit = D.jobs.some(fromFeed);
  const sort = prefs.sort === "fit" && !anyFit ? "new" : prefs.sort;
  const pr = j => ({ good: 3, mid: 2, low: 1, none: 0 })[payTier(j)],
    ql = q.trim().toLowerCase();
  const newest = (a, b) => String(b.posted || b.at || "").localeCompare(String(a.posted || a.at || ""));
  const rows = D.jobs
    .filter(
      j =>
        st(j) === status &&
        (!ql || [j.title, j.company, j.why, j.notes, j.pay, j.type].join(" ").toLowerCase().includes(ql)),
    )
    .sort(
      sort === "new"
        ? newest
        : sort === "pay"
          ? (a, b) => pr(b) - pr(a) || (b.fit || 0) - (a.fit || 0)
          : (a, b) => (b.fit || 0) - (a.fit || 0) || newest(a, b),
    );
  const th = (k, l) =>
    html`<button class="colh" aria-sort=${sort === k ? "descending" : false} onClick=${() => setPrefs({ ...prefs, sort: k })}>${l}</button>`;
  const SORTS = [...(anyFit ? [["fit", "Fit"]] : []), ["pay", "Rate"], ["new", "Newest"]];
  const sortBy = e =>
    actionSheet(
      "Sort jobs",
      SORTS.map(([k, l]) => [sort === k ? "applied" : "list", l, () => setPrefs({ ...prefs, sort: k })]),
      e.currentTarget,
    );
  const empty = ql
    ? "No jobs match."
    : status === "new"
      ? "No new jobs. Next search 6:45 AM."
      : D.jobs.length
        ? "Nothing here yet."
        : "Add the jobs you're going for, then move them through the stages.";
  return html`<${Tools}><${Field} w="w" type="search" id="q" placeholder="Search jobs" aria-label="Search jobs" value=${q} onInput=${e => setQ(e.target.value)}/>
    <button class="btn sortc" aria-label="Sort jobs" onClick=${sortBy}><${Icon} n="list"/>${(SORTS.find(s => s[0] === sort) || SORTS[0])[1]}</button>
    <span class="jadd"><${AddBtn} onClick=${() => editJob()}/></span><//>
    <${Tabs} items=${tabs} cur=${status} counts=${counts} onChange=${k => {
      setOpen(null);
      setPrefs({ ...prefs, status: k });
    }}/>
    <${Panel}><div class=${"list" + (anyFit ? "" : " nofitc")}>
      <div class="cols">${anyFit ? th("fit", "Fit") : null}<span class="colh static">Job</span>${th("pay", "Rate")}<span class="colh static">${anyFit ? "Type" : "Stage"}</span>${th("new", anyFit ? "Posted" : "Added")}</div>
      ${
        rows.length
          ? rows.map(
              j =>
                html`<${Job} key=${j._id} j=${j} open=${open === j._id} toggle=${() => setOpen(open === j._id ? null : j._id)}/>`,
            )
          : html`<div class="nil">${empty}</div>`
      }
    </div><//>
`;
}

export default {
  id: "jobs",
  opt: "jobs",
  name: "Jobs",
  title: "jobs",
  Comp: Jobs,
  tab: true,
  mod: false,
  cmd: (v, arg) => {
    if (v !== "job" && v !== "applied") return [];
    const o = parseLine(arg || "");
    if (!o.title) return [{ l: "job Role at Company · applied Role at Company", hint: true }];
    const status = v === "applied" ? "applied" : "saved";
    return [
      {
        icon: "jobs",
        l: (status === "applied" ? "Applied: " : "Job: ") + o.title + (o.company ? " · " + o.company : ""),
        r: () => {
          W.add("jobs", {
            ...o,
            pay: "",
            notes: "",
            status,
            statusAt: new Date().toISOString(),
            posted: today(),
          });
          openMod("jobs", true);
        },
      },
    ];
  },
  search: q =>
    D.jobs
      .filter(j => [j.title, j.company, j.why, j.notes].join(" ").toLowerCase().includes(q))
      .slice(0, 3)
      .map(j => ({
        icon: "jobs",
        l: "Job: " + (j.title || "") + (j.company ? " · " + j.company : ""),
        r: () => openMod("jobs", true),
      })),
};
