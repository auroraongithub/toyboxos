/* the native app's own title bar (Windows/Linux shell has decorations off).
   Shown only when the shell says its window is undecorated, so older installers keep their system frame. */
import { useState, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { useBrand } from "../brand.js";
import { ART } from "../core/pack.js";

const T = () => window.__TAURI_INTERNALS__;
const win = cmd => T().invoke("plugin:window|" + cmd, { label: "main" });

/* resolves true once the shell confirms an undecorated desktop window */
export const frameless = () => {
  if (!T() || !T().invoke || /Android/i.test(navigator.userAgent)) return Promise.resolve(false);
  return win("is_decorated")
    .then(d => !d)
    .catch(() => false);
};

/* Theme > Art > App icon: a 256px PNG for the browser tab and, in the desktop shell, the window/taskbar and tray
   (set_icon; older installers lack it and keep theirs). null = the build's own. Android launcher icons can't change. */
let lastIcon = null;
export async function appIcon(u) {
  if (u === lastIcon) return;
  lastIcon = u;
  let png = null;
  if (u)
    try {
      const im = new Image();
      im.src = u;
      await im.decode();
      const c = document.createElement("canvas"),
        k = Math.min(256 / im.naturalWidth, 256 / im.naturalHeight),
        w = im.naturalWidth * k,
        h = im.naturalHeight * k;
      c.width = c.height = 256;
      c.getContext("2d").drawImage(im, (256 - w) / 2, (256 - h) / 2, w, h);
      png = c.toDataURL("image/png");
    } catch (e) {}
  if (u !== lastIcon) return; // changed again while this one decoded
  for (const l of document.querySelectorAll('link[rel="icon"]')) l.href = png || "icon-192.png";
  if (T() && T().invoke && !/Android/i.test(navigator.userAgent))
    T()
      .invoke("set_icon", { png: png ? [...atob(png.split(",")[1])].map(c => c.charCodeAt(0)) : null })
      .catch(() => {});
}

export function OsBar() {
  const [name] = useBrand(),
    [max, setMax] = useState(false);
  useEffect(() => {
    const r = () =>
      win("is_maximized")
        .then(setMax)
        .catch(() => {});
    r();
    addEventListener("resize", r);
    return () => removeEventListener("resize", r);
  }, []);
  const btn = (cls, label, cmd) =>
    html`<button class=${"cap " + cls + (cls === "mx" && max ? " on" : "")} aria-label=${label} title=${label} onClick=${() => win(cmd).catch(() => {})}><i></i></button>`;
  return html`<div class="osbar" data-tauri-drag-region>
    <img class="osb-ic" src=${ART.aiAvatar || ART.logo} alt="" data-tauri-drag-region/>
    <span class="osb-t" data-tauri-drag-region>${name}</span>
    ${btn("mn", "Minimise", "minimize")}${btn("mx", max ? "Restore" : "Maximise", "toggle_maximize")}${btn("x", "Close", "close")}
  </div>`;
}
