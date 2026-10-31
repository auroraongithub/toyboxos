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
