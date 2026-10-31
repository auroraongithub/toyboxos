/* Osage-chan (module id "buddy"), the study assistant: the agent loop and its tools. The model runs through the laptop server (/api/ai, which holds
   the OpenRouter key and the spend cap); the tools run here, on this device's data, so nothing is uploaded unless a tool
   reads it. Token thrift: the system prompt + tool list never change (they stay in the provider's prompt cache), history is
   append-only, long chats fold their older half into a summary, and tools return small slices (search first, then read). */
import { ls } from "./pref.js";
import { D, W } from "./store.js";
import { syncConfig, syncNow, syncState } from "./sync.js";
import { toast, warn } from "./bus.js";
import { fileUrl } from "./files.js";
import { today, fmt } from "./lib.js";
import { openMod } from "../shell/os.js";
import { storedCalls } from "./ai-calls.js";
import { buildSystem, person } from "./prompt.js";
import { on as featOn, hasCap } from "./features.js";
import { profile } from "./profile.js";
import { pack, AI } from "./pack.js";
import { isLocal, localModels, localBase, localName, localStatus, localLoad } from "./local-ai.js";
import { clip, refText, winLabel } from "./ai-look.js";
import { CUR, run, styleNotes, toolLabel } from "./ai-run.js";
import { KEEP_TURNS, RES_MAX, STUB_AT, WEBSEARCH, noteGroups, toolsFor, toolset } from "./ai-tools.js";

/* ---------- the server ---------- */
export const aiBase = () => {
  const c = syncConfig();
  return c.url && c.token ? c.url.replace(/\/+$/, "") : "";
};
const hdr = () => ({ Authorization: "Bearer " + syncConfig().token, "Content-Type": "application/json" });
export async function api(path, body) {
  const b = aiBase();
  if (!b) throw new Error("Connect Sync first (Start > Sync): " + AI.name + " runs through your server.");
  const r = await fetch(
    b + path,
    body === undefined ? { headers: hdr() } : { method: "POST", headers: hdr(), body: JSON.stringify(body) },
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || j.error || "Server " + r.status);
  return j;
}
export const usage = () => api("/api/ai/usage");

/* ---------- prompt (frozen: any change here re-bills the whole cached prefix once) ---------- */
/* rebuilt per request from the pack and the profile; the same text every time for the same profile (prompt cache) */
/* optional modules (core/features.js) decide which tools and prompt lines exist; with all of them on both are unchanged */
const can = k => (k === "github" ? featOn("changes") && hasCap("github") : featOn(k));
const SYSTEM = () => buildSystem(pack.ai, person(profile()), can);
const TOOLS = () => toolsFor(person(profile()), can);
const U = () => person(profile());

/* ---------- chats ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const chats = () =>
  D.chats.slice().sort((a, b) => String(b.upd || b.at).localeCompare(String(a.upd || a.at)));
export const msgsOf = id =>
  D.amsg.filter(m => m.c === id).sort((a, b) => (a.o || 0) - (b.o || 0) || (a._id < b._id ? -1 : 1));
export function newChat(o = {}) {
  const id = uid(),
    t = new Date().toISOString();
  W.set("chats", id, { title: "New chat", at: t, upd: t, src: [], sum: "", cut: 0, ...o });
  ls.set("os-ai-chat", id);
  return id;
}
export function draftMessage(text, { refs = [], img = [], title = "New chat" } = {}) {
  if (!aiBase()) throw new Error("Connect Sync first so " + AI.name + " can read the image.");
  newChat({ title });
  ls.set("os-ai-draft", { t: text, refs, img });
  openMod("buddy", true);
}
export function deleteChat(id) {
  const c = D.chats.find(x => x._id === id);
  if (!c) return;
  const ms = msgsOf(id);
  W.batch([["del", "chats", id], ...ms.map(m => ["del", "amsg", m._id])]);
  toast("Chat deleted", {
    label: "Undo",
    run: () => {
      const { _id, ...o } = c;
      W.batch([["set", "chats", id, o], ...ms.map(({ _id, ...m }) => ["set", "amsg", _id, m])]);
    },
  });
}
let seq = 0;
const add = (c, o) => {
  const id = uid();
  W.set("amsg", id, { c, o: Date.now() * 10 + (seq++ % 10), ...o });
  return id;
};

/* Keep fine print in timetable/receipt images legible; images still have a bounded size. */
const imgCache = new Map();
async function imgData(ref) {
  if (imgCache.has(ref)) return imgCache.get(ref);
  const u = await fileUrl(ref.replace(/^sos:/, ""));
  if (!u) throw new Error("Couldn't read the attached image. Attach it again.");
  const r = await fetch(u);
  if (!r.ok) throw new Error("Couldn't load the attached image. Attach it again.");
  const bmp = await createImageBitmap(await r.blob()),
    k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const d = cv.toDataURL("image/jpeg", 0.9);
  bmp.close();
  imgCache.set(ref, d);
  return d;
}
async function wire(chat) {
  const out = [{ role: "system", content: SYSTEM() }],
    notes = styleNotes();
  if (notes)
    out.push({
      role: "system",
      content: `${U().Poss} standing instructions for you (they win over the rules above):\n` + notes,
    });
  if (chat.sum)
    out.push(
      { role: "user", content: "[Summary of the earlier part of this chat]\n" + chat.sum },
      { role: "assistant", content: "Noted." },
    );
  const ms = msgsOf(chat._id).filter(m => (m.o || 0) >= (chat.cut || 0));
  /* big tool results from before the last KEEP_TURNS of his messages go as a short stub: her reply already used them, and
     every request would otherwise resend them in full. She can call the tool again when she needs the details. */
  const users = ms.filter(m => m.r === "user"),
    fresh = users.length > KEEP_TURNS ? users[users.length - KEEP_TURNS].o || 0 : -Infinity;
  const stub = m =>
    (m.o || 0) < fresh && (m.t || "").length > STUB_AT
      ? `[earlier ${m.n} result, ${m.t.length} chars, already used in the reply after it. Call ${m.n} again if you need the details.]\n` +
        clip(m.t, 300)
      : m.t;
  for (const m of ms) {
    if (m.r === "user") {
      const text = (m.ctx ? m.ctx + "\n\n" : "") + m.t + "\n\n[" + m.when + "]";
      if (m.img && m.img.length) {
        const parts = [{ type: "text", text }];
        for (const r of m.img) {
          const d = await imgData(r);
          if (d) parts.push({ type: "image_url", image_url: { url: d } });
        }
        out.push({ role: "user", content: parts });
      } else out.push({ role: "user", content: text });
    } else if (m.r === "assistant")
      out.push({
        role: "assistant",
        content: m.t || "",
        ...(m.tc && m.tc.length
          ? {
              tool_calls: m.tc.map(t => ({
                id: t.id,
                type: "function",
                function: { name: t.n, arguments: t.a },
                ...(t.x ? { extra_content: t.x } : {}),
              })),
            }
          : {}),
      });
    else if (m.r === "tool") out.push({ role: "tool", tool_call_id: m.ti, content: stub(m) });
  }
  return out;
}

/* ---------- streaming ---------- */
/* Called when he starts typing: a local model that isn't loaded yet starts loading now, so the cold start (~6 s) happens while he types */
let warmAt = 0;
export async function warmUp() {
  if (Date.now() - warmAt < 20000) return;
  warmAt = Date.now();
  const { models } = await localModels();
  let m = ls.get("os-ai-model", "");
  if (!models.includes(m)) m = aiBase() ? "" : models[0] || "";
  if (!m) return;
  const s = await localStatus(m);
  if (s && !s.loaded && !s.loading) localLoad(m);
}
async function open(body, signal) {
  let loc = isLocal(body.model) ? body.model : "",
    base = loc ? await localBase(loc) : "";
  if (loc && !base) {
    // the chosen local model isn't running: the server answers instead, if there is one
    if (!aiBase())
      throw new Error(
        "The local model isn't running. Start it with: python server/local-ai/local_ai.py start",
      );
    loc = "";
    body = { ...body, model: undefined };
  }
  if (!loc && !aiBase()) {
    loc = (await localModels()).models[0] || "";
    base = loc ? await localBase(loc) : "";
  }
  if (!loc) {
    const b = aiBase();
    if (!b) throw new Error("Connect Sync first (Start > Sync): " + AI.name + " runs through your server.");
    return {
      r: await fetch(b + "/api/ai", { method: "POST", headers: hdr(), body: JSON.stringify(body), signal }),
      loc,
    };
  }
  const { web, model, ...rest } = body; // no web search tool locally
  const find = web && aiBase(); // search runs on the server, so it needs Sync
  const DATE =
    "Today is " +
    fmt(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
    ". Your training data is older than this, so you don't know what is current.";
  const NOWEB = find
    ? DATE +
      ` You can search the web with web_search and then open a result with read_url. When ${U().he} ${U().v("asks")} for the latest, recent, current or up to date anything, news, prices, versions or \"what's new\", call web_search FIRST instead of answering from memory, and put the current year (` +
      today().slice(0, 4) +
      `) in the query, never a year from your training. Only open links that came from search results or that ${U().name} pasted; never guess, invent or complete a URL or website name. Base web answers on what you read and name the source. To search you MUST use the tool-calling feature, never write a call as text, code or tags. If ${U().he} ${U().v("asks")} for anything up to date, newer or recent, or you are unsure whether what you know is still current, search before answering; do not answer from memory.`
    : DATE +
      ` You have no web search on this model. read_url only works on a link ${U().name} pasted in this chat. Never guess, invent or complete a URL or website name; if ${U().he} ${U().v("asks")} for something that needs the web, say you can't look it up here and answer from what you know, saying so when you're unsure.`;
  const sys = (rest.messages || [])
    .filter(m => m.role === "system")
    .map(m => m.content)
    .concat(
      NOWEB,
      `The whole chat so far is above. When ${U().name} corrects ${U().self}, answers your question or says \"answer my question\", go back to what ${U().he} ${U().v("actually")} asked earlier and answer that now; never ask ${U().him} to repeat ${U().self}.`,
    )
    .join("\n\n"); // local chat templates (Qwen) accept only one system message, first
  if (find) rest.tools = [...(rest.tools || []), WEBSEARCH];
  if (sys)
    rest.messages = [{ role: "system", content: sys }, ...rest.messages.filter(m => m.role !== "system")];
  return {
    r: await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        ...rest,
        model: localName(loc),
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 4000,
        chat_template_kwargs: { enable_thinking: false },
      }),
    }),
    loc,
  };
}
async function stream(body, onDelta, signal) {
  const { r, loc } = await open(body, signal);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(
      j.msg || (j.error && j.error.message) || (loc ? "The local model" : "Server") + " answered " + r.status,
    );
  }
  const rd = r.body.getReader(),
    dec = new TextDecoder();
  let buf = "",
    text = "",
    calls = [],
    byIdx = {},
    fin = "",
    meta = null,
    cites = [],
    t0 = 0,
    t1 = 0,
    tim = null,
    ntok = 0;
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (d === "[DONE]") continue;
      let o;
      try {
        o = JSON.parse(d);
      } catch (e) {
        continue;
      }
      if (o.sos) {
        meta = o.sos;
        continue;
      }
      if (o.error) throw new Error(o.error.message || "The model stopped with an error.");
      if (o.timings) tim = o.timings;
      if (o.usage && o.usage.completion_tokens) ntok = o.usage.completion_tokens;
      const ch = o.choices && o.choices[0];
      if (!ch) continue;
      const dl = ch.delta || {};
      if (dl.content || dl.tool_calls) {
        t1 = performance.now();
        if (!t0) t0 = t1;
      }
      if (dl.content) {
        text += dl.content;
        onDelta(text);
      }
      /* Gemini sends parallel calls whole, all at index 0: a new id at the same index is a new call */
      (dl.tool_calls || []).forEach(t => {
        const k = t.index || 0;
        let c = byIdx[k];
        if (!c || (t.id && c.id && t.id !== c.id)) {
          c = byIdx[k] = { id: "", n: "", a: "" };
          calls.push(c);
        }
        if (t.id) c.id = t.id;
        if (t.extra_content) c.x = t.extra_content;
        if (t.function) {
          if (t.function.name) c.n += t.function.name;
          if (t.function.arguments) c.a += t.function.arguments;
        }
      });
      (dl.annotations || (ch.message && ch.message.annotations) || []).forEach(a => {
        if (a.type === "url_citation" && a.url_citation) cites.push(a.url_citation);
      });
      if (ch.finish_reason) fin = ch.finish_reason;
    }
  }
  /* tokens per second while she writes: llama-server reports it exactly, otherwise tokens over the time between first and last chunk */
  const tps =
    tim && tim.predicted_per_second
      ? tim.predicted_per_second
      : ntok > 1 && t1 > t0
        ? ntok / ((t1 - t0) / 1000)
        : 0;
  calls = calls.filter(c => c && c.n);
  /* small models sometimes write the call as text (web_search(q="...")) instead of using the tool feature: turn that into the real call */
  if (!calls.length && loc) {
    const names = (body.tools || []).map(t => t.function.name).concat(body.web ? ["web_search"] : []),
      t = text.trim(),
      m = t.match(/(?:^|\n)[ \t]*(\w+)\(([^\n]*)\)$/);
    if (m && names.includes(m[1])) {
      const a = {};
      m[2].replace(/(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,]+)/g, (_, k, v) => {
        a[k] = /^["']/.test(v)
          ? v.slice(1, -1).replace(/\\(.)/g, "$1")
          : /^-?\d+$/.test(v.trim())
            ? +v
            : v.trim();
      });
      calls = [{ id: "t" + Date.now().toString(36), n: m[1], a: JSON.stringify(a) }];
      text = t.slice(0, t.length - m[0].length).trim();
    }
  }
  return {
    text,
    calls,
    fin,
    meta: meta || (loc ? { model: loc } : null),
    cites,
    tps: tps > 0 ? Math.round(tps * 10) / 10 : 0,
  };
}

/* ---------- the loop ---------- */
const ST = {
  busy: false,
  chat: null,
  live: "",
  step: "",
  err: "",
  ctrl: null,
  month: null,
  cap: null,
  model: null,
  day: null,
  ask: null,
};
const subs = new Set();
export const aiState = ST;
export const onAI = f => {
  subs.add(f);
  return () => subs.delete(f);
};
const emit = () => subs.forEach(f => f());
export const stop = () => {
  if (ST.ctrl) ST.ctrl.abort();
};
const stampNow = () =>
  fmt(new Date(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const MAXSTEPS = 8,
  FOLD_AT = 48000,
  FULL = 0.95;
/* context settings (pref os-ai-ctx): win = use less than the model's window (0 = all of it),
   at = compact at this % of the window (0 = off: only when the model's own window is nearly full) */
export const CTX_STEPS = [32000, 64000, 128000, 256000, 512000];
export const ctxPrefs = () => ({ win: 0, at: 80, ...ls.get("os-ai-ctx", {}) });
export const ctxWindow = chat => {
  const w = ctxPrefs().win;
  return chat && chat.cmax ? (w && w < chat.cmax ? w : chat.cmax) : 0;
};
/* usage numbers from the server ride on the chat too (ctx = tokens the last request sent, cmax = the model's window), so the meter survives reloads */
const noteMeta = (chatId, m) => {
  Object.assign(ST, { month: m.month, cap: m.cap, model: m.model, day: m.day });
  const c = D.chats.find(x => x._id === chatId);
  if (!c) return;
  const ctx = m.cmax ? m.ctx || 0 : 0,
    cmax = m.cmax || 0;
  if ((c.ctx || 0) !== ctx || (c.cmax || 0) !== cmax) W.upd("chats", chatId, { ctx, cmax });
};

/* edit / undo / retry: drop a message and everything after it (Undo puts them back) */
export function rewind(chatId, msgId, { quiet } = {}) {
  const all = msgsOf(chatId),
    m = all.find(x => x._id === msgId);
  if (!m || ST.busy) return [];
  const gone = all.filter(x => (x.o || 0) >= (m.o || 0));
  W.batch(gone.map(x => ["del", "amsg", x._id]));
  if (!quiet)
    toast(gone.length > 1 ? "Removed " + gone.length + " messages" : "Removed the message", {
      label: "Undo",
      run: () => W.batch(gone.map(({ _id, ...x }) => ["set", "amsg", _id, x])),
    });
  return gone;
}
/* ask again: keep his last message, drop the replies after it, run the loop once more */
export function retry(chatId, msgId) {
  const all = msgsOf(chatId),
    m = all.find(x => x._id === msgId);
  if (!m || ST.busy) return;
  const u = all.filter(x => x.r === "user" && (x.o || 0) < (m.o || 0)).pop();
  if (!u) return;
  const after = all.find(x => (x.o || 0) > (u.o || 0));
  if (after) rewind(chatId, after._id, { quiet: true });
  send(chatId, "", { again: true });
}
/* DeepSeek likes em dashes even when told not to; outside code they become commas */
const undash = t =>
  String(t || "")
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((x, i) => (i % 2 ? x : x.replace(/\s*[—–]\s*(?=\d)/g, "-").replace(/\s*[—–]\s*/g, ", ")))
    .join("");

/* a plain command ("remind me 7pm review ch3", "todo read ch4", "spent 250 lunch") needs no model: run it the way the Today box would and answer in one line */
const CMD = /^(remind(\s+me)?|alarm|wake me|todo|spent|jot)\b/i;
async function shortcut(text) {
  const t = String(text || "").trim();
  if (!CMD.test(t) || t.length > 160 || /[?\n]/.test(t)) return null;
  const { best } = await import("../shell/route.js"),
    act = best(t);
  if (!act) return null;
  const keep = ["os-view", "os-open"].map(k => [k, ls.get(k)]);
  act.r();
  keep.forEach(([k, v]) => v !== undefined && ls.set(k, v));
  return "ok. " + act.l;
}

export async function send(chatId, text, { refs = [], ctx, img = [], again = false } = {}) {
  if (ST.busy) return;
  const plain = !refs.length && !img.length && !again;
  let chat = D.chats.find(c => c._id === chatId);
  if (!chat) {
    await new Promise(r => setTimeout(r, 60));
    chat = D.chats.find(c => c._id === chatId);
    if (!chat) return;
  }
  if (!again) {
    if (ctx && !refs.length) refs = [{ k: "win", id: ctx, l: winLabel(ctx) }];
    /* a mentioned source joins this chat, so later turns can keep searching it */
    const srcs = refs
      .filter(r => r.k === "src")
      .map(r => r.id)
      .filter(id => !(chat.src || []).includes(id));
    if (srcs.length) {
      W.upd("chats", chatId, { src: [...(chat.src || []), ...srcs] });
      chat = D.chats.find(c => c._id === chatId) || chat;
    }
    const ctxText = refs.map(refText).join("\n\n");
    add(chatId, {
      r: "user",
      t: text,
      ctx: ctxText || undefined,
      refs: refs.length ? refs.map(r => ({ k: r.k, id: r.id, l: r.l })) : undefined,
      img: img.length ? img : undefined,
      when: stampNow(),
    });
    if (chat.title === "New chat") W.upd("chats", chatId, { title: clip(text.replace(/\s+/g, " "), 48) });
    W.upd("chats", chatId, { upd: new Date().toISOString() });
  }
  if (plain) {
    let done = null;
    try {
      done = await shortcut(text);
    } catch (e) {
      warn("assistant", e);
    }
    if (done) {
      add(chatId, { r: "assistant", t: done });
      W.upd("chats", chatId, { upd: new Date().toISOString() });
      return;
    }
  }
  noteGroups(chatId, text);
  Object.assign(ST, { busy: true, chat: chatId, live: "", step: "", err: "", ctrl: new AbortController() });
  emit();
  try {
    /* through the server: the loop runs on the home server and keeps going if you leave the app (local models still loop here) */
    if (aiBase() && !isLocal(ls.get("os-ai-model", ""))) {
      const last = msgsOf(chatId).pop();
      const r = await api("/api/agent/start", {
        chat: chatId,
        messages: await wire(chat),
        tools: toolset(chatId),
        web: ls.get("os-ai-web", true),
        model: ls.get("os-ai-model", "") || undefined,
        o: last ? last.o : 0,
      });
      await follow(r);
      await fold(chatId);
      return;
    }
    const seen = new Set();
    let looped = false; // a small local model can repeat the same call forever: on a repeat the server's model takes over
    for (let step = 0; step < MAXSTEPS; step++) {
      chat = D.chats.find(c => c._id === chatId);
      CUR.chat = chat;
      const msgs = await wire(chat);
      const r = await stream(
        {
          messages: msgs,
          tools: toolset(chatId),
          web: ls.get("os-ai-web", true),
          model: (looped && aiBase() ? "" : ls.get("os-ai-model", "")) || undefined,
        },
        t => {
          ST.live = t;
          emit();
        },
        ST.ctrl.signal,
      );
      if (r.meta) noteMeta(chatId, r.meta);
      const t = undash(r.text);
      /* web citations ride along on the message (shown folded), not in the text the model sees again */
      const cites = [...new Map(r.cites.map(c => [c.url, c])).values()]
        .slice(0, 8)
        .map(c => [c.title || c.url, c.url]);
      const calls = storedCalls(r.calls, uid);
      add(chatId, {
        r: "assistant",
        t,
        tc: calls.length ? calls : undefined,
        cites: cites.length ? cites : undefined,
        tps: r.tps || undefined,
      });
      ST.live = "";
      emit();
      if (!calls.length) break;
      let asked = null;
      for (const c of calls) {
        if (ST.ctrl.signal.aborted) throw new DOMException("Stopped", "AbortError");
        if (c.n === "ask") {
          let q = {};
          try {
            q = JSON.parse(c.a || "{}");
          } catch {
            // bad arguments from the model: treated as none
          }
          asked = q;
          add(chatId, {
            r: "tool",
            ti: c.id,
            n: c.n,
            ok: true,
            t: `Asked ${U().name}. ${U().His} answer comes as ${U().his} next message.`,
          });
          continue;
        }
        let args = {};
        try {
          args = JSON.parse(c.a || "{}");
        } catch (e) {
          add(chatId, {
            r: "tool",
            ti: c.id,
            n: c.n,
            ok: false,
            t: "Those arguments weren't valid JSON; call again.",
          });
          continue;
        }
        const sig = c.n + "|" + (c.a || "");
        if (seen.has(sig)) {
          looped = true;
          add(chatId, {
            r: "tool",
            ti: c.id,
            n: c.n,
            ok: false,
            t: "You already ran this exact call and have its result above. Answer from it now.",
          });
          continue;
        }
        seen.add(sig);
        ST.step = toolLabel(c.n, args);
        emit();
        let res,
          ok = true;
        try {
          res = await run(c.n, args);
        } catch (e) {
          res = "Failed: " + e.message;
          ok = false;
        }
        add(chatId, { r: "tool", ti: c.id, n: c.n, ok, t: clip(res, RES_MAX) });
      }
      ST.step = "";
      if (asked) {
        add(chatId, {
          r: "assistant",
          t: String(asked.question || "Which one?"),
          ask: (asked.options || []).map(String).filter(Boolean).slice(0, 4),
        });
        break;
      }
      if (step === MAXSTEPS - 1)
        add(chatId, {
          r: "assistant",
          t: "(Stopped after " + MAXSTEPS + " steps. Say “go on” to continue.)",
        });
    }
    await fold(chatId);
  } catch (e) {
    if (e.name === "AbortError") {
      if (ST.live) add(chatId, { r: "assistant", t: ST.live + " …(stopped)" });
    } else ST.err = e.message;
  } finally {
    Object.assign(ST, { busy: false, live: "", step: "", ctrl: null });
    emit();
  }
}

/* Background runs (server/agent.py): watch one, pull the messages it writes into sync, and run the tools only the app can
   (look, show, control, approvals...) when it asks. If the app goes away the run carries on without us. */
const wait = ms => new Promise(r => setTimeout(r, ms));
const pullNow = async () => {
  for (let i = 0; i < 20 && syncState().state === "syncing"; i++) await wait(250);
  await syncNow();
};
async function follow(job) {
  const done = new Set();
  let n = 0,
    pull = false,
    miss = 0,
    stopped = false;
  for (;;) {
    if (ST.ctrl && ST.ctrl.signal.aborted && !stopped) {
      stopped = true;
      api("/api/agent/stop", { id: job.id }).catch(() => {});
    }
    let v;
    try {
      v = await api("/api/agent/poll", { id: job.id });
      miss = 0;
    } catch (e) {
      if (/No such run/.test(e.message) || ++miss > 40) {
        await syncNow();
        throw new Error(
          /No such run/.test(e.message)
            ? "The server restarted mid-reply. Say “go on” to continue."
            : e.message,
        );
      }
      await wait(1500);
      continue;
    }
    if (v.meta) noteMeta(job.chat, v.meta);
    ST.live = v.live || "";
    if (!v.pending) ST.step = v.step || "";
    emit();
    if (v.n !== n) {
      n = v.n;
      pull = true;
    }
    if (pull && syncState().state !== "syncing") {
      pull = false;
      syncNow();
    }
    if (v.pending && !done.has(v.pending.id)) {
      const p = v.pending;
      done.add(p.id);
      let args = {},
        res,
        ok = true;
      try {
        args = JSON.parse(p.a || "{}");
      } catch {
        // bad arguments from the model: treated as none
      }
      await pullNow();
      pull = false; // pages it just wrote on the server must be here before show/look use them
      ST.step = toolLabel(p.n, args);
      emit();
      try {
        res = await run(p.n, args);
      } catch (e) {
        res = "Failed: " + e.message;
        ok = false;
      }
      await api("/api/agent/result", { id: job.id, call: p.id, t: clip(String(res), RES_MAX), ok }).catch(
        () => {},
      );
      continue;
    }
    if (v.state !== "running") {
      await pullNow();
      if (v.state === "error") ST.err = v.err;
      if (document.hidden || !document.hasFocus())
        toast(AI.name + " finished: " + ((D.chats.find(c => c._id === job.chat) || {}).title || "chat"), {
          label: "Open",
          run: () => {
            ls.set("os-ai-chat", job.chat);
            openMod("buddy", true);
          },
        });
      return v;
    }
    await wait(document.hidden ? 3000 : 700);
  }
}
/* the app restarted while a run was going: pick it up again (called once after boot) */
export async function reattach() {
  if (ST.busy || !aiBase()) return;
  let a;
  try {
    a = await api("/api/agent/active", {});
  } catch (e) {
    return;
  }
  const r = (a.runs || []).find(x => x.state === "running");
  if (!r || ST.busy) return;
  Object.assign(ST, { busy: true, chat: r.chat, live: "", step: "", err: "", ctrl: new AbortController() });
  emit();
  try {
    await follow(r);
  } catch (e) {
    ST.err = e.message;
  } finally {
    Object.assign(ST, { busy: false, live: "", step: "", ctrl: null });
    emit();
  }
}

/* long chats: fold everything before the last few user turns into a short summary (one cheap call, then the prefix is small again).
   now = Compact now from the context panel: keeps only the last turn and skips the threshold */
async function fold(chatId, now = false) {
  const chat = D.chats.find(c => c._id === chatId);
  if (!chat) return false;
  const ms = msgsOf(chatId).filter(m => (m.o || 0) >= (chat.cut || 0));
  const size = ms.reduce((a, m) => a + (m.t || "").length + (m.ctx || "").length, 0);
  /* models with a known window compact at the chosen % of it (the server's own token count); the rest fold by size */
  const { at } = ctxPrefs(),
    lim = chat.cmax
      ? at
        ? (ctxWindow(chat) * at) / 100
        : chat.cmax * FULL
      : at
        ? (FOLD_AT * at) / 80
        : FOLD_AT * 2;
  if (!now && (chat.cmax ? chat.ctx || 0 : size) < lim) return false;
  const users = ms.filter(m => m.r === "user");
  if (users.length < (now ? 2 : 4)) return false;
  const keepFrom = users[users.length - (now ? 1 : 3)],
    old = ms.filter(m => m.o < keepFrom.o);
  const transcript = old
    .map(m =>
      m.r === "tool"
        ? `(tool ${m.n}: ${clip(m.t, 300)})`
        : `${m.r === "user" ? U().name : AI.name}: ${clip(m.t, 1500)}`,
    )
    .join("\n")
    .slice(-150000);
  const r = await stream(
    {
      messages: [
        {
          role: "system",
          content: `Summarise a study chat so it can continue without the transcript. Keep: what ${U().name} is studying, what ${U().he} ${U().v("understands")} or struggles with, quiz scores, decisions, pages/cards created, open questions. Under 220 words, plain notes.`,
        },
        {
          role: "user",
          content: (chat.sum ? "Earlier summary:\n" + chat.sum + "\n\n" : "") + "Transcript:\n" + transcript,
        },
      ],
      model: "utility",
    },
    () => {},
  ); // the server's cheap utility model (providers.json), never the paid chat model
  if (!r.text) return false;
  W.upd("chats", chatId, { sum: r.text.trim(), cut: keepFrom.o, ctx: 0 }); // ctx is measured again on the next reply
  if (chat.cmax && !now) toast(AI.name + " compacted this chat");
  return true;
}
export async function compactNow(chatId) {
  if (ST.busy || ST.folding) return toast("Wait for the reply to finish");
  ST.folding = true;
  emit();
  try {
    toast((await fold(chatId, true)) ? "Chat compacted" : "Nothing to compact yet");
  } catch (e) {
    toast("Couldn't compact: " + (e.message || e));
  }
  ST.folding = false;
  emit();
}

export { ST, TOOLS, U, emit };
export * from "./ai-tools.js";
export * from "./ai-look.js";
export * from "./ai-run.js";
