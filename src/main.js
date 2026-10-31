import { render } from "preact";
import { html } from "./core/lib.js";
import { boot } from "./core/store.js";
import "./core/profile.js";
import { initSkin } from "./shell/skins.js";
import { applyTheme } from "./shell/theme.js";
import { setModules } from "./shell/os.js";
import { initAlarms } from "./core/alarms.js";
import { liveOk, initUpdates } from "./core/update.js";
import { WINDOWS } from "./modules/index.js";
import App from "./shell/App.js";
import { native } from "./core/sync.js";
import { initContextMenu } from "./shell/ctxmenu.js";
import "./styles/xp-base.css";
import "./styles/shell.css";
import "./styles/xp-kit.css";
import "./styles/fun.css";
import "./styles/themes.css";
import "./styles/polish.css";
import "./styles/pages.css";
import "./styles/graph.css";
import "./styles/whiteboard.css";
import "./styles/buddy.css";
import "./styles/theme.css";
import "./styles/store.css";
import "./styles/editor.css";
import "./styles/reader.css";
import "./styles/mobile.css";
import "./styles/sheet.css";
import "./styles/wm.css";
import "./styles/nijika.css";
import "./styles/moodle.css";
import "./styles/custom.css";
import "./styles/app-changes.css";

initSkin();
applyTheme();
setModules(WINDOWS);
render(html`<${App}/>`, document.getElementById("app"));
boot();
if (!window.__OSAGE_PREVIEW__) initAlarms();
liveOk();
initUpdates();
if (!window.__OSAGE_PREVIEW__) initContextMenu();
/* no service worker on localhost: it would serve the previous build while you're working on it */
const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
if (!window.__OSAGE_PREVIEW__) {
  if ("serviceWorker" in navigator && dev)
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
  else if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !native)
    navigator.serviceWorker.register("sw.js").catch(() => {});
}
