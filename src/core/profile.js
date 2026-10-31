/* Who uses this OS: name, pronouns, a line about them, timezone, home + second currency. Synced as config/profile;
   unset fields fall back to the pack's profile (a private pack can carry one), then to guesses from this device. */
import { D, W, onChange } from "./store.js";
import { pack } from "./pack.js";
import { TZ } from "./lib.js";
import { ls } from "./pref.js";
import { toast } from "./bus.js";

const REGION_CUR = {
  PH: "PHP",
  US: "USD",
  GB: "GBP",
  JP: "JPY",
  IN: "INR",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  SG: "SGD",
  MY: "MYR",
  ID: "IDR",
  TH: "THB",
  VN: "VND",
  KR: "KRW",
  CN: "CNY",
  HK: "HKD",
  TW: "TWD",
  BR: "BRL",
  MX: "MXN",
  AR: "ARS",
  CL: "CLP",
  CO: "COP",
  ZA: "ZAR",
  NG: "NGN",
  KE: "KES",
  EG: "EGP",
  AE: "AED",
  SA: "SAR",
  TR: "TRY",
  PL: "PLN",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  CH: "CHF",
  CZ: "CZK",
  HU: "HUF",
  RU: "RUB",
  UA: "UAH",
  IL: "ILS",
  PK: "PKR",
  BD: "BDT",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  IE: "EUR",
  PT: "EUR",
  FI: "EUR",
  GR: "EUR",
  SK: "EUR",
  SI: "EUR",
  LT: "EUR",
  LV: "EUR",
  EE: "EUR",
  LU: "EUR",
  MT: "EUR",
  CY: "EUR",
  HR: "EUR",
};
const guessCur = () => {
  const r = (navigator.languages || [navigator.language || ""])
    .map(l => (l.split("-")[1] || "").toUpperCase())
    .find(x => REGION_CUR[x]);
  return REGION_CUR[r] || "USD";
};
export const PRONOUNS = [
  ["he", "he/him"],
  ["she", "she/her"],
  ["they", "they/them"],
];
const CODE = /^[A-Z]{3}$/;
const clean = o => {
  const p = {};
  if (!o) return p;
  for (const k of ["name", "about", "tzLabel"])
    if (typeof o[k] === "string") p[k] = o[k].trim().slice(0, k === "about" ? 300 : 40);
  if (PRONOUNS.some(x => x[0] === o.pronouns)) p.pronouns = o.pronouns;
  if (typeof o.tz === "string" && o.tz) p.tz = o.tz;
  for (const k of ["cur", "cur2"]) if (CODE.test(o[k] || "")) p[k] = o[k];
  return p;
};
const saved = () => (D.config || []).find(x => x._id === "profile");
export const profile = () => {
  const d = clean(pack.profile),
    s = clean(saved());
  if (s.tz && s.tz !== d.tz && !("tzLabel" in s)) delete d.tzLabel; // the pack's clock label belongs to the pack's timezone
  return {
    name: "",
    pronouns: "they",
    about: "",
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    tzLabel: "",
    cur: guessCur(),
    cur2: "USD",
    ...d,
    ...s,
  };
};
export const setProfile = o =>
  W.set("config", "profile", { ...clean(saved()), ...clean(o), upd: new Date().toISOString() });
export const home = () => profile().cur;
export const second = () => {
  const p = profile();
  return p.cur2 && p.cur2 !== p.cur ? p.cur2 : null;
};
/* the label next to the clock: the profile's (MNL), else the city of the timezone */
export const tzLabel = () => {
  const p = profile();
  return p.tzLabel || (TZ.split("/").pop() || "").replace(/_/g, " ");
};

/* dates are worked out in lib.js's TZ, read once at start from os-tz: keep it in step with the profile */
let asked = false;
const checkTZ = () => {
  const z = profile().tz;
  if (!z || ls.get("os-tz", null) === z) return;
  ls.set("os-tz", z);
  if (z !== TZ && !asked) {
    asked = true;
    toast("Timezone is now " + z, { label: "Reload", run: () => location.reload() });
  }
};
/* registered after store.js has finished loading (the two import each other) */
queueMicrotask(() =>
  onChange(c => {
    if (c === "*" || c === "config") checkTZ();
  }),
);
/* the currency a money box starts on: the last one picked (os-cur) if it is still one of the two, else home */
export const curPick = () => {
  const c = ls.get("os-cur", null),
    p = profile();
  return c === p.cur || c === second() ? c : p.cur;
};
