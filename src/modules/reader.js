/* Document reader: a page with `doc` {file,name,type,pages,src} shows its original file here (PDF drawn page by page with a
   selectable text layer, everything else as the extracted text in pages) instead of the block editor. Ask Osage indexes the text as a
   server-side source so long documents are searched, not pasted. */
import { useState, useEffect, useRef } from "preact/hooks";
import { on as featOn } from "../core/features.js";
import { html } from "../core/lib.js";
import { ls, usePref } from "../core/pref.js";
import { D, W } from "../core/store.js";
import { toast } from "../core/bus.js";
import { render } from "../core/md.js";
import { fileUrl, uploadPending } from "../core/files.js";
import { loadPdfjs } from "../core/docs.js";
import { api, aiBase, newChat, moodleFile } from "../core/ai.js";
import { Tools, Btn, Icon, StatusBar } from "../ui/index.js";

import { AI } from "../core/pack.js";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];
const near = z => STEPS.reduce((b, s) => (Math.abs(s - z) < Math.abs(b - z) ? s : b), 1);

/* ---------- Ask Osage ---------- */
export async function askOsage(p) {
  const d = p.doc || {};
  let sid = d.src && D.sources.some(s => s._id === d.src) ? d.src : "";
  if (!sid && aiBase()) {
    sid = "d-" + p._id;
    toast(AI.name + " is reading " + (p.title || "the document") + "…");
    try {
      let r = null;
      const body = { id: sid, title: p.title || d.name || "Document" };
      if (d.type === "pdf" && d.file) {
        await uploadPending();
        r = await api("/api/src", { ...body, kind: "file", file: d.file }).catch(() => null);
      }
      if (!r) r = await api("/api/src", { ...body, kind: "text", text: p.body || "" });
      W.set("sources", sid, {
        title: r.title,
        kind: r.kind,
        url: "",
        chars: r.chars,
        n: r.n,
        at: new Date().toISOString(),
      });
      W.upd("pages", p._id, { doc: { ...d, src: sid } });
    } catch (e) {
      toast(e.message);
      sid = "";
    }
  } else if (!aiBase())
    toast("Connect Sync so " + AI.name + " can search the whole file; it only sees the start for now.");
  let chat = sid && D.chats.find(c => (c.src || []).includes(sid));
  const id = chat ? chat._id : newChat({ title: p.title || "Document", src: sid ? [sid] : [] });
  ls.set("os-ai-chat", id);
  ls.set("os-page", p._id);
  ls.set("os-sub-notes", "notes");
  dispatchEvent(new CustomEvent("os-ask", { detail: "notes" }));
}

/* ---------- PDF ---------- */
function PdfView({ doc: d, zoom, gotoRef, onPage, onCount, onErr }) {
  const box = useRef(),
    S = useRef({}),
    [n, setN] = useState(0),
    [dim, setDim] = useState(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    let dead = false;
    (async () => {
      const lib = await loadPdfjs();
      let buf;
      /* Moodle course files stay private: fetched with the sync bearer header, never through the public file store */
      if (d.mdl) {
        if (!aiBase()) throw new Error("Turn on Sync to open this Moodle file.");
        buf = await moodleFile(d.mdl).catch(() => {
          throw new Error("Couldn't fetch this file from Moodle. Open it again from the Moodle window.");
        });
      } else {
        const url = await fileUrl(d.file);
        if (!url) throw new Error("This file isn't on this device yet. Turn on Sync to fetch it.");
        buf = await (await fetch(url)).arrayBuffer();
      }
      const task = lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }),
        pdf = await task.promise;
      if (dead) {
        task.destroy();
        return;
      }
      const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
      S.current = { pdf, lib, task };
      setDim([vp.width, vp.height]);
      setN(pdf.numPages);
      onCount(pdf.numPages);
    })().catch(e => !dead && onErr(e.message || String(e)));
    return () => {
      dead = true;
      const t = S.current.task;
      S.current = {};
      if (t) t.destroy();
    };
  }, [d.file || d.mdl]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const f = () => setW(el.clientWidth);
    f();
    const ro = new ResizeObserver(f);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = dim && w ? Math.max(0.1, (w - 16) / dim[0]) * zoom : 0;
  /* draw only the pages near the viewport; free the ones that scrolled away */
  useEffect(() => {
    const el = box.current;
    if (!n || !scale || !el) return;
    const pages = Array.from(el.querySelectorAll(".dpg")),
      tok = Symbol();
    S.current.tok = tok;
    const clear = div => {
      div._t && div._t.cancel && div._t.cancel();
      div._r = 0;
      div.textContent = "";
    };
    const draw = async div => {
      if (div._r) return;
      div._r = tok;
      const i = +div.dataset.i;
      try {
        const page = await S.current.pdf.getPage(i + 1);
        if (div._r !== tok) return;
        const dpr = Math.min(devicePixelRatio || 1, 2),
          vp = page.getViewport({ scale }),
          cv = document.createElement("canvas");
        cv.width = Math.floor(vp.width * dpr);
        cv.height = Math.floor(vp.height * dpr);
        div.style.width = vp.width + "px";
        div.style.height = vp.height + "px";
        const task = (div._t = page.render({
          canvasContext: cv.getContext("2d"),
          canvas: cv,
          viewport: page.getViewport({ scale: scale * dpr }),
        }));
        await task.promise;
        if (div._r !== tok) return;
        const tl = document.createElement("div");
        tl.className = "textLayer selectable";
        div.append(cv, tl);
        await new S.current.lib.TextLayer({
          textContentSource: page.streamTextContent(),
          container: tl,
          viewport: vp,
        }).render();
      } catch (e) {
        if (!(e && e.name === "RenderingCancelledException")) div._r = 0;
      }
    };
    const io = new IntersectionObserver(
      es => es.forEach(e => (e.isIntersecting ? draw(e.target) : clear(e.target))),
      { root: el, rootMargin: "900px 0px" },
    );
    pages.forEach(p => io.observe(p));
    return () => {
      io.disconnect();
      pages.forEach(clear);
    };
  }, [n, scale]);
  /* current page = the one crossing the upper third of the view */
  const pos = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(pos.current);
    pos.current = requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      const y = el.scrollTop + el.clientHeight / 3;
      let cur = 0;
      for (const p of el.querySelectorAll(".dpg")) {
        if (p.offsetTop <= y) cur = +p.dataset.i;
        else break;
      }
      onPage(cur + 1);
    });
  };
  useEffect(() => {
    gotoRef.current = i => {
      const el = box.current,
        p = el && el.querySelector(`.dpg[data-i="${i - 1}"]`);
      if (p) el.scrollTop = p.offsetTop - 6;
    };
  }, [n]);
  return html`<div class="dscroll" ref=${box} onScroll=${onScroll} tabindex="0">${
    scale
      ? html`<div class="dwrap">${Array.from(
          { length: n },
          (_, i) => html`<div class="dpg" key=${i} data-i=${i}
      style=${"width:" + dim[0] * scale + "px;height:" + dim[1] * scale + "px;--total-scale-factor:" + scale}/>`,
        )}</div>`
      : html`<div class="demp">Opening…</div>`
  }</div>`;
}

/* ---------- text documents (docx, epub, txt, md): cut into reading pages of ~3500 chars on paragraph breaks ---------- */
const paginate = t => {
  const out = [];
  let cur = "";
  for (const para of String(t || "").split(/\n{2,}/)) {
    if (cur && cur.length + para.length > 3500) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + para;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
};
function TextView({ body, zoom, page, onCount }) {
  const pages = paginate(body),
    box = useRef();
  useEffect(() => {
    onCount(pages.length);
  }, [pages.length]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [page]);
  const t = pages[clamp(page, 1, pages.length) - 1];
  return html`<div class="dscroll" ref=${box} tabindex="0"><div class="md selectable dtxt" style=${"font-size:" + Math.round(15 * zoom) + "px"} dangerouslySetInnerHTML=${{ __html: render(t) }}/></div>`;
}

export function DocReader({ p, onEdit }) {
  const d = p.doc,
    pdf = d.type === "pdf";
  const [zoom, setZoom] = usePref("os-doc-zoom", 1),
    [page, setPage] = useState(1),
    [n, setN] = useState(d.pages || 0),
    [err, setErr] = useState("");
  const goto = useRef(() => {}),
    [txt, setTxt] = useState(String(page));
  useEffect(() => setTxt(String(page)), [page]);
  const go = i => {
    i = clamp(Math.round(+i) || 1, 1, n || 1);
    setPage(i);
    if (pdf) goto.current(i);
  };
  const z = v => setZoom(near(v));
  const key = e => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight" || (!pdf && e.key === "PageDown")) {
      e.preventDefault();
      go(page + 1);
    } else if (e.key === "ArrowLeft" || (!pdf && e.key === "PageUp")) {
      e.preventDefault();
      go(page - 1);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      z(zoom * 1.25);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
      e.preventDefault();
      z(zoom / 1.25);
    }
  };
  return html`<div class="dr" onKeyDown=${key}>
    <${Tools} frm=${false} cls="drt">
      <${Btn} cls="ib" aria-label="Previous page" title="Previous page" disabled=${page <= 1} onClick=${() => go(page - 1)}>‹<//>
      <input class="field dpn" type="number" min="1" max=${n || 1} value=${txt} aria-label="Page number" onInput=${e => setTxt(e.target.value)} onChange=${e => go(e.target.value)} onKeyDown=${e => {
        if (e.key === "Enter") go(e.target.value);
      }}/>
      <span class="dof">/ ${n || "…"}</span>
      <${Btn} cls="ib" aria-label="Next page" title="Next page" disabled=${n && page >= n} onClick=${() => go(page + 1)}>›<//>
      <span class="sp"/>
      <${Btn} cls="ib" icon="minus" aria-label="Zoom out" title="Zoom out" onClick=${() => z(zoom / 1.25)}/>
      <button class="btn dzoom" title="Fit width" aria-label="Reset zoom" onClick=${() => setZoom(1)}>${Math.round(zoom * 100)}%</button>
      <${Btn} cls="ib" icon="plus" aria-label="Zoom in" title="Zoom in" onClick=${() => z(zoom * 1.25)}/>
      ${featOn("ai") ? html`<${Btn} cls="dask" icon="buddy" aria-label=${"Ask " + AI.name} title=${"Ask " + AI.name + " about this document"} onClick=${() => askOsage(p)}><span class="lbl">Ask ${AI.name}</span><//>` : null}
      <${Btn} cls="ib" icon="edit" aria-label="Edit the text" title="Edit the extracted text" onClick=${onEdit}/>
    <//>
    ${
      err
        ? html`<div class="demp">${err}</div>`
        : pdf
          ? html`<${PdfView} doc=${d} zoom=${zoom} gotoRef=${goto} onPage=${setPage} onCount=${setN} onErr=${setErr}/>`
          : html`<${TextView} body=${p.body} zoom=${zoom} page=${page} onCount=${setN}/>`
    }
    <${StatusBar} keep items=${[d.name, (d.type || "").toUpperCase() + (d.size ? " · " + (d.size > 1e6 ? (d.size / 1e6).toFixed(1) + " MB" : Math.round(d.size / 1e3) + " KB") : "")]}/>
  </div>`;
}
