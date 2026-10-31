/* the app-update light (state in core/update.js): taskbar tray icon on desktop, a row at the top of the Start menu /
   phone menu, and a dot on the phone menu button. Hidden while there's nothing going on. */
import { html } from "../core/lib.js";
import { useUpdate, restartNow, seenFailure, fromLabel, readyLabel, UPSTREAM } from "../core/update.js";
import { openMod } from "./os.js";

const ago = t => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 60000));
  return !t || isNaN(m) ? "" : m < 1 ? "just now" : m + " min";
};
/* what the new build is: a toybox.os version (its commit and message, plus this server's own changes kept on top)
   or a change made with Osage on this server (what was asked for) */
const what = u =>
  u.src === "local"
    ? "“" + (u.req || "a change") + "”"
    : u.src === "upstream"
      ? [u.commit, u.subject, u.kept ? "your " + u.kept + (u.kept === 1 ? " change" : " changes") + " kept" : ""]
          .filter(Boolean)
          .join(" · ") || "a new version"
      : "Restart to use it";
export const updText = u =>
  u.phase === "building"
    ? [
        "Building an update from " + UPSTREAM,
        (u.commit ? u.commit + " · " : "") +
          (u.subject || "on the home server") +
          (u.started ? " · " + ago(u.started) : ""),
      ]
    : u.phase === "downloading"
      ? [fromLabel(u) + " · " + u.pct + "%", what(u)]
      : u.phase === "ready"
        ? [readyLabel(u), what(u)]
        : u.phase === "native"
          ? ["New installer needed", "This update changes the app itself: install the new version"]
          : u.phase === "failed"
            ? ["Update build failed", (u.commit ? u.commit + " · " : "") + (u.subject || "see the Inbox")]
            : null;
const act = u =>
  u.phase === "ready"
    ? restartNow()
    : u.phase === "failed"
      ? (seenFailure(), openMod("sync", true))
      : openMod("sync", true);

/* the tray icon: an arrow into a tray, a ring around it (turning while the server builds, filling while downloading) */
export function UpdTray() {
  const u = useUpdate(),
    t = updText(u);
  if (!t) return null;
  const C = 2 * Math.PI * 7,
    fill = u.phase === "downloading" ? (C * u.pct) / 100 : u.phase === "building" ? C * 0.3 : C;
  return html`<button class=${"utray " + u.phase} title=${t[0] + ": " + t[1]} aria-label=${t[0]} onClick=${() => act(u)}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle class="ur" cx="8" cy="8" r="7" stroke-dasharray=${fill + " " + C}/><path d="M8 4v6M5.5 7.5L8 10l2.5-2.5M5 12h6"/></svg>
    ${u.phase === "ready" ? html`<b class="ok"/>` : u.phase === "failed" || u.phase === "native" ? html`<b>!</b>` : null}</button>`;
}

/* the row in the Start menu (and the phone menu sheet) */
export function UpdRow({ close }) {
  const u = useUpdate(),
    t = updText(u);
  if (!t) return null;
  const bar = u.phase === "building" || u.phase === "downloading";
  return html`<div class=${"upr " + u.phase} role="status">
    <div class="upt"><b>${t[0]}</b><small>${t[1]}</small>
      ${bar ? html`<div class=${"upb" + (u.phase === "building" ? " run" : "")}><i style=${u.phase === "downloading" ? "width:" + u.pct + "%" : ""}/></div>` : null}</div>
    ${
      u.phase === "ready"
        ? html`<button class="btn" onClick=${restartNow}>Restart</button>`
        : u.phase === "failed"
          ? html`<button class="btn" onClick=${() => {
              close && close();
              act(u);
            }}>Details</button>`
          : null
    }</div>`;
}

/* phone menu button: just a dot */
export function UpdDot() {
  const u = useUpdate();
  return u.phase === "idle" ? null : html`<i class=${"udot " + u.phase} aria-hidden="true"/>`;
}
