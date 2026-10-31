import { useState, useEffect } from "preact/hooks";
import { html, dkey, dayLabel, timeLabel } from "../core/lib.js";
import { api, aiBase, usage } from "../core/ai.js";
import { usePref } from "../core/pref.js";
import { findModel } from "../core/models.js";
import { openSheet } from "../ui/sheet.js";
import { Btn } from "../ui/index.js";
import { toast } from "../core/bus.js";
import { AI } from "../core/pack.js";

export const openChanges = (at, id) =>
  openSheet({ title: "Change the app", Body: AppChanges, props: { initial: id }, at });

// Short tag per status for the history list, and the step each status sits on.
const TAG = {
  working: "Drafting",
  ready: "Waiting for you",
  applied: "Live",
  rolled_back: "Undone",
  failed: "Stopped",
  no_change: "No changes",
  set_aside: "Set aside",
  discarded: "Discarded",
};
const STEP = {
  working: 1,
  failed: 1,
  no_change: 1,
  ready: 2,
  applied: 4,
  rolled_back: 4,
  set_aside: 4,
  discarded: 4,
};
/* the assistant's own name (editable in Theme editor > Assistant), read when drawn */
const STEPS = () => ["Ask", AI.name + " drafts", "Try it", "Apply"];
const when = at => {
  const d = new Date(at);
  return isNaN(d) ? "" : dayLabel(dkey(d)) + " " + timeLabel(d);
};

function Steps({ at, tried }) {
  const now = at === 2 && tried ? 3 : at;
  return html`<ol class="acsteps" aria-label="Progress">${STEPS().map((l, i) => html`<li key=${l} class=${i < now ? "done" : i === now ? "on" : ""} aria-current=${i === now ? "step" : null}><i>${i < now ? "✓" : i + 1}</i>${l}</li>`)}</ol>`;
}

// Drafts run on the home server, so only the server catalogue counts (no "This PC" models).
function ModelSelect({ u, value, onChange }) {
  const provs = ((u && u.providers) || []).filter(p => p.ready),
    d = findModel(provs, u && u.default);
  return html`<label class="acmodel">Model<select class="field" value=${value} onChange=${e => onChange(e.target.value)}>
    <option value="">Default${d ? " (" + d.m.label + ")" : ""}</option>
    ${provs.map(p => html`<optgroup key=${p.id} label=${p.label}>${p.models.map(m => html`<option key=${m.id} value=${m.id} disabled=${!!m.why}>${m.label}${m.why ? " · " + m.why : ""}</option>`)}</optgroup>`)}
  </select></label>`;
}

function AppChanges({ initial }) {
  const [u, setU] = useState(null),
    [pick, setPick] = usePref("os-chg-model", "");
  useEffect(() => {
    usage()
      .then(setU)
      .catch(() => {});
  }, []);
  // A remembered pick that left the catalogue or can't run now falls back to Default.
  const model = u && pick && (f => f && !f.m.why)(findModel(u.providers || [], pick)) ? pick : "";
  const [list, setList] = useState(null),
    [open, setOpen] = useState(initial || ""),
    [detail, setDetail] = useState(null);
  const [request, setRequest] = useState(""),
    [ready, setReady] = useState(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [tried, setTried] = useState({});
  const drafts = list || [];
  const current = open && drafts.find(x => x.id === open);
  const refresh = async () => {
    try {
      const result = await api("/api/change/list", {});
      setList(result.drafts);
      setReady(result.ready);
      setReason(result.reason || "");
    } catch (e) {
      setError(e.message);
      setList(l => l || []);
    }
  };
  useEffect(() => {
    refresh();
  }, []);
  // First load: jump straight to a draft that is running or waiting on the user.
  useEffect(() => {
    if (list && !open && !initial) {
      const live = list.find(x => x.status === "working" || x.status === "ready");
      if (live) setOpen(live.id);
    }
  }, [list === null]);
  const working = drafts.some(x => x.status === "working");
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [working]);
  useEffect(() => {
    setPreview(false);
    setDetail(null);
    if (current && current.status !== "working")
      api("/api/change/detail", { id: current.id })
        .then(setDetail)
        .catch(e => setError(e.message));
  }, [current && current.id, current && current.status]);
  const act = async (path, body) => {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, body);
      setOpen(result.id);
      await refresh();
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const create = async e => {
    e.preventDefault();
    if (!request.trim()) return;
    const result = await act("/api/change/create", { request: request.trim(), model });
    if (result) setRequest("");
  };
  const apply = async () => {
    const result = await act("/api/change/apply", { id: current.id, base: current.base });
    if (result) {
      setPreview(false);
      toast("Live. Your devices pick it up on their next open.");
    }
  };
  const rollback = async () => {
    const result = await act("/api/change/rollback", { id: current.id });
    if (result) toast("Previous version restored. Your data is unchanged.");
  };
  const discard = async () => {
    const result = await act("/api/change/discard", { id: current.id });
    if (result) {
      setPreview(false);
      toast("Draft discarded");
    }
  };
  const showPreview = () => {
    setTried(t => ({ ...t, [current.id]: 1 }));
    setPreview(true);
  };
  const retry = () => {
    setRequest(current.request);
    setOpen("");
  };
  const err = error ? html`<p class="acerror" role="alert">${error}</p>` : null;

  if (preview && current)
    return html`<div class="achange acpreviewmode">
    <div class="acbar"><${Btn} onClick=${() => setPreview(false)}>‹ Back<//><span class="acnote">Test copy · not saved</span>
      ${current.status === "ready" ? html`<${Btn} icon="trash" disabled=${busy} onClick=${discard}>Discard<//><${Btn} go disabled=${busy} onClick=${apply}>Apply to my app<//>` : null}</div>
    ${err}
    <iframe class="acpreview" title="App change preview" sandbox="allow-scripts" referrerPolicy="no-referrer" src=${aiBase() + current.preview}/>
  </div>`;

  if (current) {
    const s = current.status,
      d = detail || {};
    const head = {
      working: [AI.name + " is writing it", html`${current.step || "Starting"}… ${current.calls || 0}/6`],
      ready: [tried[current.id] ? "Happy with it?" : "Ready to try", ""],
      applied: ["Live in your app", ""],
      rolled_back: ["Undone", ""],
      discarded: ["Discarded", "Nothing was changed."],
      set_aside: [
        "Set aside by an update",
        current.error || "It no longer fits the new version. Ask for it again to redo it.",
      ],
      failed: ["Couldn't finish", "Nothing in your app changed."],
      no_change: ["Nothing to change", ""],
    }[s] || [s, ""];
    return html`<div class="achange">
      <div class="actop"><${Btn} onClick=${() => setOpen("")}>‹ All changes<//><small>${when(current.at)}</small></div>
      <${Steps} at=${STEP[s] ?? 1} tried=${tried[current.id]}/>
      <section class="acreview" aria-label="Review app change">
        <h3 class=${"achead" + (s === "working" ? " busy" : "")}>${head[0]}</h3>
        ${head[1] ? html`<p class="acnext" role=${s === "working" ? "status" : null}>${head[1]}</p>` : null}
        <div class="acask"><p class="acrequesttext">${current.request}</p></div>
        ${current.summary ? html`<p class="acsum">${current.summary}</p>` : null}
        ${current.error ? html`<p class="acerror" role="alert">${current.error}</p>` : null}
        ${err}
        <div class="acactions">
          ${s === "ready" ? html`<${Btn} go=${!tried[current.id]} onClick=${showPreview}>Try it<//><${Btn} go=${!!tried[current.id]} disabled=${busy} onClick=${apply}>Apply to my app<//><${Btn} icon="trash" disabled=${busy} onClick=${discard}>Discard<//>` : null}
          ${s === "applied" ? html`<${Btn} onClick=${showPreview}>Try it<//><${Btn} disabled=${busy} onClick=${rollback}>Undo this change<//>` : null}
          ${s === "failed" || s === "no_change" ? html`<${Btn} go onClick=${retry}>Ask again<//><${Btn} icon="trash" disabled=${busy} onClick=${discard}>Discard<//>` : null}
          ${s === "discarded" ? html`<${Btn} onClick=${retry}>Ask again<//>` : null}
        </div>
        ${
          s !== "working"
            ? html`<details class="acdiff"><summary>Details</summary>
          ${current.files.length ? html`<div class="acfiles">${current.files.map(p => html`<code key=${p}>${p}</code>`)}</div>` : null}
          <p class="acstats">${current.model ? current.model + " · " : ""}${current.calls || 0} model calls · ${(current.prompt || 0).toLocaleString()} in / ${(current.completion || 0).toLocaleString()} out tokens · ${current.prompt ? Math.round((100 * (current.cached || 0)) / current.prompt) : 0}% cached · $${(current.cost || 0).toFixed(4)}${current.commit ? " · commit " + current.commit.slice(0, 8) : ""}</p>
          ${d.diff ? html`<pre>${d.diff}</pre>` : null}
        </details>`
            : null
        }
      </section>
    </div>`;
  }

  const waiting = drafts.filter(x => x.status === "ready" || x.status === "working");
  return html`<div class="achange">
    ${ready === false ? html`<p class="acerror" role="status">${reason || "The app-change workspace is not installed on this server yet."}</p>` : null}
    <${Steps} at=${0}/>
    <form onSubmit=${create}>
      <label class="aclabel" for="app-change-request">What should change?</label>
      <textarea id="app-change-request" class="field acrequest" rows="3" maxLength="3000" value=${request} onInput=${e => setRequest(e.target.value)} onKeyDown=${e => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) create(e);
      }} placeholder="e.g. make the habit chips on Today bigger"/>
      <div class="acactions"><${ModelSelect} u=${u} value=${model} onChange=${setPick}/><button class="btn go" disabled=${ready !== true || busy || working || !request.trim()}>Make draft</button></div>
    </form>
    ${err}
    ${waiting.length ? html`<div class="acwait">${waiting.map(x => html`<button key=${x.id} type="button" class="acrow on" onClick=${() => setOpen(x.id)}><b>${TAG[x.status]}</b><span>${x.request}</span><em>Open ›</em></button>`)}</div>` : null}
    ${drafts.length > waiting.length ? html`<div class="aclabel">Earlier changes</div><div class="aclist">${drafts.filter(x => !waiting.includes(x)).map(x => html`<button key=${x.id} type="button" class="acrow" onClick=${() => setOpen(x.id)}><b>${TAG[x.status] || x.status}</b><span>${x.request}</span><em>${when(x.at)}</em></button>`)}</div>` : null}
  </div>`;
}
