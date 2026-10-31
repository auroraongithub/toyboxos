/* One sheet host for the whole app: a bottom sheet on phones, a popover next to what you tapped on desktop.
   openSheet({title, Body, props, at}) -> Body gets {...props, close}. askText() replaces prompt() (blocked in app webviews). */
import { useState, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../core/lib.js";
import { Icon } from "./icons.js";
import { pushBack, dropBack } from "../core/back.js";

const S = { cur: null };
const subs = new Set();
const emit = () => subs.forEach(f => f());
const phone = () => matchMedia("(max-width:860px)").matches;
/* at: an element, a DOMRect, or {x,y}; ignored on phones */
export function openSheet(o) {
  const was = !!S.cur;
  if (S.cur && S.cur.onClose) S.cur.onClose();
  S.cur = { ...o, k: Date.now() };
  emit();
  if (!was) pushBack("sheet", () => closeSheet(true));
}
export function closeSheet(viaBack) {
  const c = S.cur;
  if (!c) return;
  S.cur = null;
  emit();
  if (viaBack !== true) dropBack("sheet");
  if (c.onClose) c.onClose();
}
export const sheetOpen = () => !!S.cur;

/* phones: pull a bottom sheet down by its handle or title bar to close it */
export function dragClose(close) {
  let y0 = null,
    el = null;
  const settle = d => {
    if (!el) return;
    const e = el;
    e.style.transition = "transform .18s ease-out";
    if (d > 80) {
      e.style.transform = "translateY(100%)";
      setTimeout(() => {
        e.style.transform = "";
        e.style.transition = "";
        close();
      }, 170);
    } else e.style.transform = "";
  };
  return {
    onPointerDown: e => {
      if (e.pointerType === "mouse" || e.target.closest("button,[role=button],input")) return;
      el = e.currentTarget.closest(".sheet,.startmenu");
      if (!el) return;
      y0 = e.clientY;
      el.style.transition = "none";
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // the pointer already ended
      }
    },
    onPointerMove: e => {
      if (y0 == null) return;
      el.style.transform = "translateY(" + Math.max(0, e.clientY - y0) + "px)";
    },
    onPointerUp: e => {
      if (y0 == null) return;
      const d = e.clientY - y0;
      y0 = null;
      settle(d);
    },
    onPointerCancel: () => {
      if (y0 == null) return;
      y0 = null;
      settle(0);
    },
  };
}

export function SheetHost() {
  const [, t] = useState(0);
  const box = useRef();
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  const c = S.cur,
    mob = phone();
  useEffect(() => {
    if (!c) return;
    const k = e => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSheet();
      }
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [c && c.k]);
  /* desktop: place beside the anchor, flip up/left so it stays on screen */
  useLayoutEffect(() => {
    if (!c || mob || !box.current) {
      setPos(null);
      return;
    }
    const a =
      c.at && c.at.getBoundingClientRect
        ? c.at.getBoundingClientRect()
        : c.at || { x: innerWidth / 2 - 130, y: innerHeight / 3 };
    const ax = a.left != null ? a.left : a.x,
      ay = a.bottom != null ? a.bottom : a.y,
      top = a.top != null ? a.top : a.y;
    const w = box.current.offsetWidth,
      h = box.current.offsetHeight;
    let x = Math.min(ax, innerWidth - w - 8),
      y = ay + 4;
    if (y + h > innerHeight - 46) y = Math.max(8, top - h - 4);
    setPos({ x: Math.max(8, x), y });
  }, [c && c.k, mob]);
  if (!c) return null;
  const B = c.Body;
  if (mob)
    return html`<div class="shb" onClick=${e => {
      if (e.target === e.currentTarget) closeSheet();
    }}>
    <section class="win sheet" role="dialog" aria-label=${c.title || "Options"} key=${c.k}>
      <div class="grab" aria-hidden="true" ...${dragClose(closeSheet)}><i/></div>
      <div class="tb" ...${dragClose(closeSheet)}><span class="t">${c.title || "Options"}</span><span class="cap x" role="button" tabindex="0" aria-label="Close" onClick=${closeSheet}><i/></span></div>
      <div class="shc"><${B} ...${c.props || {}} close=${closeSheet}/></div>
    </section></div>`;
  return html`<div class="shb dt" onPointerDown=${e => {
    if (e.target === e.currentTarget) closeSheet();
  }}>
    <div ref=${box} class="pop2" role="dialog" aria-label=${c.title || "Options"} key=${c.k} style=${pos ? "left:" + pos.x + "px;top:" + pos.y + "px" : "visibility:hidden"}>
      ${c.title ? html`<small class="pth">${c.title}</small>` : null}<${B} ...${c.props || {}} close=${closeSheet}/></div></div>`;
}

/* a list of actions: [icon,label,fn,{danger,on,sub,press}] or "-" for a divider; press(el) = long-press / right-click on that row */
export function Actions({ items, close }) {
  const [gone, setGone] = useState({});
  const [m, setM] = useState(null); // gone = rows removed in place, m = the row's own small menu (opt.menu), shown over the list so the list stays
  const row = (it, i) => {
    const o = it[3] || {};
    return html`<button class=${"mi" + (o.danger ? " dgr" : "") + (o.on ? " on" : "")} onClick=${() => {
      close();
      it[2]();
    }} ...${
      o.menu
        ? longPress(el => {
            const r = el.getBoundingClientRect();
            setM({ i, m: o.menu, x: r.left + 12, y: r.bottom - 4 });
          })
        : o.press
          ? longPress(o.press)
          : {}
    }>${it[0] ? html`<${Icon} n=${it[0]}/>` : null}<span>${it[1]}</span>${o.sub ? html`<em>${o.sub}</em>` : null}</button>`;
  };
  return html`<div class="acts">${items.map((it, i) => (!it || gone[i] ? null : it === "-" ? html`<div class="sep"/>` : row(it, i)))}
    ${
      m
        ? html`<div class="ctxb" onPointerDown=${() => setM(null)} onContextMenu=${e => {
            e.preventDefault();
            setM(null);
          }}/>
      <div class="ctxm" style=${"left:" + Math.min(m.x, innerWidth - 170) + "px;top:" + Math.min(m.y, innerHeight - 60) + "px"}>${m.m.map(
        a =>
          html`<button class=${"mi" + (a[3] && a[3].danger ? " dgr" : "")} onClick=${() => {
            setM(null);
            a[2]();
            setGone(g => ({ ...g, [m.i]: 1 }));
          }}><${Icon} n=${a[0]}/><span>${a[1]}</span></button>`,
      )}</div>`
        : null
    }</div>`;
}
export const actionSheet = (title, items, at) => openSheet({ title, Body: Actions, props: { items }, at });

function Ask({ label, value, placeholder, ok, extra, done, close, multi, secret }) {
  const [v, setV] = useState(value || "");
  const r = useRef();
  useEffect(() => {
    setTimeout(() => {
      if (r.current) {
        r.current.focus();
        r.current.select();
      }
    }, 60);
  }, []);
  const go = x => {
    done.v = true;
    close();
    done.f(x);
  };
  return html`<form class="ask" onSubmit=${e => {
    e.preventDefault();
    go(v);
  }}>
    ${label ? html`<label>${label}</label>` : null}
    ${
      multi
        ? html`<textarea ref=${r} class="field ask-ml" rows="8" value=${v} placeholder=${placeholder || ""} onInput=${e => setV(e.target.value)}/>`
        : html`<input ref=${r} class="field" type=${secret ? "password" : "text"} value=${v} placeholder=${placeholder || ""} onInput=${e => setV(e.target.value)} autocapitalize="off" autocomplete="off"/>`
    }
    <div class="askb">${extra ? html`<button type="button" class="btn" onClick=${() => go(extra[1])}>${extra[0]}</button>` : null}<span/>
      <button type="button" class="btn" onClick=${() => {
        done.v = true;
        close();
        done.f(null);
      }}>Cancel</button><button class="btn go">${ok || "OK"}</button></div></form>`;
}
/* resolves to the text, null on cancel; extra = [label, valueToResolve] adds a third button (e.g. Remove link) */
export function askText(o) {
  return new Promise(res => {
    const done = { v: false, f: res };
    openSheet({
      title: o.title,
      Body: Ask,
      props: { ...o, done },
      at: o.at,
      onClose: () => {
        if (!done.v) res(null);
      },
    });
  });
}

/* long-press (touch) or right-click (mouse) -> fn(event target). Spread onto the element. */
export function longPress(fn) {
  let t = 0,
    x = 0,
    y = 0,
    fired = false;
  const cancel = () => clearTimeout(t);
  return {
    onPointerDown: e => {
      if (e.pointerType === "mouse") return;
      fired = false;
      x = e.clientX;
      y = e.clientY;
      const el = e.currentTarget;
      cancel();
      t = setTimeout(() => {
        fired = true;
        if (navigator.vibrate)
          try {
            navigator.vibrate(12);
          } catch {
            // vibration is optional
          }
        fn(el);
      }, 480);
    },
    onPointerMove: e => {
      if (Math.abs(e.clientX - x) > 8 || Math.abs(e.clientY - y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: e => {
      e.preventDefault();
      cancel();
      if (!fired) fn(e.currentTarget);
      fired = false;
    },
    onClickCapture: e => {
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
        fired = false;
      }
    },
  };
}
