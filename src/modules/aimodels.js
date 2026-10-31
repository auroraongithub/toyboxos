/* Models: the assistant's providers, keys and models, set from the app (server/aiconf.py). Keys are sent once and stored on
   the server; the app only ever learns whether a provider has one. Models come from the provider's own list. */
import { useState, useEffect } from "preact/hooks";
import { api, aiBase } from "../core/ai.js";
import { html, openExternal } from "../core/lib.js";
import { useCols } from "../core/store.js";
import { openSheet, actionSheet, askText } from "../ui/sheet.js";
import { toast, warn } from "../core/bus.js";
import { Tools, Panel, Btn, Group, Select, Empty, Field, Check, Del } from "../ui/index.js";
import { Icon } from "../ui/icons.js";
import { useMods } from "../core/features.js";
import { usd } from "../core/models.js";
import { openMod } from "../shell/os.js";

const changed = () => dispatchEvent(new Event("os-ai-set")); // the chat's model picker reloads
const call = async (path, body) => {
  const r = await api(path, body);
  changed();
  return r;
};
const kk = n => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + "M" : Math.round(n / 1000) + "k");
/* what the provider told us about a model: price per 1M tokens (or free), context, images */
const facts = m =>
  [
    m.price
      ? m.price[0] || m.price[1]
        ? "$" + m.price[0] + " in · $" + m.price[1] + " out per 1M"
        : "free"
      : "",
    m.context ? kk(m.context) + " context" : "",
    m.vision ? "sees images" : "",
  ]
    .filter(Boolean)
    .join(" · ");
const openLink = u => {
  try {
    openExternal(u);
  } catch (e) {
    warn("open link", e);
  }
};

export async function askKey(p, kind) {
  const v = await askText({
    title: p.label + " key",
    secret: true,
    ok: "Save",
    placeholder: "Paste the API key",
    label: "Stored on your server and never shown again.",
    extra: kind && kind.signup ? ["Get a key", { link: kind.signup }] : null,
  });
  if (v && typeof v === "object") {
    openLink(v.link);
    return askKey(p, kind);
  }
  if (v === null || v === undefined) return false;
  try {
    await call("/api/ai/key", { provider: p.id, key: v.trim() });
    toast(v.trim() ? "Key saved" : "Key removed");
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

/* the provider's live list with a tick per model; ticking turns it on right away */
function Picker({ p, onDone }) {
  const [all, setAll] = useState(null),
    [err, setErr] = useState(""),
    [q, setQ] = useState(""),
    [on, setOn] = useState(() => new Set(p.models.map(m => m.mid)));
  const load = fresh => {
    setErr("");
    setAll(null);
    api("/api/ai/live", { provider: p.id, fresh }).then(
      r => setAll(r.models),
      e => setErr(e.message),
    );
  };
  useEffect(() => load(false), []);
  const flip = async m => {
    const was = on.has(m.id),
      n = new Set(on);
    was ? n.delete(m.id) : n.add(m.id);
    setOn(n);
    try {
      onDone(
        await call("/api/ai/enable", { provider: p.id, [was ? "off" : "on"]: [was ? m.id : { id: m.id }] }),
      );
    } catch (e) {
      toast(e.message);
      setOn(on);
    }
  };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (all || []).filter(m => words.every(w => (m.id + " " + m.label).toLowerCase().includes(w)));
  rows.sort((a, b) => on.has(b.id) - on.has(a.id));
  return html`<div class="amp">
    <div class="amq"><${Field} w="w" placeholder=${all ? "Search " + all.length + " models" : "Search"} value=${q} onInput=${e => setQ(e.target.value)}/><${Btn} icon="reset" title="Reload the list" aria-label="Reload the list" onClick=${() => load(true)}/></div>
    ${
      err
        ? html`<div class="amerr">${err}</div>`
        : !all
          ? html`<div class="emp">Asking ${p.label}…</div>`
          : html`<div class="ll aml">${rows.slice(0, 200).map(
              m => html`<div class="lr" key=${m.id} onClick=${() => flip(m)}>
        <${Check} on=${on.has(m.id)} label=${"Use " + m.label}/><span class="tt">${m.label}<small>${[m.label !== m.id ? m.id : "", facts(m)].filter(Boolean).join(" · ")}</small></span></div>`,
            )}
      ${rows.length > 200 ? html`<div class="emp">${rows.length - 200} more: search to narrow it down.</div>` : !rows.length ? html`<div class="emp">No match.</div>` : null}</div>`
    }
  </div>`;
}
const pickModels = (p, set) =>
  openSheet({ title: p.label + " models", Body: Picker, props: { p, onDone: set } });

async function addProvider(s, set) {
  const kinds = s.kinds;
  actionSheet(
    "Add a provider",
    kinds.map(k => [
      k.nokey ? "nijika" : "buddy",
      k.label,
      async () => {
        let body = { kind: k.id };
        if (k.id === "custom") {
          const label = await askText({ title: "Name", placeholder: "e.g. My proxy", ok: "Next" });
          if (!label || !label.trim()) return;
          const url = await askText({
            title: "Address",
            label: "The OpenAI-compatible base address, ending in /v1.",
            placeholder: "https://example.com/v1",
            ok: "Next",
          });
          if (!url) return;
          body = { ...body, label: label.trim(), url: url.trim() };
        } else if (k.needs_url) {
          const url = await askText({
            title: k.label + " address",
            value: k.url.replace(/\/chat\/completions$/, ""),
            ok: "Next",
          });
          if (!url) return;
          body.url = url.trim();
        }
        try {
          const r = await call("/api/ai/provider", body);
          set(r);
          const p = r.providers.find(x => x.id === r.id);
          if (p && !p.nokey && !(await askKey(p, k))) return;
          set(await api("/api/ai/setup", {}));
          pickModels(p, set);
        } catch (e) {
          toast(e.message);
        }
      },
      { sub: k.free ? "has a free tier" : k.nokey ? "runs on your server, no key" : "" },
    ]),
  );
}

function more(p, k, s, set) {
  const ed = async body => {
    try {
      set(await call("/api/ai/provider", { id: p.id, ...body }));
    } catch (e) {
      toast(e.message);
    }
  };
  actionSheet(
    p.label,
    [
      [
        "edit",
        "Rename",
        async () => {
          const v = await askText({ title: "Name", value: p.label, ok: "Save" });
          if (v && v.trim()) ed({ label: v.trim() });
        },
      ],
      (k && k.needs_url) || p.kind === "custom"
        ? [
            "globe",
            "Address",
            async () => {
              const v = await askText({
                title: "Address",
                value: p.url.replace(/\/(chat\/completions|messages)$/, ""),
                ok: "Save",
              });
              if (v) ed({ url: v.trim() });
            },
            { sub: p.url.replace(/^https?:\/\//, "").replace(/\/(chat\/completions|messages)$/, "") },
          ]
        : null,
      p.kind === "custom"
        ? [
            "list",
            "Protocol",
            () => ed({ protocol: p.protocol === "anthropic" ? "openai" : "anthropic" }),
            {
              sub:
                p.protocol === "anthropic"
                  ? "Anthropic Messages (tap for OpenAI)"
                  : "OpenAI chat (tap for Anthropic)",
            },
          ]
        : null,
      [
        "money",
        "Monthly limit",
        async () => {
          const v = await askText({
            title: "Monthly limit in USD",
            label:
              "Stops using this provider once its estimated spend this month reaches it. Empty = no limit.",
            value: p.cap == null ? "" : String(p.cap),
            ok: "Save",
          });
          if (v !== null) {
            const n = v.trim() === "" ? "" : parseFloat(v);
            if (n === "" || n >= 0) ed({ cap: n });
            else toast("Enter a number");
          }
        },
        { sub: p.cap == null ? "none" : usd(p.cap) },
      ],
      p.signup ? ["globe", "Get a key", () => openLink(p.signup)] : null,
      "-",
      [
        "trash",
        "Remove " + p.label,
        async () => {
          try {
            set(await call("/api/ai/provider", { id: p.id, remove: true }));
            toast("Removed " + p.label + " and its key");
          } catch (e) {
            toast(e.message);
          }
        },
        { danger: true },
      ],
    ].filter(Boolean),
  );
}

function Models() {
  useCols("config");
  useMods();
  const [s, setS] = useState(null),
    [err, setErr] = useState("");
  const load = () => {
    if (!aiBase())
      return setErr("Connect Sync first (Start > Sync): the assistant runs through your server.");
    api("/api/ai/setup", {}).then(setS, e => setErr(e.message));
  };
  useEffect(load, []);
  if (err) return html`<${Panel}><${Empty} pad>${err}<//><//>`;
  if (!s) return html`<${Panel}><${Empty} pad>Loading…<//><//>`;
  const all = s.providers.flatMap(p => p.models.map(m => [m.id, m.label + " · " + p.label]));
  const def = async (k, v) => {
    try {
      setS(await call("/api/ai/defaults", { [k]: v }));
    } catch (e) {
      toast(e.message);
    }
  };
  const kind = p => s.kinds.find(k => k.id === p.kind);
  const status = p =>
    !p.ready
      ? "no key"
      : p.cap != null
        ? usd(p.spent || 0) + " of " + usd(p.cap)
        : p.nokey
          ? "no key needed"
          : "key saved";
  return html`<${Tools}><${Btn} go icon="plus" onClick=${() => addProvider(s, setS)}>Add provider<//><//>
    <${Panel} cls="amodels"><div class="ll">
      ${
        all.length
          ? html`<${Group} title="Use"/>
        <div class="lr"><span class="when">Chat</span><${Select} opts=${[["", "First that works"], ...all]} value=${s.default} onChange=${v => def("default", v)}/></div>
        <div class="lr"><span class="when" title="Folds long chats into a short summary">Summaries</span><${Select} opts=${[["", "Same as chat"], ...all]} value=${s.utility} onChange=${v => def("utility", v)}/></div>`
          : null
      }
      ${
        s.providers.length
          ? s.providers.map(
              p => html`<div class="amprov" key=${p.id}>
        <${Group} title=${p.label} meta=${status(p)}/>
        <div class="lr ambar">${p.nokey ? null : html`<${Btn} icon="key" onClick=${() => askKey(p, kind(p)).then(ok => ok && load())}>${p.ready ? "Replace key" : "Add key"}<//>`}
          <${Btn} icon="list" disabled=${!p.ready} onClick=${() => pickModels(p, setS)}>Models<//><span/>
          <${Btn} icon="more" aria-label=${p.label + " options"} onClick=${() => more(p, kind(p), s, setS)}/></div>
        ${p.models.map(
          m => html`<div class="lr" key=${m.id}><${Icon} n="buddy"/><span class="tt">${m.label}${m.label !== m.mid ? html`<small>${m.mid}</small>` : null}</span>
          <${Del} onClick=${async () => {
            try {
              setS(await call("/api/ai/enable", { provider: p.id, off: [m.mid] }));
            } catch (e) {
              toast(e.message);
            }
          }}/></div>`,
        )}
        ${p.ready && !p.models.length ? html`<div class="lr"><span class="tt dim">No models picked yet.</span></div>` : null}
      </div>`,
            )
          : html`<${Empty} pad>No models yet. Add a provider, paste its key, then pick the models you want. OpenRouter and Gemini have free models.<//>`
      }
      <${Group} title="Web search" meta=${s.brave ? "Brave key saved" : "free fallbacks"}/>
      <div class="lr"><span class="tt dim">For models without their own search (Ollama, models on your PC).</span>
        <${Btn} icon="key" onClick=${async () => {
          const v = await askText({
            title: "Brave Search key",
            secret: true,
            ok: "Save",
            label: "Optional. Free plan at api-dashboard.search.brave.com.",
            extra: ["Get a key", { link: "https://api-dashboard.search.brave.com" }],
          });
          if (v && typeof v === "object") return openLink(v.link);
          if (v === null) return;
          try {
            await call("/api/ai/searchkey", { key: v.trim() });
            toast(v.trim() ? "Key saved" : "Key removed");
            load();
          } catch (e) {
            toast(e.message);
          }
        }}>${s.brave ? "Replace" : "Add key"}<//></div>
    </div><//>`;
}

export default {
  id: "models",
  opt: "ai",
  name: "Models",
  title: "models",
  Comp: Models,
  cmd: v =>
    /^(models?|ai|keys?|providers?)$/.test(v)
      ? [{ icon: "buddy", l: "Models and keys", r: () => openMod("models", true) }]
      : [],
  search: q =>
    /^(mod|key|prov|api)/i.test(q)
      ? [{ icon: "buddy", l: "Models and keys", r: () => openMod("models", true) }]
      : [],
};
