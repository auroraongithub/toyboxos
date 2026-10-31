/* Phone gestures for whole screens (list rows have their own in swipe.js):
   - swipe left/right on a hub's content = the next/previous tab (Pages | Inbox | Tools ...)
   - pull down at the very top = sync now (only with Sync on)
   - each tab (and each open page) keeps its own scroll position: useScrollKey(part) sets where we are */
import { useLayoutEffect } from "preact/hooks";
import { isMobile } from "../core/pref.js";
import { syncNow, syncConfig, syncState } from "../core/sync.js";

export const buzz = (ms = 10) => {
  if (navigator.vibrate)
    try {
      navigator.vibrate(ms);
    } catch {
      // vibration is optional
    }
};

/* ---- scroll memory: key = hub part [+ "/" + what's open inside it] */
const pos = new Map();
let base = "",
  extra = "",
  key = "",
  settle = 0;
const apply = () => {
  const k = base + (extra ? "/" + extra : "");
  if (k === key) return;
  key = k;
  const y = pos.get(k) || 0;
  window.scrollTo(0, y);
  settle = Date.now();
  requestAnimationFrame(() => {
    if (key === k) window.scrollTo(0, y);
  });
};
addEventListener(
  "scroll",
  () => {
    if (key && Date.now() - settle > 80) pos.set(key, window.scrollY);
  },
  { passive: true },
);
/* hub=true for the hub's part, false for something open inside it (a notes page); runs children-first, so
   the part's own key never wipes the page key */
export function useScrollKey(k, hub) {
  useLayoutEffect(() => {
    if (!isMobile()) return;
    if (hub) base = k;
    else extra = k;
    apply();
    return () => {
      if (!hub && extra === k) extra = "";
    };
  }, [k]);
}

/* ---- swipe between tabs + pull to sync */
const SKIP =
  "input,textarea,select,[contenteditable=true],canvas,.xterm,.sheet,.hubtabs,.kbar,.flo,pre,table,.noswipe";
/* a row that swipes itself (Delete / Done) keeps the gesture */
const rowSwipes = el => {
  const r = el.closest(".lr");
  return !!r && !!r.querySelector('.x1[aria-label="Delete"],.ck[role=checkbox]');
};
const hscroll = el => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
};
const vtop = el => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollTop > 0) return false;
  }
  return window.scrollY <= 0;
};

let pill = null;
function showPill(t, dy) {
  if (!pill) {
    pill = document.createElement("div");
    pill.className = "ptr";
    document.body.appendChild(pill);
  }
  pill.textContent = t;
  pill.style.transform = "translate(-50%," + Math.round(dy) + "px)";
  pill.hidden = false;
}
const hidePill = ms =>
  setTimeout(() => {
    if (pill) {
      pill.hidden = true;
      pill.style.transform = "";
    }
  }, ms || 0);

export function installGestures() {
  let t = null;
  document.addEventListener(
    "touchstart",
    e => {
      t = null;
      if (!isMobile() || e.touches.length !== 1 || document.body.hasAttribute("data-typing")) return;
      const p = e.touches[0],
        el = e.target,
        win = el.closest && el.closest(".mcol > .win.cur");
      if (!win || document.querySelector(".sheet:not([hidden]),.startmenu:not([hidden]),.rv")) return;
      if (p.clientX < 24 || p.clientX > innerWidth - 24)
        return; /* the system back gesture lives at the edges */
      t = {
        x: p.clientX,
        y: p.clientY,
        at: Date.now(),
        win,
        tab: !el.closest(SKIP) && !rowSwipes(el) && !hscroll(el),
        pull: vtop(el) && !el.closest("canvas,.xterm,.sheet,textarea"),
        mode: "",
      };
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    "touchmove",
    e => {
      if (!t) return;
      const p = e.touches[0],
        dx = p.clientX - t.x,
        dy = p.clientY - t.y;
      if (!t.mode) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        t.mode =
          Math.abs(dx) > Math.abs(dy) * 1.4 ? "h" : dy > 0 && t.pull && window.scrollY <= 0 ? "pull" : "v";
        if (t.mode === "pull" && !syncConfig().on) t.mode = "v";
      }
      if (t.mode === "pull") {
        const d = Math.min(dy * 0.45, 90);
        t.d = d;
        showPill(d > 60 ? "Release to sync" : "Pull to sync", d);
        if (d > 60 && !t.armed) {
          t.armed = 1;
          buzz();
        } else if (d <= 60) t.armed = 0;
      }
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    "touchend",
    e => {
      const s = t;
      t = null;
      if (!s) return;
      const p = e.changedTouches[0],
        dx = p.clientX - s.x,
        dy = p.clientY - s.y;
      if (s.mode === "pull") {
        if (s.d > 60) {
          showPill("Syncing…", 48);
          const before = syncState().last;
          syncNow().then(() => {
            const st = syncState();
            showPill(
              st.state === "ok" && st.last !== before
                ? "Synced"
                : st.state === "offline"
                  ? "Offline"
                  : st.state === "error"
                    ? "Sync failed"
                    : "Synced",
              48,
            );
            hidePill(900);
          });
        } else hidePill();
        return;
      }
      if (
        s.mode !== "h" ||
        !s.tab ||
        Math.abs(dx) < 70 ||
        Math.abs(dx) < Math.abs(dy) * 2 ||
        Date.now() - s.at > 700
      )
        return;
      if (s.win.querySelector(".hubback,.hubtabs[data-deep]") || s.win.querySelector(".pg .pv:not(.pnone)"))
        return; /* inside a part or a page */
      const tabs = [...s.win.querySelectorAll(".hubtabs .ht")],
        i = tabs.findIndex(b => b.getAttribute("aria-selected") === "true");
      if (i < 0) return;
      const n = tabs[i + (dx < 0 ? 1 : -1)];
      if (!n) return;
      document.body.dataset.tgo = dx < 0 ? "l" : "r";
      n.click();
      n.scrollIntoView({ block: "nearest", inline: "nearest" });
      buzz(6);
      setTimeout(() => {
        delete document.body.dataset.tgo;
      }, 260);
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    "touchcancel",
    () => {
      if (t && t.mode === "pull") hidePill();
      t = null;
    },
    { passive: true, capture: true },
  );
}
