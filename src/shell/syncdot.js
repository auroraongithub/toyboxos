import { html } from "../core/lib.js";
import { useSync, syncConfig } from "../core/sync.js";

/* tiny status light: green = in sync, amber = changes waiting / syncing, red = problem, hollow = sync off */
export function SyncDot({ onClick, cls = "" }) {
  const st = useSync(),
    cfg = syncConfig();
  let k = "off",
    t = "Sync is off (data stays on this device)";
  if (cfg.on) {
    const s = st.state;
    k = s === "error" ? "bad" : s === "syncing" || s === "offline" || st.pending > 0 ? "wait" : "ok";
    t =
      k === "ok"
        ? "Everything is synced"
        : k === "bad"
          ? "Sync problem: " + (st.err || "see Sync")
          : s === "offline"
            ? "Offline: " + st.pending + " waiting to send"
            : "Syncing… " + (st.pending || "") + " waiting";
  }
  const T = cls === "in" ? "span" : "button";
  /* phone menu button: just the light. Taskbar tray: a sync-arrows icon that turns while syncing, with a small
     badge for what needs attention (pending count, "!" on a problem, a slash when sync is off) */
  if (cls === "in")
    return html`<${T} class=${"sdot " + k + " " + cls} title=${t} aria-label=${t} role="button" onClick=${onClick}><i/><//>`;
  const badge =
    k === "bad" ? "!" : k === "wait" && st.pending > 0 ? (st.pending > 99 ? "99+" : String(st.pending)) : "";
  return html`<button class=${"stray " + k + (cfg.on && st.state === "syncing" ? " spin" : "")} title=${t} aria-label=${t} onClick=${onClick}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 6.2A5.5 5.5 0 0 0 3.1 4.6"/><path d="M2.8 9.8a5.5 5.5 0 0 0 10.1 1.6"/><path class="ah" d="M3.6 1.6v3.3h3.3M12.4 14.4v-3.3H9.1"/></svg>
    ${badge ? html`<b>${badge}</b>` : null}</button>`;
}
