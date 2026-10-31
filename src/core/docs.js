/* Document extraction for the reader: PDF (pdf.js, loaded on demand from dist/pdfjs/), .docx and .epub (zip + DOMParser, no library),
   .txt/.md. extract(file) -> {title, text, type, pages}. PDF text is "[p.N] ..." per page so it chunks the same way as the server's pdftotext. */
import { HOME_SERVER } from "./sync.js";

export const DOC_RE = /\.(pdf|docx|epub)$/i;
export const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  epub: "application/epub+zip",
  txt: "text/plain",
  md: "text/markdown",
};
export const docType = n => {
  const m = /\.([a-z0-9]+)$/i.exec(n || "");
  const e = m ? m[1].toLowerCase() : "";
  return e === "markdown" ? "md" : MIME[e] ? e : "";
};
const MAXTEXT = 400000;

let pdfp = null;
/** pdf.js legacy build, fetched only when a PDF is opened */
export function loadPdfjs() {
  if (pdfp) return pdfp;
  /* bundled next to app.js; installers that predate it fetch the home server's copy instead */
  const from = base =>
    import(/* webpackIgnore: true */ base + "pdf.min.js").then(m => {
      if (!m || !m.GlobalWorkerOptions) throw new Error("not pdf.js");
      m.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
      return m;
    });
  return (pdfp = from(new URL("pdfjs/", document.baseURI).href)
    .catch(e => {
      if (!HOME_SERVER) throw e;
      return from(HOME_SERVER + "/pdfjs/");
    })
    .catch(e => {
      pdfp = null;
      throw new Error("Couldn't load the PDF engine (" + (e.message || e) + ").");
    }));
}

/* ---------- zip (docx / epub): central directory + native DecompressionStream ---------- */
export async function unzip(buf) {
  const v = new DataView(buf),
    u = new Uint8Array(buf);
  let e = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65600); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  if (e < 0) throw new Error("Not a zip-based document.");
  const n = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const files = new Map(),
    td = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const meth = v.getUint16(p + 10, true),
      cs = v.getUint32(p + 20, true),
      nl = v.getUint16(p + 28, true),
      xl = v.getUint16(p + 30, true),
      cl = v.getUint16(p + 32, true),
      off = v.getUint32(p + 42, true);
    const name = td.decode(u.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    files.set(name, async () => {
      const s = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true),
        raw = u.subarray(s, s + cs);
      if (meth === 0) return raw;
      const ds = new DecompressionStream("deflate-raw");
      return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
    });
  }
  const text = async n => {
    const g = files.get(n);
    return g ? new TextDecoder().decode(await g()) : "";
  };
  return { files, text };
}

const xml = (s, t = "application/xml") => new DOMParser().parseFromString(s, t);
const tags = (el, n) => Array.from(el.getElementsByTagNameNS("*", n));
const clean = s =>
  String(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

/* ---------- docx ---------- */
function docxText(d) {
  const out = [];
  const para = p => {
    let t = "";
    for (const el of p.getElementsByTagNameNS("*", "*")) {
      const n = el.localName;
      if (n === "t") t += el.textContent;
      else if (n === "tab") t += "\t";
      else if (n === "br" || n === "cr") t += "\n";
    }
    t = clean(t);
    if (!t) return;
    const st = tags(p, "pStyle")[0],
      sv = st ? st.getAttribute("w:val") || st.getAttribute("val") || "" : "";
    const h = /^heading\s*(\d)/i.exec(sv);
    if (h) t = "#".repeat(Math.min(6, +h[1])) + " " + t;
    else if (/^title$/i.test(sv)) t = "# " + t;
    else if (tags(p, "numPr").length) t = "- " + t;
    out.push(t);
  };
  const walk = el => {
    for (const c of Array.from(el.children)) {
      if (c.localName === "p") para(c);
      else if (c.localName === "tbl")
        tags(c, "tr").forEach(r => {
          const cells = tags(r, "tc")
            .map(tc =>
              clean(
                tags(tc, "t")
                  .map(x => x.textContent)
                  .join(" "),
              ),
            )
            .filter(Boolean);
          if (cells.length) out.push(cells.join(" | "));
        });
      else if (c.localName === "sdt" || c.localName === "sdtContent") walk(c);
    }
  };
  const body = tags(d, "body")[0];
  if (body) walk(body);
  return out.join("\n\n");
}

/* ---------- epub ---------- */
async function epubText(z) {
  const cont = xml(await z.text("META-INF/container.xml")),
    rf = tags(cont, "rootfile")[0];
  if (!rf) throw new Error("Not a readable EPUB.");
  const opfPath = rf.getAttribute("full-path"),
    dir = opfPath.includes("/") ? opfPath.replace(/[^/]*$/, "") : "",
    opf = xml(await z.text(opfPath));
  const man = new Map(tags(opf, "item").map(i => [i.getAttribute("id"), i.getAttribute("href")]));
  const title = (tags(opf, "title")[0] || {}).textContent || "";
  const out = [];
  const SEL = "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr";
  for (const ir of tags(opf, "itemref")) {
    const href = man.get(ir.getAttribute("idref"));
    if (!href) continue;
    const path = decodeURI(dir + href.split("#")[0]);
    let raw = await z.text(path);
    if (!raw) continue;
    const doc = xml(raw, "text/html");
    for (const el of doc.querySelectorAll(SEL)) {
      if (el.querySelector(SEL)) continue;
      const t = clean(el.textContent);
      if (!t) continue;
      const h = /^H(\d)$/.exec(el.tagName);
      out.push(h ? "#".repeat(+h[1]) + " " + t : el.tagName === "LI" ? "- " + t : t);
    }
    if (out.join("").length > MAXTEXT) break;
  }
  return { title: clean(title), text: out.join("\n\n") };
}

/* ---------- pdf ---------- */
export async function pdfText(buf, onProgress) {
  const lib = await loadPdfjs(),
    task = lib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }),
    doc = await task.promise;
  const parts = [];
  let size = 0;
  for (let i = 1; i <= doc.numPages && size < MAXTEXT; i++) {
    const pg = await doc.getPage(i),
      tc = await pg.getTextContent();
    let t = "";
    for (const it of tc.items) {
      if (typeof it.str !== "string") continue;
      t += it.str;
      if (it.hasEOL) t += "\n";
      else if (it.str && !/\s$/.test(it.str)) t += " ";
    }
    t = t
      .replace(/-\n(?=[a-z])/g, "")
      .replace(/\n(?!\n)/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    pg.cleanup();
    parts.push("[p." + i + "] " + t);
    size += t.length;
    if (onProgress && i % 10 === 0) onProgress(i, doc.numPages);
  }
  const meta = await doc.getMetadata().catch(() => null),
    n = doc.numPages;
  task.destroy();
  return { title: clean((meta && meta.info && meta.info.Title) || ""), text: parts.join("\n\n"), pages: n };
}

/** file -> {title,text,type,pages?}; title falls back to the file name without extension */
export async function extract(file, onProgress) {
  const type = docType(file.name),
    base = file.name.replace(/\.[^.]+$/, "");
  let r;
  if (type === "pdf") r = await pdfText(await file.arrayBuffer(), onProgress);
  else if (type === "docx") {
    const z = await unzip(await file.arrayBuffer());
    r = { title: "", text: docxText(xml(await z.text("word/document.xml"))) };
  } else if (type === "epub") r = await epubText(await unzip(await file.arrayBuffer()));
  else if (type === "txt" || type === "md") r = { title: "", text: await file.text() };
  else throw new Error("Can't read ." + ((/\.([^.]+)$/.exec(file.name) || [])[1] || "that") + " files.");
  return {
    title: r.title && r.title.length > 2 && type !== "pdf" ? r.title : base,
    text: r.text.slice(0, MAXTEXT),
    type,
    pages: r.pages || 0,
  };
}
