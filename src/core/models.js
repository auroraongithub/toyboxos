/* One list of every model Osage can use: the server's catalogue (server/providers.json + ai.json, sent by /api/ai/usage with live
   state) plus models running on this machine (core/local-ai.js). The picker, the status line and the menu all read this, so a
   provider added on the server shows up here without app changes. Shape:
   [{id, label, local, free, ready, spent, cap, signup, models:[{id, label, price:[in,out,cached], context, free_day, used, vision, why}]}] */
import { localName } from "./local-ai.js";

export function catalogue(u, loc) {
  const server = (u && u.providers) || [];
  const here = (loc || []).length
    ? [
        {
          id: "local",
          label: "This PC",
          local: true,
          free: true,
          ready: true,
          models: loc.map(id => ({ id, label: localName(id), why: null })),
        },
      ]
    : [];
  return [...here, ...server];
}
export function findModel(cat, id) {
  for (const p of cat) {
    const m = p.models.find(x => x.id === id);
    if (m) return { p, m };
  }
  return null;
}
const k = n =>
  n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
export const usd = n => "$" + (n < 1 ? n.toFixed(3) : n.toFixed(2));
const per = n => "$" + (+n.toFixed(4)).toString();
/* the short line under a model in the picker: what it costs, how much context, why it can't run */
export function modelSub(p, m) {
  if (m.why) return m.why;
  const bits = [];
  if (p.local) bits.push("runs on this PC");
  else if (m.free_day) bits.push(m.free_day - (m.used || 0) + " free left today");
  else if (m.price && (m.price[0] || m.price[1]))
    bits.push(per(m.price[0]) + " in · " + per(m.price[1]) + " out per 1M");
  else if (m.price) bits.push("free");
  else bits.push(p.free ? "free" : "paid");
  if (m.context) bits.push(k(m.context) + " context");
  if (m.vision) bits.push("sees images");
  return bits.join(" · ");
}
/* the provider's line: its month's spend against its cap, or that it's free */
export function providerSub(p) {
  if (p.local) return "";
  if (!p.ready) return "no key on the server";
  if (p.cap != null) return usd(p.spent || 0) + " of " + usd(p.cap) + " this month";
  return p.free ? "free tier" : "";
}
