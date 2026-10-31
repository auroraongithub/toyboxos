/* Turns whatever was typed into actions: the literal verb first ("todo x"), then what it most likely means
   ("remind me to...", "alrm 7am", "quiz fri 3pm", "₱250 lunch"). Used by the command bar and Today's quick add. */
import { liveModules } from "../modules/index.js";
import { intent, guess } from "../core/nlp.js";

const ask = (v, arg, q) => (v ? liveModules().flatMap(mod => (mod.cmd ? mod.cmd(v, arg, q) : [])) : []);
const real = a => !a.hint && a.r && !/^Open /.test(a.l);

export function route(q) {
  const s = String(q || "").trim();
  if (!s) return [];
  const m = s.match(/^(\S+)(?:\s+([\s\S]*))?$/),
    raw = ask(m[1].toLowerCase(), (m[2] || "").trim(), s);
  const it = intent(s);
  let out = [];
  // a phrase like "remind me to" beats the literal first word; otherwise the literal verb wins
  const smart = it.v ? ask(it.v, it.arg, s) : [];
  out = raw.some(real) ? raw.concat(smart) : smart.some(real) ? smart.concat(raw) : raw.concat(smart);
  // the verb didn't fit ("pay rent fri" has no amount): fall back to what the text looks like
  if (!out.some(real) && !it.guessed) {
    const g = guess(s);
    if (g.v) out = out.concat(ask(g.v, g.arg, s));
  }
  // something with a time: also offer it as a reminder or alarm
  const top = out.find(real);
  if (top && top.icon === "calendar" && it.guessed) out = out.concat(ask("remind", s, s), ask("alarm", s, s));
  const seen = new Set();
  return out.filter(a => {
    const k = a.l;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
/* the one action Today's box would run (null = it becomes a jot / page) */
export const best = q => route(q).find(real) || null;
/* the + sheet on a screen: what you type means that screen's thing ("250 lunch" on Money = spent),
   unless it starts with its own verb or phrase ("remind me to...", "jot ...") */
export function bestIn(q, ctx) {
  const s = String(q || "").trim();
  if (!s || !ctx) return best(s);
  const it = intent(s),
    said = ask(s.split(/\s+/)[0].toLowerCase(), "x", s).some(real) || (it.v && !it.guessed);
  return said ? best(s) : best(ctx + " " + s) || best(s);
}
