/* Studying: subjects hold pages (page.parent). Flashcards live on the page as `deck` [{q,a}] (kept out of the
   note itself; the Flashcards panel under the title edits them); older `term :: answer` lines in a body still count,
   and review.exe schedules them (SM-2-ish). Card progress lives in `cards` (id = page + hash of the term), so it syncs. */
import { useState, useEffect } from "preact/hooks";
import { html, today, addDays, plural, TZ } from "../core/lib.js";
import { useCols, W, D } from "../core/store.js";
import { Btn, Icon, Field, Del, EditRow, Empty } from "../ui/index.js";
import { parse, serialize, toHTML } from "../core/blocks.js";
import { toast } from "../core/bus.js";
import { pushBack, dropBack } from "../core/back.js";

const hash = s => {
  let h = 5381;
  for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
};
export const cardId = (page, q) => page + "-" + hash(String(q).trim().toLowerCase());
/* add cards to a page's deck (same question = replaced) */
export function addCards(p, list) {
  const deck = (p.deck || []).slice();
  list.forEach(({ q, a }) => {
    q = String(q || "").trim();
    a = String(a || "").trim();
    if (!q || !a) return;
    const i = deck.findIndex(c => c.q.trim().toLowerCase() === q.toLowerCase());
    if (i >= 0) deck[i] = { q, a };
    else deck.push({ q, a });
  });
  W.upd("pages", p._id, { deck, upd: new Date().toISOString() });
  return deck.length;
}
export const kids = id => D.pages.filter(p => p.parent === id);
export function family(id) {
  const out = [id],
    seen = new Set(out);
  for (let i = 0; i < out.length; i++)
    D.pages.forEach(p => {
      if (p.parent === out[i] && !seen.has(p._id)) {
        seen.add(p._id);
        out.push(p._id);
      }
    });
  return out;
}
export const ancestors = p => {
  const out = [];
  let c = p,
    n = 0;
  while (c && c.parent && n++ < 20) {
    c = D.pages.find(x => x._id === c.parent);
    if (c) out.unshift(c);
  }
  return out;
};
export const subjectOf = p =>
  p &&
  (p.kind === "subject"
    ? p
    : ancestors(p)
        .reverse()
        .find(a => a.kind === "subject"));

/* every card in these pages (all pages if ids is null) */
export function cardsIn(ids) {
  const set = ids ? new Set(ids) : null,
    out = [];
  D.pages.forEach(p => {
    if (set && !set.has(p._id)) return;
    (p.deck || []).forEach(c => {
      if (c && String(c.q || "").trim() && String(c.a || "").trim())
        out.push({ id: cardId(p._id, c.q), page: p._id, q: c.q, a: c.a, deck: 1 });
    });
    if (/\s::\s/.test(p.body || ""))
      parse(p.body).forEach(b => {
        if (b.t === "card" && b.q.trim() && b.a.trim())
          out.push({ id: cardId(p._id, b.q), page: p._id, q: b.q, a: b.a });
      });
  });
  return out;
}
const st = id => D.cards.find(c => c._id === id);
export const isDue = c => {
  const s = st(c.id);
  return !s || !s.due || s.due <= today();
};
export const dueIn = ids => cardsIn(ids).filter(isDue);

/* grade: 0 again, 1 hard, 2 good, 3 easy -> next interval in days */
export function next(id, g) {
  const s = st(id) || { reps: 0, ivl: 0, ease: 2.5, lapses: 0 };
  let { reps = 0, ivl = 0, ease = 2.5, lapses = 0 } = s;
  if (g === 0) {
    lapses++;
    reps = 0;
    ivl = 0;
    ease = Math.max(1.3, ease - 0.2);
  } else if (g === 1) {
    ivl = Math.max(1, Math.round((ivl || 1) * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    reps++;
  } else if (g === 2) {
    ivl = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(ivl * ease);
    reps++;
  } else {
    ivl = reps === 0 ? 3 : Math.round(Math.max(ivl, 1) * ease * 1.3);
    ease += 0.15;
    reps++;
  }
  return { reps, ivl, ease: +ease.toFixed(2), lapses, due: addDays(today(), ivl) };
}
const label = d => (d <= 0 ? "now" : d === 1 ? "1 day" : d < 30 ? d + " days" : Math.round(d / 30) + " mo");

/* ---- review.exe: one host in the shell, started from anywhere ---- */
const R = { on: false, title: "", queue: [], i: 0, show: false, done: 0 };
const subs = new Set();
const emit = () => subs.forEach(f => f());
export function startReview(ids, title) {
  const due = dueIn(ids);
  const fresh = due.filter(c => !st(c.id)).slice(0, 20),
    old = due.filter(c => st(c.id));
  const q = [...old, ...fresh].sort(() => Math.random() - 0.5);
  const was = R.on;
  Object.assign(R, { on: true, title: title || "All subjects", queue: q, i: 0, show: false, done: 0 });
  emit();
  if (!was) pushBack("review", () => close(true));
}
const close = viaBack => {
  if (!R.on) return;
  R.on = false;
  emit();
  if (viaBack !== true) dropBack("review");
};
function grade(g) {
  const c = R.queue[R.i];
  if (!c) return;
  W.set("cards", c.id, { page: c.page, ...next(c.id, g) });
  if (g === 0) R.queue.push(c); /* see it again this session */
  R.i++;
  R.done++;
  R.show = false;
  emit();
}
export function ReviewHost() {
  const [, t] = useState(0);
  useCols("cards", "pages");
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  useEffect(() => {
    if (!R.on) return;
    const k = e => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape") close();
      else if (!R.show && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        R.show = true;
        emit();
      } else if (R.show && "1234".includes(e.key)) grade(+e.key - 1);
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [R.on]);
  if (!R.on) return null;
  const c = R.queue[R.i],
    left = R.queue.length - R.i,
    p = c && D.pages.find(x => x._id === c.page);
  return html`<div class="rv" onClick=${e => {
    if (e.target === e.currentTarget) close();
  }}>
    <section class="win rvw" aria-label="Flashcard review">
      <div class="tb"><span class="t">review · ${R.title}</span><span class="cap x" role="button" tabindex="0" aria-label="Close" onClick=${close}><i/></span></div>
      ${
        c
          ? html`<div class="rvb">
          <div class="rvm"><span>${p ? (p.icon || "") + " " + p.title : ""}</span><span>${plural(left, "card")} left</span></div>
          <div class="rvq" dangerouslySetInnerHTML=${{ __html: toHTML(c.q) }}/>
          ${R.show ? html`<div class="rva" dangerouslySetInnerHTML=${{ __html: toHTML(c.a) }}/>` : null}
        </div>
        <div class="rvf">${
          R.show
            ? [
                ["Again", 0],
                ["Hard", 1],
                ["Good", 2],
                ["Easy", 3],
              ].map(
                ([l, g]) =>
                  html`<${Btn} go=${g === 2} onClick=${() => grade(g)}><span class="rvl">${l}<small>${label(next(c.id, g).ivl)}</small></span><//>`,
              )
            : html`<${Btn} go wide=${200} onClick=${() => {
                R.show = true;
                emit();
              }}>Show answer<//>`
        }</div>`
          : html`<div class="rvb rvdone"><b>${R.done ? "Done for now." : "Nothing due."}</b><p>${R.done ? plural(R.done, "card") + " reviewed." : "Add flashcards from a page: ⋯ > Flashcards."}</p><${Btn} go onClick=${close}>Close<//></div>`
      }
      ${matchMedia("(pointer:fine)").matches ? html`<div class="statusbar"><span>Space: show</span><span>1-4: grade</span><span>Esc: close</span><span/></div>` : null}
    </section></div>`;
}

/* the box at the top of a subject (or any page with sub-pages / cards) */
export function StudyBox({ p, open, make, calItems, bare }) {
  useCols("cards", "pages", "classes", "events");
  const fam = family(p._id),
    all = cardsIn(fam),
    due = all.filter(isDue),
    ch = kids(p._id).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const code = (p.props || []).find(x => /course|code/i.test(x[0]));
  const cc = code && code[1].trim().toLowerCase();
  const now = Date.now(),
    dl = cc
      ? calItems()
          .filter(
            x =>
              !x.done &&
              x.kind !== "opens" &&
              x.e > now - 864e5 &&
              (String(x.code).toLowerCase().includes(cc) || String(x.title).toLowerCase().includes(cc)),
          )
          .slice(0, 4)
      : [];
  if (p.kind !== "subject" && !ch.length && !all.length && !bare) return null;
  return html`<div class="sbx">
    ${
      !bare && (all.length || p.kind === "subject")
        ? html`<div class="sbr"><${Icon} n="cards"/><span><b>${plural(all.length, "flashcard")}</b>${due.length ? " · " + due.length + " due" : all.length ? " · all caught up" : " · add some with term :: answer"}</span>
      ${due.length ? html`<${Btn} go icon="play" onClick=${() => startReview(fam, p.title)}>Review<//>` : null}</div>`
        : null
    }
    ${dl.length ? html`<div class="sbl"><small>Deadlines</small>${dl.map(x => html`<div class="sbi"><span class="d">${new Date(x.t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" })}</span><span>${x.title}</span></div>`)}</div>` : null}
    ${
      ch.length || p.kind === "subject" || bare
        ? html`<div class="sbl"><small>${p.kind === "subject" ? "Pages in this subject" : "Sub-pages"}</small>
      ${ch.map(c => html`<button class="blk" key=${c._id} onClick=${() => open(c._id)}>${c.icon ? html`<span class="emj">${c.icon}</span>` : html`<${Icon} n=${c.kind || "note"}/>`}${c.title}${kids(c._id).length ? html`<small>${kids(c._id).length}</small>` : null}</button>`)}
      <button class="ppadd" onClick=${make}><${Icon} n="plus"/>New page here</button></div>`
        : null
    }
  </div>`;
}

/* the Flashcards panel on a page: the deck, a two-box add row, and a one-tap move for old `term :: answer` lines */
export function Deck({ p }) {
  useCols("pages", "cards");
  const [q, setQ] = useState(""),
    [a, setA] = useState(""),
    [edit, setEdit] = useState(-1);
  const deck = p.deck || [],
    inBody = cardsIn([p._id]).filter(c => !c.deck),
    fam = family(p._id),
    due = dueIn(fam);
  const add = () => {
    if (!q.trim() || !a.trim()) return;
    addCards(p, [{ q, a }]);
    setQ("");
    setA("");
  };
  const save = l => W.upd("pages", p._id, { deck: l, upd: new Date().toISOString() });
  const moveOut = () => {
    const bs = parse(p.body || ""),
      cards = bs.filter(b => b.t === "card"),
      d = deck.slice();
    cards.forEach(b => {
      const q = b.q.trim(),
        a = b.a.trim();
      if (!q || !a) return;
      const k = d.findIndex(c => c.q.trim().toLowerCase() === q.toLowerCase());
      if (k >= 0) d[k] = { q, a };
      else d.push({ q, a });
    });
    W.upd("pages", p._id, {
      body: serialize(bs.filter(b => b.t !== "card")),
      deck: d,
      upd: new Date().toISOString(),
    });
    toast("Moved " + plural(cards.length, "card") + " out of the note");
  };
  return html`<div class="dk">
    <div class="dkh"><small>Flashcards${deck.length + inBody.length ? " · " + (deck.length + inBody.length) : ""}</small>${due.length ? html`<${Btn} go icon="play" onClick=${() => startReview(fam, p.title)}>Review ${due.length}<//>` : null}</div>
    ${deck.map((c, i) =>
      edit === i
        ? html`<${EditRow} key=${"e" + i} specs=${[
            { k: "q", t: "text", ph: "Front", w: "w" },
            { k: "a", t: "text", ph: "Back", w: "w" },
          ]} init=${c}
        onSave=${o => {
          if (o.q && o.a) save(deck.map((x, j) => (j === i ? { q: o.q, a: o.a } : x)));
        }} onCancel=${() => setEdit(-1)}/>`
        : html`<div class="lr dkr" key=${i}><span class="tt ed" onClick=${() => setEdit(i)}><b>${c.q}</b><small>${c.a}</small></span><${Del} onClick=${() => {
            const old = deck;
            save(deck.filter((_, j) => j !== i));
            toast("Card deleted", { label: "Undo", run: () => save(old) });
          }}/></div>`,
    )}
    ${inBody.length ? html`<div class="dkm"><span>${plural(inBody.length, "card")} written in the note</span><${Btn} onClick=${moveOut}>Move here<//></div>` : null}
    ${!deck.length && !inBody.length ? html`<${Empty}>No cards yet. Front: a term or question, back: the answer.<//>` : null}
    <div class="dka"><${Field} w="w" placeholder="Front" aria-label="Card front" value=${q} onInput=${e => setQ(e.target.value)} onEnter=${() => document.querySelector(".dka .field:nth-child(2)")?.focus()}/>
      <${Field} w="w" placeholder="Back" aria-label="Card back" value=${a} onInput=${e => setA(e.target.value)} onEnter=${add}/><${Btn} go icon="plus" aria-label="Add card" onClick=${add}/></div>
  </div>`;
}
