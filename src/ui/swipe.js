/* List rows (.lr) everywhere get the same gestures, built from the controls the row already has:
   swipe left = its Delete (Del) button, swipe right = its checkbox (done / not done), long-press or
   right-click = a menu with Edit (its .ed title), Done, Move (board arrows) and Delete. Pressing the
   row's own buttons means each module's own logic (and Undo toast) runs. On touch the × is hidden
   (styles/mobile.css). Vertical scrolling stays with the browser (touch-action: pan-y). */
import { actionSheet } from "./sheet.js";

const GO = 96,
  HOLD = 480;
const del = r => r.querySelector('.x1[aria-label="Delete"]');
const chk = r => r.querySelector(".ck[role=checkbox]");
const buzz = () => {
  if (navigator.vibrate)
    try {
      navigator.vibrate(10);
    } catch {
      // vibration is optional
    }
};

function rowMenu(r, at) {
  const a = [],
    ed = r.querySelector(".ed"),
    ck = chk(r),
    d = del(r);
  if (ed) a.push(["edit", "Edit", () => ed.click()]);
  if (ck)
    a.push([
      "applied",
      ck.getAttribute("aria-checked") === "true" ? "Mark not done" : "Mark done",
      () => ck.click(),
    ]);
  r.querySelectorAll('.x1[aria-label^="Move"]').forEach(b =>
    a.push(["board", b.getAttribute("aria-label"), () => b.click()]),
  );
  if (d) a.push("-", ["trash", "Delete", () => d.click(), { danger: 1 }]);
  if (!a.length) return false;
  const t = (r.querySelector(".tt") || r).innerText.trim().split("\n")[0].slice(0, 40);
  actionSheet(t || "Options", a, at);
  return true;
}

export function installSwipe() {
  let row = null,
    x0 = 0,
    y0 = 0,
    dx = 0,
    on = false,
    id = null,
    hold = 0,
    held = false;
  const reset = (r, anim) => {
    r.style.transition = anim ? "transform .18s ease-out" : "";
    r.style.transform = "";
    r.classList.remove("swp", "swl", "swr", "swgo");
  };
  /* the click that follows a swipe or long-press must not open the row */
  const eatClick = () => {
    const eat = ev => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", eat, true), 400);
    return eat;
  };
  document.addEventListener(
    "pointerdown",
    e => {
      if (e.pointerType !== "touch" || row) return;
      const t = e.target;
      if (t.closest("input,textarea,select,[contenteditable=true],.lr.edit,.bgrip")) return; // a board grip drags the card
      const r = t.closest(".lr");
      if (!r || !(del(r) || chk(r) || r.querySelector(".ed"))) return;
      row = r;
      x0 = e.clientX;
      y0 = e.clientY;
      dx = 0;
      on = false;
      held = false;
      id = e.pointerId;
      clearTimeout(hold);
      hold = setTimeout(() => {
        if (row !== r || on) return;
        held = true;
        buzz();
        rowMenu(r, { x: x0, y: y0 });
      }, HOLD);
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    e => {
      if (!row || e.pointerId !== id) return;
      const mx = e.clientX - x0,
        my = e.clientY - y0;
      if (Math.abs(mx) > 8 || Math.abs(my) > 8) clearTimeout(hold);
      if (held) return;
      if (!on) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
          row = null;
          return;
        }
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) && (mx < 0 ? del(row) : chk(row))) {
          on = true;
          row.classList.add("swp", mx < 0 ? "swl" : "swr");
          row.dataset.sw =
            mx < 0 ? "Delete" : chk(row).getAttribute("aria-checked") === "true" ? "Not done" : "Done";
          row.style.transition = "";
        } else return;
      }
      dx = row.classList.contains("swl") ? Math.min(0, mx) : Math.max(0, mx);
      row.style.transform = "translateX(" + dx + "px)";
      const go = Math.abs(dx) > GO;
      if (go !== row.classList.contains("swgo")) {
        row.classList.toggle("swgo", go);
        if (go) buzz();
      }
    },
    true,
  );
  const end = e => {
    if (!row || e.pointerId !== id) return;
    const r = row;
    row = null;
    clearTimeout(hold);
    if (held) {
      eatClick();
      return;
    }
    if (!on) return;
    const eat = eatClick();
    if (e.type === "pointerup" && Math.abs(dx) > GO) {
      if (dx < 0) {
        const b = del(r);
        r.style.transition = "transform .16s ease-in";
        r.style.transform = "translateX(-110%)";
        setTimeout(() => {
          reset(r);
          removeEventListener("click", eat, true);
          b && b.click();
        }, 160);
      } else {
        const c = chk(r);
        reset(r, true);
        removeEventListener("click", eat, true);
        c && c.click();
      }
    } else reset(r, true);
  };
  document.addEventListener("pointerup", end, true);
  document.addEventListener("pointercancel", end, true);
  /* mouse right-click (and the webview's own long-press event) opens the same menu */
  document.addEventListener(
    "contextmenu",
    e => {
      if (e.defaultPrevented || e.shiftKey) return;
      const t = e.target;
      if (t.closest("input,textarea,select,[contenteditable=true],.lr.edit,.bgrip")) return; // a board grip drags the card
      const r = t.closest(".lr");
      if (!r) return;
      if (held) {
        e.preventDefault();
        return;
      }
      if (rowMenu(r, { x: e.clientX, y: e.clientY })) e.preventDefault();
    },
    true,
  );
}
