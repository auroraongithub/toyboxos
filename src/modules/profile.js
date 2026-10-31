/* Profile (extra window, Start > Profile / command "profile"): who uses this OS. Name, pronouns and a line about them go
   to the assistant; timezone and the two currencies drive dates and money everywhere. Saved as config/profile (synced). */
import { useState } from "preact/hooks";
import { html, TZ, curSym } from "../core/lib.js";
import { useCols } from "../core/store.js";
import { toast } from "../core/bus.js";
import { profile, setProfile, PRONOUNS } from "../core/profile.js";
import { AI } from "../core/pack.js";
import { Tools, Panel, Btn, Field, Select, Combo, Check, Icon, Group } from "../ui/index.js";
import { FEATURES, wanted, setWanted, blocked, useMods, listed } from "../core/features.js";
import { openMod } from "../shell/os.js";

export const list = k => {
  try {
    return Intl.supportedValuesOf(k);
  } catch (e) {
    return k === "timeZone" ? [TZ] : ["PHP", "USD", "EUR"];
  }
};
export const ZONES = list("timeZone"),
  CODES = list("currency");
const curName = c => {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(c);
  } catch (e) {
    return c;
  }
};
export const curOpt = c => c + " " + curSym(c).trim() + " · " + curName(c);
export const code = s =>
  String(s || "")
    .trim()
    .slice(0, 3)
    .toUpperCase();

function Profile() {
  useCols("config");
  const [f, setF] = useState(() => ({
    ...profile(),
    cur: curOpt(profile().cur),
    cur2: profile().cur2 ? curOpt(profile().cur2) : "",
  }));
  const set = k => v => setF(o => ({ ...o, [k]: v }));
  const bad = [];
  if (f.tz && !ZONES.includes(f.tz)) bad.push("Pick a timezone from the list");
  if (!CODES.includes(code(f.cur))) bad.push("Pick a home currency from the list");
  if (f.cur2 && !CODES.includes(code(f.cur2)))
    bad.push("Pick the second currency from the list, or leave it empty");
  const save = async () => {
    if (bad.length) {
      toast(bad[0]);
      return;
    }
    if (await setProfile({ ...f, cur: code(f.cur), cur2: f.cur2 ? code(f.cur2) : "", tzLabel: f.tzLabel }))
      toast("Profile saved");
  };
  const row = (l, el, hint) =>
    html`<label class="pfr"><span class="pfl">${l}</span><span class="pff">${el}${hint ? html`<small>${hint}</small>` : null}</span></label>`;
  return html`<${Panel} cls="pfp">
    <div class="pfg">
      ${row("Name", html`<${Field} value=${f.name} placeholder="What should ${AI.name} call you?" onInput=${e => set("name")(e.target.value)}/>`)}
      ${row("Pronouns", html`<${Select} opts=${PRONOUNS} value=${f.pronouns} onChange=${set("pronouns")}/>`)}
      ${row("About you", html`<${Field} value=${f.about} placeholder="a nursing student in Cebu, a freelance designer…" onInput=${e => set("about")(e.target.value)}/>`, "One line for " + AI.name + ".")}
      ${row("Timezone", html`<${Combo} value=${f.tz} options=${() => ZONES} onInput=${set("tz")} placeholder="Region/City"/>`, f.tz !== TZ ? "Takes effect after a reload." : null)}
      ${row("Clock label", html`<${Field} value=${f.tzLabel} placeholder=${TZ.split("/").pop().replace(/_/g, " ")} onInput=${e => set("tzLabel")(e.target.value)}/>`)}
      ${row("Home currency", html`<${Combo} value=${f.cur} options=${() => CODES.map(curOpt)} onInput=${set("cur")}/>`, "Totals and budgets are in this.")}
      ${row("Second currency", html`<${Combo} value=${f.cur2} options=${() => CODES.map(curOpt)} onInput=${set("cur2")} placeholder="none"/>`, "Converted at the daily rate.")}
    </div>
    <${Tools}><${Btn} go onClick=${save}>Save<//><//>
    <${Modules}/>
  <//>`;
}

/* optional modules (core/features.js): saved straight away as config/modules, synced to every device */
export function Modules() {
  useMods();
  return html`<${Group} title="Modules"/><div class="pmods">${FEATURES.filter(listed).map(f => {
    const w = wanted(f.id),
      why = w && blocked(f.id);
    return html`<div class="pmod" key=${f.id} data-off=${w ? null : "1"}><${Check} on=${w} label=${f.name} onClick=${() => setWanted(f.id, !w)}/><${Icon} n=${f.icon}/>
      <span class="pmt"><b>${f.name}</b><small class=${why ? "late" : ""}>${why || f.about}</small></span></div>`;
  })}</div>`;
}

export default {
  id: "profile",
  name: "Profile",
  title: "profile",
  Comp: Profile,
  cmd: v =>
    /^(profile|me|about ?me|currency|timezone|tz|modules?|features?)$/.test(v)
      ? [{ icon: "person", l: "Profile", r: () => openMod("profile", true) }]
      : [],
};
