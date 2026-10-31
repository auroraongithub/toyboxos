/* Osage-chan (id "buddy"): chat with a study assistant that can use the OS (core/ai.js), plus Sources, NotebookLM-style:
   links, PDFs, YouTube transcripts and pasted text that get indexed on the server so a chat can search them. */
import { render as prender } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { html, plural, openExternal } from "../core/lib.js";
import { ls, usePref } from "../core/pref.js";
import { useCols, D, W } from "../core/store.js";
import { toast } from "../core/bus.js";
import { render } from "../core/md.js";
import { saveFile } from "../core/files.js";
import { syncConfig } from "../core/sync.js";
import { Tools, Panel, StatusBar, Btn, Icon, AppIcon, Empty, Del } from "../ui/index.js";
import { actionSheet, askText, openSheet } from "../ui/sheet.js";
import { openMod, reg } from "../shell/os.js";
import { openChanges } from "./app-changes.js";
import { on as featOn } from "../core/features.js";
import {
  aiState,
  onAI,
  send,
  stop,
  chats,
  msgsOf,
  newChat,
  deleteChat,
  toolLabel,
  winLabel,
  usage,
  api,
  aiBase,
  rewind,
  retry,
  styleNotes,
  setStyleNotes,
  warmUp,
} from "../core/ai.js";
import {
  localModels,
  isLocal,
  localName,
  localLoaded,
  localStatus,
  localLoad,
  localUnload,
  localVision,
} from "../core/local-ai.js";
import { toolFailed } from "../core/ai-calls.js";
import { ART, AI } from "../core/pack.js";
/* the assistant's picture, or its app icon when the pack has none */
const Av = ({ c = "" }) =>
  ART.aiAvatar
    ? html`<img class=${c} src=${ART.aiAvatar} alt=""/>`
    : html`<span class=${"noav " + c} aria-hidden="true"><${AppIcon} id="buddy" n="buddy"/></span>`;
import { catalogue, findModel, modelSub, providerSub, usd } from "../core/models.js";

const useAI = () => {
  const [, t] = useState(0);
  useEffect(() => onAI(() => t(n => n + 1)), []);
  return aiState;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* "/" commands: prompts say "this" (whatever is mentioned, else the window you were in); the rest add things */
const CMDS = [
  ["summarise", "Summarise", "Summarise this for studying."],
  ["quiz", "Quiz me", "Quiz me on this, one question at a time."],
  ["cards", "Flashcards", "Make flashcards for the important parts of this and add them to the right page."],
  ["explain", "Explain simply", "Explain the hardest part of this simply, with one example."],
  ["plan", "Study plan", "Look at my deadlines and make a short study plan for this week."],
  ["link", "Add a link or YouTube video", null, "globe"],
  ["pdf", "Add a PDF", null, "notes"],
  ["text", "Add pasted text", null, "note"],
  ["image", "Attach an image", null, "attach"],
];
/* every window and hub tab from the registry, so new ones show up in @ without touching this list */
const WINS = () => {
  const seen = new Set(),
    out = [];
  for (const id of [...reg.ids, ...Object.keys(reg.alias)]) {
    const l = reg.names[id];
    if (!l || id === "buddy" || seen.has(l)) continue;
    seen.add(l);
    out.push([id, l]);
  }
  return [...out, ["timetable", "Class schedule"], ["budgets", "Budgets"]];
};
const RICON = { win: "today", page: "notes", board: "whiteboard", src: "sources" };
const low = s => String(s || "").toLowerCase();
/* the window you were last in, as a mention (Notes means the page that's open there) */
function refFor(w) {
  const sub = w === "notes" ? ls.get("os-sub-notes", "notes") : w;
  if (sub === "whiteboard") {
    const b = D.boards.find(x => x._id === ls.get("os-wb", "")) || D.boards[0];
    return b ? { k: "board", id: b._id, l: b.title } : { k: "win", id: "whiteboard", l: "Whiteboard" };
  }
  if (sub === "notes") {
    const p = D.pages.find(x => x._id === ls.get("os-page", ""));
    return p ? { k: "page", id: p._id, l: p.title } : { k: "win", id: "notes", l: "Notes" };
  }
  return { k: "win", id: sub, l: winLabel(sub) };
}
function mentions(q) {
  q = low(q).trim();
  const hit = t => !q || low(t).includes(q),
    rank = t => (low(t).startsWith(q) ? 0 : 1),
    out = [];
  WINS().forEach(([id, l]) => {
    if (hit(l)) out.push({ k: "win", id, l, sub: "window" });
  });
  const ps = D.pages.slice().sort((a, b) => String(b.upd || b.at).localeCompare(String(a.upd || a.at)));
  ps.forEach(p => {
    if (hit(p.title)) {
      const par = D.pages.find(x => x._id === p.parent);
      out.push({
        k: "page",
        id: p._id,
        l: p.title,
        sub: par ? par.title : p.kind === "subject" ? "subject" : "page",
        ic: p.icon,
      });
    }
  });
  D.boards.forEach(b => {
    if (hit(b.title)) out.push({ k: "board", id: b._id, l: b.title, sub: "board" });
  });
  D.sources.forEach(x => {
    if (hit(x.title)) out.push({ k: "src", id: x._id, l: x.title, sub: "source · " + x.kind });
  });
  return (q ? out.sort((a, b) => rank(a.l) - rank(b.l)) : out).slice(0, 8);
}

/* ---------- messages ---------- */
function onMdClick(e) {
  const a = e.target.closest("a");
  if (!a) return;
  if (a.dataset.wiki) {
    e.preventDefault();
    const p = D.pages.find(x => x.title.toLowerCase() === a.dataset.wiki.toLowerCase());
    if (p) import("./pages.js").then(m => m.openPage(p._id));
    return;
  }
  if (/^https?:/.test(a.getAttribute("href") || "")) {
    e.preventDefault();
    openExternal(a.href);
  }
}
/* ```graph and ```cards in a reply become a live graph / flip cards */
const Md = ({ t }) => {
  const ref = useRef(),
    h = useMemo(() => render(t), [t]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll(".cbk").forEach(n => {
      if (n.dataset.on === n.dataset.src) return;
      n.dataset.on = n.dataset.src;
      import("./chatblocks.js").then(m => {
        const C = n.dataset.k === "graph" ? m.ChatGraph : m.ChatCards;
        n.textContent = "";
        prender(html`<${C} src=${n.dataset.src}/>`, n);
      });
    });
  }, [h]);
  return html`<div class="md bmd" ref=${ref} onClick=${onMdClick} dangerouslySetInnerHTML=${{ __html: h }}/>`;
};

/* Edit / Copy / Undo under his messages, Copy / Retry under hers: shown on hover, or after a tap on phones */
const copy = t =>
  navigator.clipboard.writeText(t).then(
    () => toast("Copied"),
    () => toast("Couldn't copy"),
  );
const tapped = e => !String(getSelection()).trim() && !e.target.closest("a,button,summary,details");
function Acts({ items }) {
  return html`<div class="bacts">${items.map(([l, f, tip]) => html`<button class="bact" title=${tip || l} onClick=${f}>${l}</button>`)}</div>`;
}

function Msg({ m, chat, on, tap, busy, results, last }) {
  const [showTps] = usePref("os-ai-tps", true);
  if (m.r === "user")
    return html`<div class=${"bw mine" + (on ? " on" : "")}>
    <div class="bm bu" onClick=${e => tapped(e) && tap(m._id)}>${(m.refs || (m.ctxw ? [{ k: "win", l: winLabel(m.ctxw) }] : [])).map(r => html`<span class="bctx"><${Icon} n=${RICON[r.k] || "attach"}/>${r.l}</span>`)}
    ${(m.img || []).length ? html`<span class="bctx"><${Icon} n="attach"/>${plural(m.img.length, "image")}</span>` : null}<div class="bt">${m.t}</div></div>
    ${
      busy
        ? null
        : html`<${Acts} items=${[
            [
              "Edit",
              () => {
                rewind(chat, m._id);
                dispatchEvent(
                  new CustomEvent("os-ai-draft", {
                    detail: { t: m.t, refs: m.refs || [], img: m.img || [] },
                  }),
                );
              },
              "Edit and send again",
            ],
            ["Copy", () => copy(m.t)],
            ["Undo", () => rewind(chat, m._id), "Remove this message and everything after it"],
          ]}/>`
    }</div>`;
  if (m.r === "assistant")
    return html`${
      m.t
        ? html`<div class=${"bw" + (on ? " on" : "")}><div class="bm ba" onClick=${e => tapped(e) && tap(m._id)}><${Av} c="bav"/><div class="bcol"><${Md} t=${m.t}/>
      ${showTps && m.tps ? html`<div class="btps" title="Tokens per second">${m.tps} t/s</div>` : null}
      ${
        (m.cites || []).length
          ? html`<details class="bcite"><summary><${Icon} n="globe"/>${plural(m.cites.length, "source")}</summary>
        ${m.cites.map(
          ([t, u]) =>
            html`<a href=${u} onClick=${e => {
              e.preventDefault();
              openExternal(u);
            }} title=${u}>${t}<em>${u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</em></a>`,
        )}</details>`
          : null
      }</div></div>
      ${
        busy || ((m.ask || []).length && last)
          ? null
          : html`<${Acts} items=${[
              ["Copy", () => copy(m.t)],
              ["Retry", () => retry(chat, m._id), "Ask again for a new answer"],
            ]}/>`
      }</div>`
        : null
    }
    ${(m.ask || []).length && last && !busy ? html`<div class="bchoice" role="group" aria-label="Pick one">${m.ask.map(o => html`<${Btn} onClick=${() => send(chat, o)}>${o}<//>`)}<span class="bchor">or type your own</span></div>` : null}
    ${(m.tc || [])
      .filter(c => c.n !== "ask")
      .map(c => {
        let a = {};
        try {
          a = JSON.parse(c.a);
        } catch {
          // bad arguments from the model: shown without them
        }
        const result = results.get(c.id),
          failed = toolFailed(result);
        let label = toolLabel(c.n, a);
        if (c.n === "apply_changes" && result && !failed) {
          try {
            const saved = JSON.parse(result.t);
            if (typeof saved.changed === "number")
              label = saved.changed ? "Saved " + saved.changed + " changes" : "No changes needed";
          } catch (e) {
            if (/ said no./.test(result.t)) label = "Cancelled";
          }
        }
        return html`<div class=${"bstep" + (failed ? " berr" : "")} key=${c.id}><${Icon} n=${c.n === "search" ? "search" : c.n === "read_url" || c.n === "web_search" ? "globe" : "buddy"}/><span>${failed ? "Failed: " + label : label}${failed ? html`<br/><span class="mini selectable">${result.t.replace(/^Failed:\s*/, "")}</span>` : null}</span></div>`;
      })}`;
  return null;
}

/* phones: the message list takes exactly the room left between the toolbar and the composer + tab bar (keyboard included) */
function useFit(ref) {
  useEffect(() => {
    if (!matchMedia("(max-width:860px)").matches) return;
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const w = el.closest(".win");
      if (!w) return;
      const vh = window.visualViewport ? visualViewport.height : innerHeight,
        tb = document.querySelector(".tabbar"),
        tbh =
          tb && getComputedStyle(tb).display !== "none" && !document.body.hasAttribute("data-typing")
            ? tb.offsetHeight
            : 0;
      const below =
        [".bcomp", ".statusbar"].reduce((a, q) => {
          const x = w.querySelector(q);
          return a + (x ? x.offsetHeight : 0);
        }, 0) + tbh;
      el.style.height = Math.max(160, vh - el.getBoundingClientRect().top - below - 2) + "px";
    };
    window.scrollTo(0, 0);
    fit();
    const t = setTimeout(fit, 120);
    const ro = new ResizeObserver(fit);
    const w = ref.current && ref.current.closest(".win");
    if (w) {
      ro.observe(w);
      const cp = w.querySelector(".bcomp");
      if (cp) ro.observe(cp);
    }
    addEventListener("resize", fit);
    if (window.visualViewport) visualViewport.addEventListener("resize", fit);
    const mo = new MutationObserver(fit);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-typing"] });
    return () => {
      clearTimeout(t);
      ro.disconnect();
      mo.disconnect();
      removeEventListener("resize", fit);
      if (window.visualViewport) visualViewport.removeEventListener("resize", fit);
    };
  }, []);
}
function Thread({ chat }) {
  const st = useAI(),
    box = useRef(),
    ms = msgsOf(chat._id),
    [on, setOn] = useState("");
  const results = new Map(ms.filter(m => m.r === "tool").map(m => [m.ti, m]));
  const live = st.busy && st.chat === chat._id;
  useFit(box);
  useEffect(() => {
    const b = box.current;
    if (b) b.scrollTop = b.scrollHeight;
  }, [ms.length, st.live, st.step, st.ask]);
  return html`<div class="bthread" ref=${box}>
    ${chat.sum && chat.cut ? html`<div class="bstep bfold">Older messages are summarised to keep this chat cheap.</div>` : null}
    ${ms.map(m => html`<${Msg} key=${m._id} m=${m} chat=${chat._id} on=${on === m._id} tap=${id => setOn(x => (x === id ? "" : id))} busy=${st.busy} results=${results} last=${m === ms[ms.length - 1]}/>`)}
    ${live && st.live ? html`<div class="bm ba"><${Av} c="bav"/><${Md} t=${st.live}/></div>` : null}
    ${live && !st.live && !st.ask ? html`<div class="bstep bwork"><i/>${st.step || "Thinking"}…</div>` : null}
    ${
      live && st.ask
        ? html`<div class="bask" role="group" aria-label=${AI.name + " asks first"}>
      <b>${st.ask.title}?</b><pre class="selectable">${st.ask.detail}</pre>
      <div class="babt"><${Btn} go onClick=${() => st.ask.done(true)}>Allow<//><${Btn} onClick=${() => st.ask.done(false)}>Deny<//></div></div>`
        : null
    }
    ${st.err && st.chat === chat._id && !st.busy ? html`<div class="bstep berr">${st.err}</div>` : null}
  </div>`;
}

/* ---------- composer ---------- */
function Composer({ chat }) {
  const st = useAI();
  const [t, setT] = useState(""),
    [refs, setRefs] = useState([]),
    [img, setImg] = useState([]),
    [pk, setPk] = useState(null),
    [cmd, setCmd] = useState(false);
  const ta = useRef(),
    fi = useRef(),
    pf = useRef();
  const add = r => setRefs(x => (x.some(y => y.k === r.k && y.id === r.id) ? x : [...x, r]));
  const loadDraft = d => {
    setT(d.t || "");
    setRefs(d.refs || []);
    setImg(d.img || []);
    setTimeout(() => {
      const el = ta.current;
      if (el) {
        el.value = d.t || "";
        grow(el);
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 30);
  };
  const [draft, setDraft] = usePref("os-ai-draft", null);
  useEffect(() => {
    if (draft) {
      loadDraft(draft);
      setDraft(null);
    }
  }, [draft]);
  /* "Ask about this" on a window title bar hands its window over */
  const [ask, setAsk] = usePref("os-ai-ask", "");
  useEffect(() => {
    if (ask) {
      add(refFor(ask));
      setAsk("");
      setTimeout(() => ta.current && ta.current.focus(), 50);
    }
  }, [ask]);
  const sug = refFor(ls.get("os-ai-last", "today"));
  /* Edit on a sent message puts it back here */
  useEffect(() => {
    const f = e => loadDraft(e.detail || {});
    addEventListener("os-ai-draft", f);
    return () => removeEventListener("os-ai-draft", f);
  }, []);
  const go = text => {
    text = String(text || "").trim();
    if (!text || st.busy) return;
    send(chat._id || newChat(), text, { refs: refs.length ? refs : cmd ? [sug] : [], img });
    setT("");
    setRefs([]);
    setImg([]);
    setCmd(false);
    setPk(null);
    if (ta.current) {
      ta.current.value = "";
      ta.current.style.height = "";
    }
  };
  /* pressing Send must not blur the box: on phones the keyboard would drop and the layout jump mid-tap */
  const keep = e => {
    if (document.activeElement === ta.current) e.preventDefault();
  };
  const grow = el => {
    el.style.height = "";
    el.style.height = Math.min(160, Math.max(el.clientHeight, el.scrollHeight)) + "px";
  };
  /* @ and / pickers read the token right before the caret */
  const scan = el => {
    const v = el.value.slice(0, el.selectionStart);
    let m = v.match(/(^|\s)\/(\S*)$/);
    if (m) {
      const q = low(m[2]),
        it = CMDS.filter(c => c[0].startsWith(q) || low(c[1]).includes(q));
      setPk(it.length ? { c: "/", at: v.length - m[2].length - 1, it, i: 0 } : null);
      return;
    }
    m = v.match(/(^|\s)@([^@\n]{0,30})$/);
    if (m) {
      const it = mentions(m[2]);
      setPk(it.length ? { c: "@", at: v.length - m[2].length - 1, it, i: 0 } : null);
      return;
    }
    setPk(null);
  };
  const cut = (el, ins = "") => {
    const v = el.value,
      nv = v.slice(0, pk.at) + ins + v.slice(el.selectionStart);
    el.value = nv;
    setT(nv);
    const c = pk.at + ins.length;
    el.setSelectionRange(c, c);
    grow(el);
    setPk(null);
  };
  const extra = k => {
    if (k === "image") return fi.current.click();
    if (k === "pdf") return pf.current.click();
    if (k === "link")
      return askText({
        title: "Add a link",
        placeholder: "Article, YouTube video or PDF URL",
        ok: "Add",
      }).then(async v => {
        v = (v || "").trim();
        if (!v) return;
        const id = await addSource(
          { kind: "url", url: v },
          v.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40),
        );
        if (id) add(srcRef(id));
      });
    if (k === "text")
      return askText({
        title: "Paste text",
        multi: true,
        placeholder: "Lecture notes, an article, a transcript…",
        ok: "Add",
      }).then(async v => {
        if (!v || !v.trim()) return;
        const title = await askText({
          title: "Name it",
          value: v.trim().split("\n")[0].slice(0, 60),
          ok: "Add",
        });
        if (title === null) return;
        const id = await addSource({ kind: "text", text: v, title }, title);
        if (id) add(srcRef(id));
      });
  };
  const choose = it => {
    const el = ta.current;
    if (!el || !pk) return;
    if (pk.c === "@") {
      cut(el);
      add({ k: it.k, id: it.id, l: it.l });
    } else if (it[2]) {
      cut(el, it[2]);
      setCmd(true);
    } else {
      cut(el);
      extra(it[0]);
    }
    el.focus();
  };
  const attach = e =>
    actionSheet(
      "Attach",
      [
        ["attach", "Image", () => extra("image")],
        ["notes", "PDF", () => extra("pdf")],
        ["globe", "Link or YouTube", () => extra("link")],
        ["note", "Pasted text", () => extra("text")],
        "-",
        [
          "sources",
          "Sources library",
          () => openSheet({ title: "Sources", Body: SourceLib, props: { onPick: add } }),
        ],
      ],
      e.currentTarget,
    );
  const attachImage = async f => {
    if (!/^image\//.test(f.type)) {
      toast("Images only");
      return;
    }
    try {
      const id = await saveFile(f, f.name);
      setImg(x => [...x, "sos:" + id]);
    } catch (e) {
      toast("Couldn't attach the image");
    }
  };
  const pickImg = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) await attachImage(f);
  };
  const paste = e => {
    const item = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) attachImage(file);
    }
  };
  const pickPdf = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const id = await addPdf(f);
    if (id) add(srcRef(id));
  };
  const key = e => {
    if (pk) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = pk.it.length;
        setPk({ ...pk, i: (pk.i + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(pk.it[pk.i]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPk(null);
        return;
      }
    }
    if (
      e.key === "Backspace" &&
      e.target.selectionStart === 0 &&
      e.target.selectionEnd === 0 &&
      (refs.length || img.length)
    ) {
      e.preventDefault();
      if (img.length) setImg(x => x.slice(0, -1));
      else setRefs(x => x.slice(0, -1));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer:coarse)").matches) {
      e.preventDefault();
      go(e.target.value);
    }
  };
  const busy = st.busy && st.chat === chat._id;
  const opt = (i, body, it) =>
    html`<button role="option" aria-selected=${String(i === pk.i)} class=${"bpi" + (i === pk.i ? " on" : "")} onPointerDown=${e => e.preventDefault()} onClick=${() => choose(it)}>${body}</button>`;
  return html`<div class="bcomp">
    ${
      pk
        ? html`<div class="bpk" role="listbox">${pk.it.map((it, i) =>
            pk.c === "@"
              ? opt(
                  i,
                  html`${it.ic && !/^[a-z]/.test(it.ic) ? html`<span class="bpe">${it.ic}</span>` : html`<${Icon} n=${RICON[it.k]}/>`}<span>${it.l}</span><em>${it.sub}</em>`,
                  it,
                )
              : opt(i, html`<${Icon} n=${it[3] || "buddy"}/><span>${it[1]}</span><em>/${it[0]}</em>`, it),
          )}</div>`
        : null
    }
    ${
      refs.length || img.length
        ? html`<div class="brefs" aria-label="Attached to this message"><small>About</small>
      ${refs.map(r => html`<span class="bref" key=${r.k + r.id}><${Icon} n=${RICON[r.k]}/><span>${r.l}</span><button class="bx" aria-label=${"Remove " + r.l} onPointerDown=${keep} onClick=${() => setRefs(x => x.filter(y => y !== r))}>×</button></span>`)}
      ${img.map(r => html`<span class="bref" key=${r}><${Icon} n="attach"/><span>image</span><button class="bx" aria-label="Remove image" onPointerDown=${keep} onClick=${() => setImg(x => x.filter(y => y !== r))}>×</button></span>`)}</div>`
        : null
    }
    <div class="brow">
      <button class="btn bico" aria-label="Attach" title="Attach an image, PDF, link or text" onPointerDown=${keep} onClick=${attach}><${Icon} n="attach"/></button>
      <input ref=${fi} type="file" accept="image/*" hidden onChange=${pickImg}/><input ref=${pf} type="file" accept="application/pdf" hidden onChange=${pickPdf}/>
      <div class="field bbox" onClick=${e => {
        if (e.target === e.currentTarget) ta.current.focus();
      }}>
        ${!refs.length && !img.length && !t ? html`<button class="bref sug" title="Send this along with your message" onPointerDown=${keep} onClick=${() => add(sug)}>+ ${sug.l}</button>` : null}
        <textarea ref=${ta} class="bin" rows="1" placeholder=${refs.length ? "Ask about this…" : "Message " + AI.name} value=${t} aria-label=${"Message " + AI.name}
          onInput=${e => {
            setT(e.target.value);
            grow(e.target);
            scan(e.target);
            if (e.target.value) warmUp();
          }} onPaste=${paste} onKeyDown=${key} onClick=${e => scan(e.target)} onBlur=${() => setTimeout(() => setPk(null), 150)}/>
      </div>
      ${
        busy
          ? html`<button class="btn bico" aria-label="Stop" title="Stop" onPointerDown=${keep} onClick=${stop}><span class="bsq"/></button>`
          : html`<button class="btn go bico" aria-label="Send" title="Send" onPointerDown=${keep} onClick=${() => go(ta.current ? ta.current.value : t)}><${Icon} n="send"/></button>`
      }
    </div></div>`;
}

/* phones: Osage is a full-screen chat over the app; this goes back to the screen you came from */
const AiBack = () =>
  html`<${Btn} cls="aiback" icon="back" aria-label="Back" onClick=${() => openMod(ls.get("os-ai-last", "today"), true)}/>`;

/* ---------- chat part ---------- */
function Chat() {
  useCols("chats", "amsg", "sources", "pages");
  const st = useAI();
  const [cid, setCid] = usePref("os-ai-chat", "");
  const [web, setWeb] = usePref("os-ai-web", true);
  const [model, setModel] = usePref("os-ai-model", "");
  const [tps, setTps] = usePref("os-ai-tps", true);
  const [u, setU] = useState(null);
  const [loc, setLoc] = useState(null); // loc = models running on this machine (null = still looking)
  useEffect(() => {
    if (aiBase())
      usage()
        .then(setU)
        .catch(e => setU({ err: e.message }));
  }, [st.month, st.day]);
  useEffect(() => {
    const f = () => {
      if (aiBase())
        usage()
          .then(setU)
          .catch(() => {});
    };
    addEventListener("os-ai-set", f);
    return () => removeEventListener("os-ai-set", f);
  }, []);
  const [up, setUp] = useState(null); // the local model helper's {loaded,loading}, polled while a local model is selected
  useEffect(() => {
    let on = true;
    const look = () => localModels(true).then(r => on && setLoc(r.models));
    look();
    addEventListener("focus", look);
    return () => {
      on = false;
      removeEventListener("focus", look);
    };
  }, []);
  const lt = (loc || []).includes(model) ? model : !aiBase() ? (loc || [])[0] || "" : ""; // the local model in use, if any
  useEffect(() => {
    if (!lt) {
      setUp(null);
      return;
    }
    let on = true;
    const poll = () => localStatus(lt).then(r => on && setUp(r));
    poll();
    const t = setInterval(poll, st.busy ? 1500 : 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [lt, st.busy]);
  const list = chats();
  let chat = list.find(c => c._id === cid);
  if (!aiBase() && loc === null) return null;
  if (!aiBase() && !loc.length)
    return html`<div class="aioffbar"><${AiBack}/></div><div class="ai-off"><${Av}/><p>${AI.name} talks through your server, so this device needs Sync first. Or start a model on this PC: <code class="selectable">python server/local-ai/local_ai.py start</code></p><${Btn} go icon="sync" onClick=${() => openMod("sync", true)}>Set up Sync<//></div>`;
  if (!chat && list.length) chat = list[0];
  const pick = e =>
    actionSheet(
      "Chats",
      [
        ["plus", "New chat", () => setCid(newChat())],
        "-",
        ...list.slice(0, 25).map(c => [
          c._id === (chat && chat._id) ? "applied" : "buddy",
          c.title,
          () => setCid(c._id),
          {
            menu: [
              [
                "trash",
                "Delete chat",
                () => {
                  deleteChat(c._id);
                  if (c._id === cid) setCid("");
                },
                { danger: true },
              ],
            ],
          },
        ]),
      ],
      e.currentTarget,
    );
  // the model in use and what the status line says about it: cost or free allowance, and how full the chat's context is
  const cat = catalogue(u, loc);
  const mine = (loc || []).includes(model) ? model : ""; // a chosen local model that is no longer running falls back to the server's
  const cur =
    mine ||
    (aiBase()
      ? model && !isLocal(model)
        ? model
        : st.model && !isLocal(st.model)
          ? st.model
          : u && u.active
      : (loc || [])[0]);
  const hit = findModel(cat, cur),
    label = hit ? hit.m.label : (cur || "").replace(/^.*[/:]/, ""),
    live = st.model === cur; // the last reply's numbers are fresher
  const kk = n => (n >= 1000 ? Math.round(n / 1000) + "k" : String(n));
  const ctxm =
    hit && hit.m.context && chat && chat.cmax && chat.ctx
      ? "context " +
        kk(chat.ctx) +
        " / " +
        kk(chat.cmax) +
        " (" +
        Math.round((chat.ctx / chat.cmax) * 100) +
        "%)"
      : "";
  const cost = !hit
    ? ""
    : hit.p.local
      ? up
        ? up.loading
          ? "loading…"
          : up.loaded
            ? up.ram
              ? up.ram >= 1024
                ? (up.ram / 1024).toFixed(1) + " GB"
                : up.ram + " MB"
              : "loaded"
            : "idle"
        : ""
      : hit.m.free_day
        ? (live && st.day != null ? st.day : hit.m.used || 0) + " of " + hit.m.free_day + " free today"
        : hit.p.cap != null
          ? usd(live && st.month != null ? st.month : hit.p.spent || 0) +
            " of " +
            usd(hit.p.cap) +
            " this month"
          : "";
  const meta =
    u && u.err
      ? u.err
      : aiBase() && u && !u.ready && !(loc || []).length
        ? "No AI key on the server yet"
        : [label, cost, ctxm].filter(Boolean).join(" · ");
  const menu = async e => {
    const at = e.currentTarget;
    const lo = isLocal(cur) ? await localLoaded(cur) : null;
    actionSheet(
      AI.name,
      [
        [
          "models",
          "Model",
          () =>
            openSheet({
              title: "Model",
              Body: ModelPicker,
              props: { cat, cur: model || "", def: u && u.default, onPick: setModel },
              at,
            }),
          { sub: [label, cost].filter(Boolean).join(" · ") },
        ],
        ...(ctxm
          ? [
              [
                "meter",
                "Context",
                () => {},
                { sub: ctxm.replace(/^context /, "") + (chat.cmax ? " · compacts at 80%" : "") },
              ],
            ]
          : []), // phones have no status bar, so the meter lives here too
        "-",
        [web ? "applied" : "globe", "Web search", () => setWeb(!web), { sub: web ? "on" : "off" }],
        [
          tps ? "applied" : "clock",
          "Tokens per second",
          () => setTps(!tps),
          { sub: tps ? "shown" : "hidden" },
        ],
        ...(isLocal(cur) && up && up.canVision
          ? [
              [
                up.vision ? "applied" : "image",
                "Vision",
                () => {
                  localVision(cur, !up.vision)
                    .then(() => localStatus(cur))
                    .then(setUp);
                  toast(up.vision ? "Vision off" : "Vision on: loads with the next message");
                },
                { sub: up.vision ? "on (+0.8 GB)" : "off" },
              ],
            ]
          : []),
        ...(isLocal(cur)
          ? [
              lo
                ? [
                    "trash",
                    "Unload " + localName(lo),
                    () => {
                      localUnload(cur)
                        .then(() => localStatus(cur))
                        .then(setUp);
                      toast("Unloaded");
                    },
                    { sub: "frees VRAM" },
                  ]
                : [
                    "buddy",
                    "Load " + localName(cur) + " now",
                    () => {
                      setUp({ loaded: null, loading: true });
                      localLoad(cur)
                        .then(() => localStatus(cur))
                        .then(setUp);
                    },
                  ],
            ]
          : []),
        "-",
        [
          "note",
          "Your rules",
          () =>
            askText({
              title: "Your rules for " + AI.name,
              multi: true,
              value: styleNotes(),
              placeholder: "One per line, e.g. keep answers short",
              ok: "Save",
            }).then(v => {
              if (v !== null) {
                setStyleNotes(v);
                toast("Saved");
              }
            }),
        ],
        ["key", "Models and keys", () => openMod("models", true)],
        ["sources", "Sources library", () => openSheet({ title: "Sources", Body: SourceLib })],
        featOn("changes") ? ["code", "Change the app…", () => openChanges(at)] : null,
        ...(chat
          ? [
              "-",
              [
                "edit",
                "Rename chat",
                () =>
                  askText({ title: "Rename chat", value: chat.title, ok: "Save" }).then(v => {
                    if (v && v.trim()) W.upd("chats", chat._id, { title: v.trim() });
                  }),
              ],
              [
                "trash",
                "Delete this chat",
                () => {
                  deleteChat(chat._id);
                  setCid("");
                },
                { danger: true },
              ],
            ]
          : []),
      ],
      at,
    );
  };
  const srcs = chat ? (chat.src || []).map(id => D.sources.find(s => s._id === id)).filter(Boolean) : [];
  return html`<${Tools} cls="btools"><${AiBack}/>
      <button class="btn bpick" onClick=${pick} aria-label="Switch chat"><${Icon} n="buddy"/><span>${chat ? chat.title : "New chat"}</span><${Icon} n="chev"/></button>
      <${Btn} icon="plus" aria-label="New chat" title="New chat" onClick=${() => setCid(newChat())}/>
      <${Btn} icon="more" cls=${"bmore" + (isLocal(cur) && up ? (up.loading ? " ld" : up.loaded ? " up" : "") : "")} aria-label="Buddy settings" title="Model and web search" onClick=${menu}/><//>
    ${srcs.length ? html`<div class="bsrcs">${srcs.map(s => html`<span class="bchip on" key=${s._id}><${Icon} n="sources"/>${s.title}<button class="bx" aria-label=${"Stop using " + s.title} onClick=${() => W.upd("chats", chat._id, { src: chat.src.filter(x => x !== s._id) })}>×</button></span>`)}</div>` : null}
    <${Panel} cls="bpanel">${chat && msgsOf(chat._id).length ? html`<${Thread} chat=${chat}/>` : html`<div class="bthread bempty"><${Av} c="bhero"/><b>${AI.hero || AI.name}</b><p>${AI.intro}</p></div>`}<//>
    <${Composer} key=${chat ? chat._id : "none"} chat=${chat || { _id: "", src: [] }}/>
    <${StatusBar} items=${[meta, isLocal(cur) ? null : web ? "web on" : "web off"]}/>`;
}
const _send = send;

/* the model picker: each provider that can run (or this PC) with its models, what they cost and why one can't run right now;
   providers without a key collapse into one line so the list stays short */
function ModelPicker({ cat, cur, def, onPick, close }) {
  const pick = id => {
      close();
      onPick(id);
    },
    on = cat.filter(p => p.local || p.ready),
    off = cat.filter(p => !p.local && !p.ready),
    d = findModel(cat, def);
  return html`<div class="acts mpick">
    <button class=${"mi" + (!cur ? " on" : "")} onClick=${() => pick("")}>${!cur ? html`<${Icon} n="applied"/>` : html`<i class="ic mi0"/>`}<span>Default<small>${d ? d.m.label : "the server's choice"} · next free model when busy</small></span></button>
    ${on.map(
      p => html`<div class="mph" key=${p.id}><b>${p.label}</b><span>${providerSub(p)}</span></div>
      ${p.models.map(m => html`<button key=${m.id} class=${"mi" + (m.id === cur ? " on" : "")} disabled=${!!m.why} onClick=${() => pick(m.id)}>${m.id === cur ? html`<${Icon} n="applied"/>` : html`<i class="ic mi0"/>`}<span>${m.label}<small>${modelSub(p, m)}</small></span></button>`)}`,
    )}
    ${off.length ? html`<div class="mnot">No key yet: ${off.map(p => p.label).join(", ")}.</div>` : null}
    <button class="mi" onClick=${() => {
      close();
      openMod("models", true);
    }}><${Icon} n="key"/><span>${on.some(p => !p.local) ? "Models and keys…" : "Set up a model…"}<small>add a provider, paste a key, pick models</small></span></button>
  </div>`;
}

/* ---------- sources ---------- */
async function putFile(f) {
  const c = syncConfig(),
    id = uid() + uid();
  const r = await fetch(aiBase() + "/api/file/" + id, {
    method: "PUT",
    headers: { Authorization: "Bearer " + c.token, "Content-Type": f.type || "application/pdf" },
    body: f,
  });
  if (!r.ok)
    throw new Error(r.status === 413 ? "That PDF is over 15 MB." : "Upload failed (" + r.status + ")");
  return id;
}
async function addSource(body, label) {
  const id = uid();
  toast("Reading " + label + "…");
  try {
    const r = await api("/api/src", { id, ...body });
    W.set("sources", id, {
      title: r.title,
      kind: r.kind,
      url: r.url || "",
      chars: r.chars,
      n: r.n,
      at: new Date().toISOString(),
    });
    toast("Added " + r.title);
    return id;
  } catch (e) {
    toast(e.message);
    return null;
  }
}
export async function addPdf(f) {
  try {
    const fid = await putFile(f);
    return addSource({ kind: "file", file: fid, title: f.name.replace(/\.pdf$/i, "") }, f.name);
  } catch (e) {
    toast(e.message);
    return null;
  }
}
const KIND = { pdf: "notes", video: "pomodoro", url: "globe", text: "note" };
const srcRef = id => {
  const x = D.sources.find(s => s._id === id);
  return { k: "src", id, l: x ? x.title : "source" };
};
/* everything ever added: pick one to mention it (or chat about it), or delete it */
function SourceLib({ onPick, close }) {
  useCols("sources", "chats");
  const list = D.sources.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const del = s => {
    W.del("sources", s._id);
    api("/api/src/del", { id: s._id }).catch(() => {});
    D.chats
      .filter(c => (c.src || []).includes(s._id))
      .forEach(c => W.upd("chats", c._id, { src: c.src.filter(x => x !== s._id) }));
    toast("Removed " + s.title);
  };
  const use = s => {
    close();
    if (onPick) onPick(srcRef(s._id));
    else {
      newChat({ title: s.title, src: [s._id] });
      openMod("buddy", true);
    }
  };
  return html`<div class="ll bslib">${
    list.length
      ? list.map(
          s => html`<div class="lr bsr" key=${s._id}>
      <${Icon} n=${KIND[s.kind] || "note"}/><button class="tt bst" title=${s.url || s.title} onClick=${() => use(s)}>${s.title}</button>
      <span class="when">${s.kind} · ${Math.round((s.chars || 0) / 1000)}k</span><${Del} onClick=${() => del(s)}/></div>`,
        )
      : html`<${Empty}>Nothing yet. Attach a PDF, a link, a YouTube video or pasted text in a chat.<//>`
  }</div>`;
}

export default {
  id: "buddy",
  opt: "ai",
  name: AI.name,
  title: AI.name.toLowerCase(),
  Comp: Chat,
  search: q =>
    D.chats
      .filter(c => String(c.title).toLowerCase().includes(q))
      .slice(0, 3)
      .map(c => ({
        icon: "buddy",
        l: "Chat: " + c.title,
        r: () => {
          ls.set("os-ai-chat", c._id);
          openMod("buddy", true);
        },
      })),
  cmd: (v, arg) => {
    if (!["ask", AI.name.toLowerCase(), "buddy", "ai", "chat"].includes(v)) return [];
    return [
      arg
        ? {
            icon: "buddy",
            l: "Ask " + AI.name + ": " + arg,
            r: () => {
              let id = ls.get("os-ai-chat", "");
              if (!D.chats.some(c => c._id === id)) id = newChat();
              openMod("buddy", true);
              _send(id, arg);
            },
          }
        : { icon: "buddy", l: "Open " + AI.name, r: () => openMod("buddy", true) },
    ];
  },
};
