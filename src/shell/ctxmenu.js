/* the app's own right-click menu (replaces the webview's Back/Reload/Inspect menu in the native and installed app).
   Handlers that already own right-click (editor blocks, whiteboard, long-press menus) call preventDefault and are left alone. */
import { actionSheet } from "../ui/sheet.js";
import { openExternal } from "../core/lib.js";
import { toast, openCmd } from "../core/bus.js";
import { closeMod, toggleMin, resetWindows, openMod } from "./os.js";
import { ls } from "../core/pref.js";
import { tileWindows, isLocked, setLocked, maxWin, isMaxed } from "../ui/index.js";
import { setEditing } from "../core/layout.js";
import { openWinLook } from "./winlook.js";
import { SKINS, applySkin } from "./skins.js";
import { rename } from "./fun.js";
import { syncNow, syncConfig } from "../core/sync.js";

import { AI } from "../core/pack.js";
import { on as featOn } from "../core/features.js";
const native = !!window.__TAURI_INTERNALS__;
const appMode = () => native || matchMedia("(display-mode: standalone)").matches;
const SELECTABLE = ".md,pre,code,.bu .bt,.selectable"; // the same exceptions as xp-base.css's user-select:text
const editable = el =>
  el &&
  (el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && /^(text|search|url|email|number|password|tel|)$/.test(el.type)));

/* keep the caret/selection so Cut/Copy/Paste act on what was selected when the menu opened */
function snap(el) {
  if (el.isContentEditable) {
    const s = getSelection();
    const r = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    return () => {
      el.focus();
      if (r) {
        s.removeAllRanges();
        s.addRange(r);
      }
    };
  }
  const a = el.selectionStart,
    b = el.selectionEnd;
  return () => {
    el.focus();
    try {
      el.setSelectionRange(a, b);
    } catch {
      // some inputs don't support selection
    }
  };
}

/* groups of items with one divider between non-empty groups (never a leading, trailing or double one) */
const join = (...gs) =>
  gs
    .map(g => g.filter(Boolean))
    .filter(g => g.length)
    .flatMap((g, i) => (i ? ["-", ...g] : g));
const cmdItem = () => ["cmd", "Command bar", () => openCmd(), { sub: "Ctrl+K" }];
const reloadItem = () => ["reload", "Reload", () => location.reload()];

function fieldItems(el) {
  const back = snap(el),
    sel = el.isContentEditable
      ? String(getSelection())
      : (el.value || "").slice(el.selectionStart || 0, el.selectionEnd || 0);
  const ro = el.readOnly || el.disabled,
    run = c => () => {
      back();
      document.execCommand(c);
    };
  return join(
    ro
      ? []
      : [
          ["undo", "Undo", run("undo"), { sub: "Ctrl+Z" }],
          ["redo", "Redo", run("redo"), { sub: "Ctrl+Y" }],
        ],
    [
      !ro && sel ? ["cut", "Cut", run("cut"), { sub: "Ctrl+X" }] : null,
      sel ? ["copy", "Copy", run("copy"), { sub: "Ctrl+C" }] : null,
      !ro
        ? [
            "paste",
            "Paste",
            () => {
              navigator.clipboard
                .readText()
                .then(t => {
                  back();
                  document.execCommand("insertText", false, t);
                })
                .catch(() => {
                  back();
                  toast("Press Ctrl+V to paste");
                });
            },
            { sub: "Ctrl+V" },
          ]
        : null,
    ],
    [["selall", "Select all", run("selectAll"), { sub: "Ctrl+A" }]],
  );
}

/* pictures in notes and readers: copy (as png, the one type every clipboard takes) or save */
async function copyImage(src) {
  try {
    const bm = await createImageBitmap(await (await fetch(src)).blob()),
      c = Object.assign(document.createElement("canvas"), { width: bm.width, height: bm.height });
    c.getContext("2d").drawImage(bm, 0, 0);
    const png = await new Promise(r => c.toBlob(r, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast("Image copied");
  } catch {
    toast("Couldn't copy that image");
  }
}
const saveImage = (src, name) => {
  const a = Object.assign(document.createElement("a"), { href: src, download: name || "image" });
  document.body.append(a);
  a.click();
  a.remove();
};

const openIds = () => ls.get("os-open", []),
  minIds = () => ls.get("os-min", []);

/* the window items, the same in a window's own menu and on its taskbar button */
function winItems(id, bar) {
  const lk = isLocked(id),
    m = minIds().includes(id),
    big = isMaxed(id);
  return [
    [
      bar && !m ? ["up", "Bring to front", () => openMod(id, true)] : null,
      ["minus", m ? "Restore" : "Minimise", () => toggleMin(id)],
      lk
        ? null
        : [
            "layout",
            big ? "Restore size" : "Maximise",
            () => {
              if (m) toggleMin(id);
              maxWin(id);
              openMod(id, true);
            },
          ],
    ],
    [
      [lk ? "applied" : "lock", lk ? "Locked in place" : "Lock in place", () => setLocked(id, !lk)],
      ["theme", "Window look…", () => openWinLook(id)],
    ],
    [["close", "Close window", () => closeMod(id), { danger: 1 }]],
  ];
}

function menu(e) {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const at = { x: e.clientX, y: e.clientY };
  const a = t.closest("a[href]"),
    links =
      a && /^https?:/.test(a.href)
        ? [
            ["globe", "Open link", () => openExternal(a.href)],
            ["links", "Copy link", () => navigator.clipboard.writeText(a.href)],
          ]
        : [];
  if (editable(t)) {
    actionSheet("", join(links, fieldItems(t)), at);
    return;
  }
  const sel = String(getSelection()).trim(),
    img = t.tagName === "IMG" && t.closest(".md,.selectable") ? t : null,
    w = t.closest(".win[data-win]"),
    id = w && w.dataset.win,
    side = !!id && /^side/.test(id),
    short = sel.length > 24 ? sel.slice(0, 22).trim() + "…" : sel;
  const wg = id && !side && innerWidth > 860 && w.classList.contains("fl") ? winItems(id) : [];
  actionSheet(
    "",
    join(
      [
        sel
          ? [
              "copy",
              "Copy",
              () => navigator.clipboard.writeText(sel).catch(() => document.execCommand("copy")),
              { sub: "Ctrl+C" },
            ]
          : null,
        sel && sel.length < 200 ? ["search", "Search for “" + short + "”", () => openCmd(sel)] : null,
      ],
      links,
      img
        ? [
            ["copy", "Copy image", () => copyImage(img.src)],
            ["down", "Save image", () => saveImage(img.src, img.alt)],
          ]
        : [],
      [
        id && !side && id !== "buddy" && id !== "sync" && featOn("ai")
          ? [
              "buddy",
              "Ask " + AI.name + " about this",
              () => dispatchEvent(new CustomEvent("os-ask", { detail: id })),
            ]
          : null,
      ],
      side && w.classList.contains("clock-win")
        ? [
            [
              "close",
              "Hide the clock",
              () => {
                ls.set("os-side-clock", false);
                toast("Clock hidden (the taskbar has one)", {
                  label: "Undo",
                  run: () => ls.set("os-side-clock", true),
                });
              },
            ],
          ]
        : [],
      ...wg,
      [cmdItem(), reloadItem()],
    ),
    at,
  );
}

/* desktop: the wallpaper and the taskbar have their own menus, in the browser too */
const allMin = () => openIds().length && openIds().every(id => minIds().includes(id));
const showDesk = () => ls.set("os-min", allMin() ? [] : openIds());
const themeMenu = at => {
  const k = ls.get("os-skin", "gray");
  actionSheet(
    "Theme",
    [
      ...SKINS.map(([id, l]) => [
        k === id && !(ls.get("os-theme", null) || {}).on ? "applied" : "",
        l,
        () => applySkin(id),
      ]),
      "-",
      ["theme", "Theme editor…", () => openMod("theme", true)],
    ],
    at,
  );
};
const themeTab = tab => () => {
  ls.set("os-theme-tab", tab);
  openMod("theme", true);
};
const resetItem = () => [
  "reset",
  "Reset layout",
  () => {
    resetWindows();
    toast("Layout reset");
  },
];
const windowsGroup = () =>
  openIds().length
    ? [
        ["tile", "Tile windows", tileWindows, { sub: "Alt+T" }],
        ["desktop", allMin() ? "Show windows" : "Show desktop", showDesk],
      ]
    : [];
function deskMenu(e, t) {
  const at = { x: e.clientX, y: e.clientY };
  actionSheet(
    "",
    join(
      t.closest(".banner")
        ? [
            ["rename", "Rename…", rename],
            [
              "image",
              "Banner art…",
              () => {
                const own = (ls.get("os-theme", null) || {}).banner;
                if (own) ls.set("os-theme-focus", "pics");
                themeTab(own ? "colours" : "art")();
              },
            ],
          ]
        : [],
      t.closest(".badges") ? [["theme", "Edit badges…", themeTab("badges")]] : [],
      windowsGroup(),
      [["layout", "Edit layout…", () => setEditing(true)], resetItem()],
      [
        ["theme", "Theme…", () => themeMenu(at)],
        ls.get("os-side-clock", true) ? null : ["clock", "Show the clock", () => ls.set("os-side-clock", true)],
      ],
      [cmdItem(), reloadItem()],
    ),
    at,
  );
}
function closeAll() {
  const was = openIds();
  ls.set("os-open", []);
  toast("Closed " + was.length + (was.length === 1 ? " window" : " windows"), {
    label: "Undo",
    run: () => ls.set("os-open", was),
  });
}
function barMenu(e, t) {
  const at = { x: e.clientX, y: e.clientY },
    btn = t.closest(".tbtn[data-win]"),
    start = t.closest(".start");
  if (btn) return actionSheet("", join(...winItems(btn.dataset.win, true)), at);
  if (t.closest(".stray")) {
    const on = syncConfig().on;
    return actionSheet(
      "",
      [
        on ? ["sync", "Sync now", () => syncNow()] : null,
        ["sync", on ? "Sync settings…" : "Set up sync…", () => openMod("sync", true)],
      ].filter(Boolean),
      at,
    );
  }
  if (start)
    return actionSheet(
      "",
      join(
        [
          ["desktop", "Open Start", () => start.click()],
          ["rename", "Rename…", rename],
        ],
        [
          ["layout", "Edit layout…", () => setEditing(true)],
          ["theme", "Theme…", () => themeMenu(at)],
        ],
        [cmdItem()],
      ),
      at,
    );
  actionSheet(
    "",
    join(
      windowsGroup(),
      [openIds().length ? ["close", "Close all windows", closeAll] : null, resetItem()],
      [["sync", "Sync…", () => openMod("sync", true)], cmdItem()],
    ),
    at,
  );
}
const onDesk = t =>
  !t.closest(".win,.startmenu,.cmd,.sheet,.taskbar,a,button,input,textarea,select,[contenteditable=true]");

export function initContextMenu() {
  document.addEventListener("contextmenu", e => {
    if (e.defaultPrevented || e.shiftKey) return; // Shift+right-click still gives the webview menu (spellcheck, devtools)
    const t0 = e.target instanceof Element ? e.target : null;
    if (t0 && innerWidth > 860 && matchMedia("(pointer:fine)").matches) {
      if (t0.closest(".taskbar")) {
        e.preventDefault();
        barMenu(e, t0);
        return;
      }
      if (onDesk(t0) && !String(getSelection()).trim()) {
        e.preventDefault();
        deskMenu(e, t0);
        return;
      }
      /* a window's title bar (and the side clock) gets the window menu in the browser too (the content keeps the browser's own menu) */
      if (t0.closest(".win.fl > .tb, .clock-win")) {
        e.preventDefault();
        menu(e);
        return;
      }
    }
    if (!appMode()) return;
    if (matchMedia("(pointer:coarse)").matches && !matchMedia("(pointer:fine)").matches) {
      /* phones: a long-press in text is how Android opens its Cut/Copy/Paste/Select all bar, cancelling it hides that bar */
      const t = e.target instanceof Element ? e.target : null;
      if (!(t && (editable(t) || t.closest(SELECTABLE)))) e.preventDefault();
      return;
    }
    e.preventDefault();
    menu(e);
  });
}
