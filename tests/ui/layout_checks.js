// Layout checks run inside the page. Returns [kind, window id, description] for every problem found:
//   overflow  a control wider than its container
//   clipped   button text cut off
//   edge      a control touching its panel's edge (no breathing room)
//   foot      a form's Save row with empty space under it in a desktop window
//   cramped   stacked form rows with less than 4px between them
//   squashed  a multi-line text box shorter than two lines
//   noicon    a taskbar button without an icon
() => {
  const out = [];
  const seen = new Set();
  const visible = e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
  };
  const name = e =>
    (e.getAttribute("aria-label") || e.textContent || e.className || e.tagName)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 40);
  const add = (kind, e, msg) => {
    const win = e.closest(".win");
    const id = (win && win.dataset.win) || "-";
    const key = kind + id + name(e);
    if (seen.has(key)) return;
    seen.add(key);
    out.push([kind, id, name(e) + " " + msg]);
  };

  const scopes = [...document.querySelectorAll("#mcol .win, .sheet, .pop2, .startmenu:not([hidden])")].filter(
    visible,
  );
  for (const scope of scopes) {
    for (const b of scope.querySelectorAll(".btn, button, .field, select, .dsel, textarea")) {
      if (!visible(b) || b.closest(".pfill, .b88, .lkbtz, .wb, canvas")) continue;
      const parent = b.parentElement;
      const pr = parent.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      const ps = getComputedStyle(parent);
      const sticksOut = r.width > pr.width + 1 || (r.left < pr.left - 1 && ps.display !== "contents");
      if (ps.overflowX === "visible" && sticksOut)
        add("overflow", b, `${Math.round(r.width)}px in ${Math.round(pr.width)}px ${parent.className}`);
      const bs = getComputedStyle(b);
      if (
        b.matches(".btn, button") &&
        b.scrollWidth > b.clientWidth + 2 &&
        bs.overflow !== "visible" &&
        bs.textOverflow !== "ellipsis" &&
        !b.querySelector("span[style*=ellipsis]")
      )
        add("clipped", b, `${b.scrollWidth}>${b.clientWidth}`);
      const panel = b.closest(".panel, .sheet .bd, .win");
      if (panel && !b.closest(".tools, .tabs, .tb, .btools, .kbar, .acbar")) {
        const q = panel.getBoundingClientRect();
        const dl = r.left - q.left;
        const dt = r.top - q.top;
        if ((dl >= -0.5 && dl < 2) || (dt >= -0.5 && dt < 2))
          add("edge", b, `left ${Math.round(dl)} top ${Math.round(dt)} in ${panel.className}`);
      }
    }
    for (const t of scope.querySelectorAll(".panel > .tools")) {
      if (!visible(t)) continue;
      const panel = t.parentElement;
      const kids = [...panel.children].filter(k => visible(k) && !k.classList.contains("pfill"));
      if (kids[kids.length - 1] !== t || !scope.classList.contains("fl")) continue;
      const gap = panel.getBoundingClientRect().bottom - t.getBoundingClientRect().bottom;
      if (gap > 12) add("foot", t, `${Math.round(gap)}px empty under it`);
    }
    for (const g of scope.querySelectorAll(".pfg, .su-body, .bd-props, .lkai")) {
      const rows = [...g.children].filter(k => visible(k) && /^(LABEL|DIV)$/.test(k.tagName));
      for (let i = 1; i < rows.length; i++) {
        const gap = rows[i].getBoundingClientRect().top - rows[i - 1].getBoundingClientRect().bottom;
        if (gap < 4 && gap > -1) add("cramped", rows[i], `${Math.round(gap)}px gap in ${g.className}`);
      }
    }
  }
  for (const t of document.querySelectorAll("textarea")) {
    const tall = t.getBoundingClientRect().height;
    if (visible(t) && (+t.getAttribute("rows") || 2) >= 2 && tall < 46)
      add("squashed", t, Math.round(tall) + "px tall");
  }
  for (const b of document.querySelectorAll(".taskbar .tasks .tbtn"))
    if (!b.querySelector("svg")) add("noicon", b, "");
  return out;
};
