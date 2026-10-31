import { useState, useEffect, useRef } from "preact/hooks";
import { html } from "../core/lib.js";
import { ls, usePref, useMedia } from "../core/pref.js";
import { useCols } from "../core/store.js";
import { Window, tileWindows, topWindow } from "../ui/index.js";
import { liveWindows } from "../modules/index.js";
import { useMods, on as featOn } from "../core/features.js";
import { useLook } from "../core/look.js";
import { Piece } from "./piece.js";
import { SetupHost } from "../modules/setup.js";
import { Stickers } from "./stickers.js";
import { LayoutEditor } from "./layedit.js";
import { useLayout, isEditing, setEditing } from "../core/layout.js";
import { openMod, closeMod, toggleMin, DEFAULT_OPEN, hubOf } from "./os.js";
import { Stand, Side, Taskbar, TabBar, StartMenu, CmdBar, Toast, ART } from "./chrome.js";
import { Banner, Flusher } from "./fun.js";
import { ReviewHost } from "../modules/study.js";
import { SheetHost } from "../ui/sheet.js";
import { AlarmHost } from "../core/alarms.js";
import { OsBar, frameless } from "./titlebar.js";
import { installSwipe } from "../ui/swipe.js";
import { pushBack, dropBack, fromBack } from "../core/back.js";
import { installGestures } from "../ui/gestures.js";
installSwipe();
installGestures();

export default function App() {
  const mobile = useMedia("(max-width:860px)");
  useMods();
  useLook();
  useLayout();
  const WINDOWS = liveWindows();
  useEffect(() => {
    if (mobile && isEditing()) setEditing(false);
  }, [mobile]);
  const [openList] = usePref("os-open", DEFAULT_OPEN);
  const [minList] = usePref("os-min", []);
  const [view] = usePref("os-view", "today");
  const [menu, setMenu] = useState(false),
    [cmd, setCmd] = useState(false),
    [bar, setBar] = useState(false);
  /* an Osage reply still running on the home server from before a restart: follow it again */
  useEffect(() => {
    const t = setTimeout(() => import("../core/ai.js").then(m => m.reattach()), 2500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => import("../modules/setup.js").then(m => m.firstRun()), 1200);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    frameless().then(f => {
      setBar(f);
      document.documentElement.classList.toggle("ndesk", f);
    });
  }, []);
  const cur = WINDOWS.some(m => m.id === hubOf(view)) ? hubOf(view) : "today";
  useEffect(() => {
    document.body.dataset.view = cur;
    if (cur !== "buddy") ls.set("os-ai-last", cur);
  }, [cur]);
  /* back button: another tab goes back to Today; Osage goes back to where you were; menu and command bar close */
  const pv = useRef(cur);
  useEffect(() => {
    const p = pv.current;
    pv.current = cur;
    if (p === cur || fromBack()) return;
    if (p === "buddy") dropBack("view");
    if (cur === "today") dropBack("view", true);
    else if (cur === "buddy") pushBack("view", () => openMod(p, true));
    else if (p === "today") pushBack("view", () => openMod("today", true));
  }, [cur]);
  useEffect(() => {
    if (fromBack()) return;
    if (menu) pushBack("menu", () => setMenu(false));
    else dropBack("menu");
  }, [menu]);
  useEffect(() => {
    if (fromBack()) return;
    if (cmd) pushBack("cmd", () => setCmd(false));
    else dropBack("cmd");
  }, [cmd]);
  /* Buddy's "what's open" = the window you last touched; a title bar's bubble button sends that window along */
  useEffect(() => {
    const touch = e => {
      const w = e.target.closest && e.target.closest("#mcol > .win");
      if (w && w.dataset.win !== "buddy" && w.dataset.win !== "sync") ls.set("os-ai-last", w.dataset.win);
    };
    const ask = e => {
      if (!featOn("ai")) return;
      ls.set("os-ai-last", e.detail);
      ls.set("os-ai-ask", e.detail);
      ls.set("os-sub-buddy", "buddy");
      openMod("buddy", true);
    };
    document.addEventListener("pointerdown", touch, true);
    addEventListener("os-ask", ask);
    return () => {
      document.removeEventListener("pointerdown", touch, true);
      removeEventListener("os-ask", ask);
    };
  }, []);
  useEffect(() => {
    const k = e => {
      if (e.defaultPrevented) return; /* the editor already used it (Ctrl+K = link there) */
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu(false);
        setCmd(c => !c);
        return;
      }
      if (e.key === "Escape") {
        setCmd(false);
        setMenu(false);
        return;
      }
      /* desktop: Alt+1..6 = the six windows, Alt+W closes the window on top, Alt+T tiles them */
      if (e.altKey && !e.ctrlKey && !e.metaKey && innerWidth > 860) {
        const n = parseInt(e.key, 10),
          hubs = liveWindows().filter(m => m.tab);
        if (n >= 1 && n <= hubs.length) {
          e.preventDefault();
          openMod(hubs[n - 1].id, true);
          return;
        }
        const k = e.key.toLowerCase();
        if (k === "w") {
          const t = topWindow();
          if (t) {
            e.preventDefault();
            closeMod(t);
          }
          return;
        }
        if (k === "t") {
          e.preventDefault();
          tileWindows();
          return;
        }
      }
      const tg = e.target && e.target.tagName;
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(tg) &&
        !(e.target && e.target.isContentEditable)
      ) {
        e.preventDefault();
        setMenu(false);
        setCmd(true);
      }
    };
    /* touch: while a text box has focus the keyboard is up, so the tab bar steps aside */
    const typing = () => {
      const e = document.activeElement,
        t =
          e &&
          (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.isContentEditable) &&
          !(e.type && /^(checkbox|radio|button|file)$/.test(e.type));
      document.body.toggleAttribute("data-typing", !!t && matchMedia("(pointer:coarse)").matches);
    };
    document.addEventListener("focusin", typing);
    document.addEventListener("focusout", () => setTimeout(typing, 60));
    const c = () => setMenu(false),
      oc = () => {
        setMenu(false);
        setTimeout(() => setCmd(true));
      };
    document.addEventListener("keydown", k);
    document.addEventListener("click", c);
    addEventListener("os-cmd", oc);
    return () => {
      document.removeEventListener("keydown", k);
      document.removeEventListener("click", c);
      removeEventListener("os-cmd", oc);
    };
  }, []);
  const open = openList.map(hubOf);
  const shown = mobile ? WINDOWS.filter(m => m.id === cur) : WINDOWS.filter(m => open.includes(m.id));
  return html`${bar ? html`<${OsBar}/>` : null}${isEditing() && !mobile ? html`<${LayoutEditor}/>` : null}<${Stand}/><${Stickers}/><${SetupHost}/><${Piece} id="banner" out><${Banner} onMenu=${() => setMenu(!menu)}/><//>
    <div class="desk">
      <div class="mcol" id="mcol">${shown.map(
        m => html`<${Window} key=${m.id} id=${m.id} title=${m.title} label=${m.name} mod=${m.mod !== false} cls=${m.mod === false ? "main-win" : ""} cur=${mobile} desk=${!mobile} deco=${m.id === "jobs" && ART.jobsPeek ? html`<img class="pop chib" src=${ART.jobsPeek} alt=""/>` : null}
          min=${!mobile && minList.includes(m.id)} onMin=${mobile ? null : () => toggleMin(m.id)} onClose=${mobile ? null : () => closeMod(m.id)}>
          <${m.Comp}/><//>`,
      )}</div>
      <${Side}/>
    </div>
    <${Taskbar} openList=${open} minList=${minList} onMenu=${() => setMenu(!menu)} onCmd=${() => {
      setMenu(false);
      setCmd(true);
    }}/>
    <${TabBar} view=${cur} mobile=${mobile}/>
    <${StartMenu} open=${menu} close=${() => setMenu(false)} openList=${open} minList=${minList} view=${cur} mobile=${mobile} onCmd=${() => setCmd(true)}/>
    <${CmdBar} open=${cmd} close=${() => setCmd(false)}/>
    <${ReviewHost}/><${SheetHost}/><${AlarmHost}/><${Flusher}/><${Toast}/>`;
}
