// node build.mjs  ->  dist/ (PWA: index.html, app.js, app.css, sw.js, manifest)
import * as esbuild from "esbuild";
import fs from "node:fs";
import { execSync } from "node:child_process";
// the pack (art, persona, badges...): SOS_PACK, else osage when this checkout has it, else the neutral default
const pack = process.env.SOS_PACK || (fs.existsSync("src/packs/osage/index.js") ? "osage" : "default");
const alias = {
  preact: "./vendor/preact.mjs",
  "preact/hooks": "./vendor/hooks.mjs",
  htm: "./vendor/htm.mjs",
  "sos-pack": `./src/packs/${pack}/index.js`,
};
const v = Date.now().toString(36);
// SOS_OUT: where the build goes (release.py builds a neutral-pack copy into a temp folder)
const OUT = process.env.SOS_OUT || "dist";
const common = {
  define: { __BUILD__: JSON.stringify(v) },
  entryPoints: ["src/main.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  alias,
  loader: { ".webp": "dataurl", ".css": "css" },
  outdir: OUT,
  write: false,
  legalComments: "none",
};
const r = await esbuild.build(common);
const js = r.outputFiles.find(f => f.path.endsWith(".js")).text,
  css = r.outputFiles.find(f => f.path.endsWith(".css")).text;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "/app.js", js);
fs.writeFileSync(OUT + "/app.css", css);
// xterm.js for the nijika terminal: its own file, fetched only when the terminal opens
await esbuild.build({
  entryPoints: ["src/xterm-entry.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: OUT + "/xterm.js",
  legalComments: "none",
});
const font =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap" rel="stylesheet">';
const head = t =>
  `<title>toybox.os</title>\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${font}\n${t || ""}`;
// PWA/native ship the Latin slice of the font so the banner looks right offline (Google still fills in other scripts when online)
fs.copyFileSync("assets/dotgothic16-latin.woff2", OUT + "/dotgothic16-latin.woff2");
// app icons: the pack's own (src/packs/<pack>/icon-192.png, icon-512.png) when it has them, else the neutral ones in assets/
for (const n of ["icon-192.png", "icon-512.png"])
  fs.copyFileSync(
    fs.existsSync(`src/packs/${pack}/${n}`) ? `src/packs/${pack}/${n}` : `assets/${n}`,
    OUT + "/" + n,
  );
// alarm sounds (assets/sounds, AOSP, Apache-2.0): fetched only when one rings or is previewed (core/sounds.js)
fs.mkdirSync(OUT + "/sounds", { recursive: true });
for (const f of fs.readdirSync("assets/sounds").filter(f => f.endsWith(".ogg")))
  fs.copyFileSync("assets/sounds/" + f, OUT + "/sounds/" + f);
// the document reader's pdf.js: its own files, fetched only when a PDF opens (core/docs.js); .js so any server sends a script type
fs.mkdirSync(OUT + "/pdfjs", { recursive: true });
for (const f of ["pdf", "pdf.worker"])
  fs.copyFileSync(`vendor/pdfjs/${f}.min.mjs`, OUT + `/pdfjs/${f}.min.js`);
const localFont =
  '<style>@font-face{font-family:"DotGothic16";font-style:normal;font-weight:400;font-display:swap;src:url(dotgothic16-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}</style>';
// PWA shell
fs.writeFileSync(
  OUT + "/index.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8">${head(localFont + '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#8c8c8c"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png"><link rel="stylesheet" href="app.css">')}</head><body><div id="app"></div><script>(function(){var T=window.__TAURI_INTERNALS__;function std(){var s=document.createElement('script');s.src='app.js';document.body.appendChild(s);}if(!T||!window.caches){std();return;}var tr=localStorage.getItem('os-live-try'),ok=localStorage.getItem('os-live-ok');if(tr&&tr!==ok){caches.delete('sos-live').then(function(){localStorage.removeItem('os-live-try');localStorage.removeItem('os-live-pending');std();});return;}caches.open('sos-live').then(function(c){return Promise.all([c.match('live-app.js'),c.match('live-app.css'),c.match('live.json')]);}).then(function(r){if(!r[0]||!r[2]){std();return;}return r[2].json().then(function(m){if(m.api>1||parseInt(m.build,36)<=parseInt('${v}',36)){std();return;}localStorage.setItem('os-live-try',m.build);return Promise.all([r[0].blob(),r[1]?r[1].text():'']).then(function(x){if(x[1]){var st=document.createElement('style');st.textContent=x[1];document.head.appendChild(st);}var s=document.createElement('script');s.src=URL.createObjectURL(x[0]);document.body.appendChild(s);});});}).catch(std);})();</script></body></html>`,
);
fs.writeFileSync(
  OUT + "/manifest.webmanifest",
  JSON.stringify({
    name: "toybox.os",
    short_name: "toybox.os",
    start_url: ".",
    display: "standalone",
    background_color: "#8c8c8c",
    theme_color: "#8c8c8c",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }),
);
fs.writeFileSync(
  OUT + "/sw.js",
  `const C="sos-${v}",F=["./","index.html","app.js","app.css","manifest.webmanifest","icon-192.png","icon-512.png","dotgothic16-latin.woff2"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok&&new URL(e.request.url).origin===location.origin){const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp));}return res;}).catch(()=>caches.match("index.html"))));});
`,
);
/* where this build came from: the repo (a push to main, deploy.sh, a release). Changes made with Osage on a server write
   their own version.json with src "local" (server/app_changes.py), so the update light can tell them apart. */
const git = a => {
  try {
    return execSync("git " + a, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
fs.writeFileSync(
  OUT + "/version.json",
  JSON.stringify({
    build: v,
    api: 1,
    src: "upstream",
    commit: process.env.SOS_COMMIT || git("rev-parse --short HEAD"),
    subject: (process.env.SOS_SUBJECT || git("log -1 --format=%s")).slice(0, 100),
  }),
);
console.log(
  "built",
  "pack " + pack,
  ((js.length / 1024) | 0) + "kb js",
  ((css.length / 1024) | 0) + "kb css",
);
