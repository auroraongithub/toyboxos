/* Forgiving quick-add parsing, shared by Today's box, the command bar, Reminders and Calendar.
   when("alarm 1030pm tmrw gym") style text -> {date, time, rel, repeat, before, tags, title}; typos and loose order are fine:
   "tmrw 10:30 p.m. gym", "gym tomorow @ 1030pm", "2 days from now 7am", "in 1h30 stretch", "the 30th", "oct 30", "next fri",
   "tonight 10", "every monday 8am", "15 min before". Ranges give {end}: "mon-fri", "oct 30 to nov 2", "from monday until friday",
   "this week" / "whole week" / "all week next week" (Mon-Sun), "3 days from tomorrow", "for 2 weeks". intent() picks the verb: "remind me to", "set an alarm for", "alrm", "i spent ₱250 on lunch"... */
import { today, dAt, addDays, addMonths } from "./lib.js";

import { home } from "./profile.js";
const pad = n => String(n).padStart(2, "0");

/* edit distance with swaps ("tomorow", "firday", "alrm") */
export function dist(a, b) {
  const m = a.length,
    n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  const d = [];
  for (let i = 0; i <= m; i++) {
    d[i] = [i];
    for (let j = 1; j <= n; j++) d[i][j] = i ? 0 : j;
  }
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[m][n];
}
/* closest word from a list: exact, else one typo (two for long words); short words must be exact */
export function fuzzy(w, list) {
  if (list.includes(w)) return w;
  if (w.length < 4) return null;
  let best = null,
    bd = 9;
  for (const x of list) {
    if (x.length < 4) continue;
    const k = dist(w, x);
    if (k < bd) {
      bd = k;
      best = x;
    }
  }
  return bd <= (w.length >= 7 ? 2 : 1) ? best : null;
}

const WDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MABBR = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const UNITS = {
  s: 1e3,
  sec: 1e3,
  secs: 1e3,
  second: 1e3,
  seconds: 1e3,
  m: 6e4,
  min: 6e4,
  mins: 6e4,
  minute: 6e4,
  minutes: 6e4,
  mn: 6e4,
  h: 36e5,
  hr: 36e5,
  hrs: 36e5,
  hour: 36e5,
  hours: 36e5,
  d: 864e5,
  day: 864e5,
  days: 864e5,
  w: 6048e5,
  wk: 6048e5,
  wks: 6048e5,
  week: 6048e5,
  weeks: 6048e5,
  mo: -1,
  month: -1,
  months: -1,
};
const UNIT_WORDS = Object.keys(UNITS).filter(k => k.length >= 4);
const unitOf = w => (UNITS[w] != null ? w : fuzzy(w, UNIT_WORDS));
const TOMORROW = [
  "tomorrow",
  "tmrw",
  "tmr",
  "tmw",
  "tmrow",
  "tmrrw",
  "tom",
  "tomo",
  "tomz",
  "2moro",
  "2mrw",
  "2mr",
  "2morrow",
  "tomorow",
  "tommorow",
  "tommorrow",
  "tomorro",
];
const TODAY = ["today", "tdy", "tday", "2day", "todayy"];
const TONIGHT = ["tonight", "tonite", "2nite", "2night", "tonyt", "tonigt"];
const PARTS = {
  morning: "08:00",
  morn: "08:00",
  noon: "12:00",
  midday: "12:00",
  afternoon: "15:00",
  arvo: "15:00",
  evening: "18:00",
  eve: "18:00",
  night: "21:00",
  midnight: "00:00",
};
const NUMW = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  "forty-five": 45,
  half: 0.5,
  couple: 2,
  few: 3,
};
const LEAD_JUNK = new Set([
  "to",
  "for",
  "about",
  "that",
  "on",
  "at",
  "by",
  "the",
  "me",
  "and",
  "-",
  "–",
  ":",
  ",",
  "&",
  "is",
  "of",
  "in",
  "due",
  "from",
  "@",
]);
const CONN = new Set(["to", "-", "–", "until", "till", "til", "thru", "through", "upto"]),
  UNTIL = /^(until|till|til|thru|through)$/;
const conn = w => CONN.has(w) || (w.length >= 4 && !!fuzzy(w, ["until", "through"]));
const WEEKW = new Set(["week", "wk", "wek", "weeek", "wks"]);
const TAIL_JUNK = new Set([
  "at",
  "on",
  "by",
  "for",
  "the",
  "and",
  "in",
  "from",
  "of",
  "to",
  "-",
  "–",
  ":",
  ",",
  "&",
  "due",
  "@",
  "around",
  "after",
  "before",
  "this",
  "next",
  "every",
]);

function weekday(w) {
  if (WABBR[w] != null) return WABBR[w];
  const s = w.replace(/'?s$/, "");
  if (WABBR[s] != null) return WABBR[s];
  const f = fuzzy(w, WDAYS) || fuzzy(s, WDAYS);
  return f ? WDAYS.indexOf(f) : -1;
}
function month(w) {
  if (MABBR[w] != null) return MABBR[w];
  if (w === "may") return 4;
  const f = w.length >= 4 ? fuzzy(w, MONTHS) : null;
  return f ? MONTHS.indexOf(f) : -1;
}
const dow = k => dAt(k).getUTCDay();
function nextDow(want, from) {
  let k = from;
  for (let i = 0; i < 7; i++) {
    if (dow(k) === want) return k;
    k = addDays(k, 1);
  }
  return k;
}
const ordinal = w => {
  const m = w.match(/^(\d{1,2})(st|nd|rd|th)$/);
  return m && +m[1] >= 1 && +m[1] <= 31 ? +m[1] : 0;
};
const dayNum = w => {
  const o = ordinal(w);
  if (o) return o;
  return /^\d{1,2}$/.test(w) && +w >= 1 && +w <= 31 ? +w : 0;
};
function ymd(y, mo, d) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const k = y + "-" + pad(mo + 1) + "-" + pad(d);
  return k;
}
/* a month/day with no year means the next one coming */
function upcoming(mo, d) {
  const t = today();
  let y = +t.slice(0, 4);
  let k = ymd(y, mo, d);
  if (k && k < t) k = ymd(y + 1, mo, d);
  return k;
}

/* clean up the text before splitting: "10:30 p.m." -> "10:30pm", "10 pm" -> "10pm", "7a" -> "7am", "@5" -> "@ 5" */
function prep(s) {
  return (
    String(s)
      .replace(/(\d)\s*([ap])\.?\s?m\b\.?/gi, "$1$2m")
      .replace(/(\d)([ap])(?=\s|$|[,.!?])/gi, "$1$2m")
      .replace(/\bo['’]?clock\b/gi, "")
      .replace(/(\d)ish\b/gi, "$1")
      .replace(/@(?=\d)/g, "@ ")
      .replace(/\bday after (tomorrow|tmrw|tmr|tom)\b/gi, "dayaftertomorrow")
      .replace(/\b(from now|later|from today)\b/gi, "fromnow")
      .replace(/\bweek-long\b/gi, "weeklong")
      // ranges glued with a dash: "mon-fri", "oct 30-nov 2", "oct 30-31", "10/30-11/2"
      .replace(/\b([a-z]{3,9})\s*[-–]\s*([a-z]{3,9})\b/gi, (x, a, b) =>
        dayish(a) && dayish(b) ? a + " - " + b : x,
      )
      .replace(/\b(\d{1,2}(?:st|nd|rd|th)?)\s*[-–]\s*([a-z]{3,9})\b/gi, (x, a, b) =>
        month(b.toLowerCase()) >= 0 ? a + " - " + b : x,
      )
      .replace(/\b([a-z]{3,9}) (\d{1,2})\s*[-–]\s*(\d{1,2})\b(?![\/:-])/gi, (x, a, b, c) =>
        month(a.toLowerCase()) >= 0 ? a + " " + b + " - " + c : x,
      )
      .replace(/\b(\d{1,2}\/\d{1,2})[-–](\d{1,2}\/\d{1,2})\b/g, "$1 - $2")
      .replace(/\s+/g, " ")
      .trim()
  );
}
function dayish(w) {
  w = w.toLowerCase();
  return weekday(w) >= 0 || month(w) >= 0;
}

/* parse a time token (and maybe the next one); returns {time:"HH:MM", ampm:bool, used} or null */
function timeAt(t, i, loose) {
  if (i >= t.length) return null; // "… at" with nothing after it yet
  const w = t[i].replace(/[,.!?]+$/, "");
  let m;
  if ((m = w.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/)) || (m = w.match(/^(\d{1,2})(\d{2})(am|pm)$/))) {
    const h = +m[1],
      mi = +(m[2] || 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    return { time: pad((h % 12) + (m[3] === "pm" ? 12 : 0)) + ":" + pad(mi), ampm: true, used: 1 };
  }
  if ((m = w.match(/^([01]?\d|2[0-3])[:h]([0-5]\d)$/))) {
    const h = +m[1];
    return {
      time: pad(h) + ":" + m[2],
      ampm: h === 0 || h > 12,
      amb: h >= 1 && h <= 12 ? h : 0,
      mi: +m[2],
      used: 1,
    };
  }
  if (loose && (m = w.match(/^(\d{1,2})$/)) && +m[1] >= 0 && +m[1] <= 23) {
    const h = +m[1];
    return { time: pad(h) + ":00", ampm: h === 0 || h > 12, amb: h >= 1 && h <= 12 ? h : 0, mi: 0, used: 1 };
  }
  if (loose && (m = w.match(/^([01]?\d|2[0-3])([0-5]\d)$/))) {
    const h = +m[1];
    return {
      time: pad(h) + ":" + m[2],
      ampm: h === 0 || h > 12 || (m[1].length === 2 && m[1][0] === "0"),
      amb: h >= 1 && h <= 12 ? h : 0,
      mi: +m[2],
      used: 1,
    };
  }
  return null;
}

/* main entry: tokens are consumed when they mean a date/time; what's left is the title */
export function when(text, { now = Date.now(), bare = true, loose = false } = {}) {
  const raw = prep(text).split(" ").filter(Boolean),
    t = raw.map(x =>
      x
        .toLowerCase()
        .replace(/[,!?]+$/, "")
        .replace(/\.$/, ""),
    );
  const used = new Array(t.length).fill(false),
    take = (i, n = 1) => {
      for (let j = i; j < i + n; j++) used[j] = true;
    };
  let date = null,
    time = null,
    amb = 0,
    ambMin = 0,
    ampm = false,
    rel = 0,
    relDays = 0,
    repeat = "",
    before = 0,
    pmBias = false,
    partTime = null;
  const tags = [];
  // ranges: end day, span in days, wk = "this"|"next" for a Mon-Sun week, dS/dE = token span of the last date seen
  let end = null,
    span = 0,
    wk = "",
    nextWk = false,
    dS = -1,
    dE = -1;
  /* a date; right after "X to|-|until" it is the end of a range ("fri-sun", "oct 30 to nov 2"), "until fri" alone starts today */
  const setD = (k, s, e, rel) => {
    if (!k) return;
    if (date && !end && s > 0 && !used[s - 1] && dE === s - 1 && conn(t[s - 1])) {
      end = rel ? rel(date) : k < date ? addMonths(k, 12) : k;
      take(s - 1);
      if (t[dS - 1] === "from" && !used[dS - 1]) take(dS - 1);
    } else if (
      !date &&
      !end &&
      s > 0 &&
      !used[s - 1] &&
      UNTIL.test(fuzzy(t[s - 1], ["until", "through"]) || t[s - 1])
    ) {
      date = today();
      end = k;
      take(s - 1);
    } else {
      date = k;
      dS = s;
    }
    dE = e;
  };
  const isNum = w => /^\d+(\.\d+)?$/.test(w) || NUMW[w] != null;
  const num = w => (NUMW[w] != null ? NUMW[w] : parseFloat(w));

  for (let i = 0; i < t.length; i++) {
    if (used[i]) continue;
    const w = t[i],
      nx = t[i + 1] || "",
      nx2 = t[i + 2] || "";
    let m;

    if (/^#\S+/.test(raw[i])) {
      tags.push(raw[i].slice(1));
      take(i);
      continue;
    }
    // spans: "for 3 days", "for a week", "3 days from|starting tomorrow" ("3 days from now" stays a single date)
    {
      const f = w === "for" ? 1 : 0,
        a = t[i + f] || "",
        u = unitOf(t[i + f + 1] || ""),
        v = u && UNITS[u];
      if (
        isNum(a) &&
        (v === 864e5 || v === 6048e5) &&
        (f || /^(from|starting|beginning)$/.test(t[i + 2] || ""))
      ) {
        span = Math.round((num(a) * v) / 864e5);
        take(i, 3);
        continue;
      }
    }
    // weeks: "this week", "whole week", "all week next week", "the entire next week", "weeklong"
    if (w === "weeklong") {
      wk = wk || "this";
      take(i);
      continue;
    }
    if (w === "all" || w === "full" || fuzzy(w, ["whole", "entire"])) {
      const nn = (nx === "next" || nx === "this") && WEEKW.has(nx2) ? nx : "";
      if (nn || WEEKW.has(nx)) {
        wk = nn || wk || "this";
        take(i, nn ? 3 : 2);
        if (t[i - 1] === "the" && !used[i - 1]) take(i - 1);
        continue;
      }
      if (nx === "weekend" || nx === "wknd") {
        const d = nextDow(6, today());
        setD(d, i, i + 2);
        end = addDays(d, 1);
        take(i, 2);
        continue;
      }
    }
    // event alert: "!15m", "15 min before", "1h before", "remind 30m before"
    const eat = () => {
      if (["remind", "alert", "notify", "ping", "alarm"].includes(t[i - 1]) && !used[i - 1]) take(i - 1);
      else if (t[i - 1] === "me" && ["remind", "alert", "notify", "ping"].includes(t[i - 2])) take(i - 2, 2);
    };
    if ((m = w.match(/^!(\d+)(m|min|mins|h|hr|hrs|d)?$/))) {
      before = +m[1] * (/^h/.test(m[2] || "") ? 60 : /^d/.test(m[2] || "") ? 1440 : 1);
      take(i);
      continue;
    }
    if (/^(before|early|prior)$/.test(nx) && (m = w.match(/^(\d+)(m|min|mins|h|hr|hrs)$/))) {
      before = +m[1] * (/^h/.test(m[2]) ? 60 : 1);
      take(i, 2);
      eat();
      continue;
    }
    if (
      isNum(w) &&
      /^(before|early|prior)$/.test(nx2) &&
      unitOf(nx) &&
      UNITS[unitOf(nx)] <= 36e5 &&
      UNITS[unitOf(nx)] >= 6e4
    ) {
      before = Math.round((num(w) * UNITS[unitOf(nx)]) / 6e4);
      take(i, 3);
      eat();
      continue;
    }

    // repeats
    if (w === "daily" || w === "everyday" || w === "nightly") {
      repeat = "daily";
      take(i);
      continue;
    }
    if (w === "weekly") {
      repeat = "weekly";
      take(i);
      continue;
    }
    if (w === "weekdays" || (w === "weekday" && t[i - 1] === "every")) {
      repeat = "weekdays";
      take(i);
      if (t[i - 1] === "every") take(i - 1);
      continue;
    }
    if (w === "every" || w === "each") {
      if (nx === "day") {
        repeat = "daily";
        take(i, 2);
        continue;
      }
      if (nx === "week") {
        repeat = "weekly";
        take(i, 2);
        continue;
      }
      if (nx === "weekday" || nx === "weekdays") {
        repeat = "weekdays";
        take(i, 2);
        continue;
      }
      if (PARTS[nx] && nx !== "am") {
        repeat = "daily";
        partTime = PARTS[nx];
        take(i, 2);
        continue;
      }
      const wd = weekday(nx);
      if (wd >= 0) {
        repeat = "weekly";
        date = nextDow(wd, today());
        take(i, 2);
        continue;
      }
    }

    // relative: "in 20m", "in 2 days", "20 mins from now", "after an hour", "in 1h30", "in half an hour"
    {
      let j = i,
        lead = false;
      if (["in", "after", "within"].includes(w)) {
        lead = true;
        j = i + 1;
      }
      let ms = 0,
        days = 0,
        k = j,
        got = false;
      while (k < t.length && !used[k]) {
        const a = t[k];
        let mm;
        if ((mm = a.match(/^(\d+(?:\.\d+)?)([a-z]+)$/)) && unitOf(mm[2])) {
          const u = UNITS[unitOf(mm[2])];
          if (u < 0) days += +mm[1] * 30;
          else if (u >= 864e5) days += (+mm[1] * u) / 864e5;
          else ms += +mm[1] * u;
          k++;
          got = true;
          if ((mm = (t[k] || "").match(/^(\d{1,2})$/)) && u === 36e5 && !unitOf(t[k + 1] || "")) {
            ms += +mm[1] * 6e4;
            k++;
          }
          continue;
        }
        if ((mm = a.match(/^(\d+)h(\d{1,2})m?$/))) {
          ms += +mm[1] * 36e5 + +mm[2] * 6e4;
          k++;
          got = true;
          continue;
        }
        if (isNum(a)) {
          let n = num(a),
            kk = k + 1;
          if (t[kk] === "half" && t[kk + 1] === "an") {
            n += 0.5;
            kk += 2;
          }
          if (t[kk] === "an" || t[kk] === "a") kk++;
          const u = unitOf(t[kk] || "");
          if (u) {
            const v = UNITS[u];
            if (v < 0) days += n * 30;
            else if (v >= 864e5) days += (n * v) / 864e5;
            else ms += n * v;
            k = kk + 1;
            got = true;
            if (t[k] === "and" && isNum(t[k + 1] || "")) k++;
            continue;
          }
        }
        break;
      }
      const tail = t[k] === "fromnow";
      if (got && (lead || tail || (bare && /^\d/.test(t[j])))) {
        take(i, k - i + (tail ? 1 : 0));
        if (days && !ms && Number.isInteger(days)) relDays += days;
        else rel += ms + days * 864e5;
        continue;
      }
    }

    // days
    if (TODAY.includes(w)) {
      take(i);
      setD(today(), i, i + 1);
      continue;
    }
    if (TONIGHT.includes(w)) {
      date = today();
      pmBias = true;
      partTime = partTime || "20:00";
      take(i);
      continue;
    }
    if (TOMORROW.includes(w) || (w.length >= 6 && fuzzy(w, ["tomorrow"]))) {
      take(i);
      setD(addDays(today(), 1), i, i + 1);
      if (PARTS[nx] && nx !== "am") {
        partTime = PARTS[nx];
        if (nx === "night" || nx === "evening") pmBias = true;
        take(i + 1);
      }
      continue;
    }
    if (w === "dayaftertomorrow" || w === "overmorrow") {
      take(i);
      setD(addDays(today(), 2), i, i + 1);
      continue;
    }
    if (w === "weekend" || w === "wknd") {
      date = nextDow(6, addDays(today(), t[i - 1] === "next" ? 7 : 0));
      take(i);
      if (["this", "next"].includes(t[i - 1])) take(i - 1);
      continue;
    }
    if ((w === "next" || w === "this") && WEEKW.has(nx)) {
      take(i, 2);
      if (w === "this") wk = "this";
      else if (wk) wk = "next";
      else {
        nextWk = true;
        date = addDays(today(), 7);
      }
      continue;
    }
    if (w === "next" && nx === "month") {
      date = addMonths(today(), 1);
      take(i, 2);
      continue;
    }
    {
      let k = i,
        mod = "";
      if (w === "next" || w === "this" || w === "on") {
        mod = w;
        k = i + 1;
      }
      const wd = t[k] ? weekday(t[k]) : -1;
      if (wd >= 0 && !(k === i && w.length < 3)) {
        let d = nextDow(wd, addDays(today(), mod === "next" ? 1 : 0));
        if (mod === "next" && dow(today()) !== 0) {
          const sun = nextDow(0, addDays(today(), 1));
          if (d < sun) d = addDays(d, 7);
        }
        take(i, k - i + 1);
        setD(d, i, k + 1, mod ? null : x => nextDow(wd, x));
        if (PARTS[t[k + 1]] && t[k + 1] !== "am") {
          partTime = PARTS[t[k + 1]];
          take(k + 1);
        }
        continue;
      }
    }
    // dates: 2026-10-30, 10/30, 10-30-26, oct 30, 30 oct, october 30th, the 30th
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(w)) {
      const [y, mo, d] = w.split("-").map(Number);
      take(i);
      setD(ymd(y, mo - 1, d), i, i + 1);
      continue;
    }
    if ((m = w.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/))) {
      let a = +m[1],
        b = +m[2];
      if (a > 12 && b <= 12) [a, b] = [b, a];
      const k = m[3] ? ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], a - 1, b) : upcoming(a - 1, b);
      if (k) {
        take(i);
        setD(k, i, i + 1);
        continue;
      }
    }
    {
      const mo = month(w);
      if (
        mo >= 0 &&
        !(w === "may" && !dayNum(nx) && !dayNum(t[i - 1] || "")) &&
        !(w === "mar" && !dayNum(nx))
      ) {
        let d = dayNum(nx),
          k = i + 1,
          s = i;
        let y = 0;
        if (d) {
          k = i + 2;
          if (/^\d{4}$/.test(t[k] || "")) {
            y = +t[k];
            k++;
          }
        } else if (i > 0 && !used[i - 1] && dayNum(t[i - 1])) {
          d = dayNum(t[i - 1]);
          take(i - 1);
          s = i - 1;
          if (t[i - 2] === "the") {
            take(i - 2);
            s = i - 2;
          }
        }
        if (d) {
          take(i, k - i);
          setD(y ? ymd(y, mo, d) : upcoming(mo, d), s, k);
          // "oct 30 - 2", "oct 30 to 31": same month, or the next one when the day is smaller
          const d2 = dayNum(t[k + 1] || "");
          if (date && !end && d2 && conn(t[k] || "") && month(t[k + 2] || "") < 0) {
            let e = date.slice(0, 8) + pad(d2);
            if (d2 < +date.slice(8)) e = addMonths(date.slice(0, 8) + "01", 1).slice(0, 8) + pad(d2);
            end = e;
            take(k, 2);
          }
          continue;
        }
        if (MONTHS.includes(w) && !["may", "march"].includes(w)) {
          date = upcoming(mo, 1);
          take(i);
          continue;
        }
      }
    }
    if (ordinal(w) && month(nx) < 0) {
      const d = ordinal(w),
        t0 = today();
      let k = t0.slice(0, 8) + pad(d);
      if (k < t0) k = addMonths(t0.slice(0, 8) + "01", 1).slice(0, 8) + pad(d);
      take(i);
      setD(k, t[i - 1] === "the" ? i - 1 : i, i + 1);
      if (t[i - 1] === "the") take(i - 1);
      if (t[i - 2] === "on" && t[i - 1] === "the") take(i - 2);
      continue;
    }

    // times
    if (w === "noon" || w === "midday") {
      time = "12:00";
      ampm = true;
      take(i);
      continue;
    }
    if (w === "midnight") {
      time = "23:59";
      ampm = true;
      take(i);
      continue;
    }
    if (
      ((w === "this" || w === "in" || w === "tmrw") && PARTS[nx] && nx !== "am" && nx !== "lunch") ||
      (w === "the" && PARTS[nx] && nx !== "am" && t[i - 1] === "in")
    ) {
      partTime = PARTS[nx];
      if (nx === "night" || nx === "evening") pmBias = true;
      take(i, 2);
      if (w === "the") take(i - 1);
      continue;
    }
    {
      const at = w === "at" || w === "@" || w === "by" || w === "around";
      const r = timeAt(t, at ? i + 1 : i, at || loose);
      if (r && time == null && !(at && !t[i + 1])) {
        // bare digits only count when they look like a time (1030, 7, 22:30) and nothing else claims them
        const tok = t[at ? i + 1 : i],
          plainDigits = /^\d+$/.test(tok);
        const yearish = /^(19|20)\d\d$/.test(tok) && (date || month(t[(at ? i + 1 : i) - 1] || "") >= 0);
        const money =
          /^(spent|paid|php|pesos?|usd|bucks|\$|₱)$/.test(t[(at ? i + 1 : i) + 1] || "") ||
          /^[₱$]/.test(raw[at ? i + 1 : i] || "");
        const monthNext = month(t[(at ? i + 1 : i) + 1] || "") >= 0;
        const k0 = at ? i + 1 : i,
          edge = k0 === 0 || k0 === t.length - 1 || used[k0 - 1] || used[k0 + 1];
        if (
          !yearish &&
          !money &&
          !monthNext &&
          (!plainDigits || at || (loose && (tok.length >= 3 || edge)))
        ) {
          time = r.time;
          ampm = r.ampm;
          amb = r.amb || 0;
          ambMin = r.mi || 0;
          take(i, at ? 2 : 1);
          if (
            PARTS[t[at ? i + 2 : i + 1]] === "21:00" ||
            ["tonight", "pm", "night", "evening"].includes(t[at ? i + 2 : i + 1])
          )
            pmBias = true;
          continue;
        }
      }
    }
  }

  // resolve
  const daysOnly = relDays && !date;
  if (relDays) {
    date = addDays(date || today(), relDays);
  }
  if (wk && !end) {
    if (nextWk && dS < 0) wk = "next";
    if (dS >= 0) end = addDays(date, 6);
    else {
      date = addDays(today(), -((dow(today()) + 6) % 7) + (wk === "next" ? 7 : 0));
      end = addDays(date, 6);
    }
  }
  if (span > 1 && !end) {
    date = date || today();
    end = addDays(date, span - 1);
  }
  if (end && (!date || end <= date)) end = null;
  if (!time && partTime) {
    time = partTime;
    ampm = true;
  }
  if (time && !ampm && amb) {
    // "7", "1030", "at 5": pick what you most likely mean
    const pm = pad(amb === 12 ? 12 : amb + 12) + ":" + pad(ambMin),
      am = pad(amb === 12 ? 0 : amb) + ":" + pad(ambMin);
    if (pmBias) time = pm;
    else if (date) {
      time = (amb >= 1 && amb <= 6) || amb === 12 ? pm : am;
    } else {
      const a1 = dAt(today(), am).getTime(),
        p1 = dAt(today(), pm).getTime();
      if (amb === 12) time = p1 > now ? pm : am;
      else time = a1 > now ? am : p1 > now ? pm : am;
    }
  }
  let title = raw.filter((_, i) => !used[i]);
  while (title.length && LEAD_JUNK.has(title[0].toLowerCase())) title.shift();
  while (title.length && TAIL_JUNK.has(title[title.length - 1].toLowerCase())) title.pop();
  title = title.join(" ").replace(/^[\s,.:;–-]+|[\s,:;–-]+$/g, "");
  return {
    date,
    end,
    time,
    rel,
    repeat,
    before,
    tags,
    title,
    hasWhen: !!(date || time || rel),
    relDays: daysOnly ? relDays : 0,
  };
}

/* -> exact ms for a reminder/alarm, or null when no time was given */
export function remindAt(p, now = Date.now()) {
  if (p.rel && !p.date && !p.time) return now + p.rel;
  if (p.relDays && !p.time) return now + p.relDays * 864e5 + (p.rel || 0); // "in 2 days": same time of day
  if (!p.date && !p.time) return null;
  let k = p.date || today(),
    at = dAt(k, p.time || "09:00").getTime() + (p.rel || 0);
  if (!p.date && at <= now) {
    k = addDays(k, 1);
    at = dAt(k, p.time).getTime();
  }
  if (p.date && !p.time && at <= now) at = now + 36e5; // "remind today x" after 9am: an hour from now
  return at;
}

/* ---- money: "₱250 lunch", "250 on lunch", "lunch 250", "1.5k rent", "$20 domain", "250 pesos jollibee" ---- */
export function amount(s) {
  const str = String(s).trim();
  const re =
    /(^|\s)(\+|-)?(₱|\$|php\s*|usd\s*|p(?=\d))?\s*(\d[\d,]*(?:\.\d+)?)(k)?\s*(php|pesos?|peso|usd|dollars?|bucks|\$)?(?=\s|$)/i;
  const m = str.match(re);
  if (!m) return null;
  let a = parseFloat(m[4].replace(/,/g, ""));
  if (m[5]) a *= 1000;
  if (!isFinite(a) || a <= 0) return null;
  const usd = /\$|usd|dollar|bucks/i.test((m[3] || "") + (m[6] || ""));
  let rest = (str.slice(0, m.index) + " " + str.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  rest = rest
    .replace(/^(on|for|at|in|to|from)\s+/i, "")
    .replace(/\s+(on|for|at|to|from)$/i, "")
    .trim();
  const peso = /₱|php|peso|^p$/i.test((m[3] || "") + (m[6] || ""));
  return { amt: a, cur: usd ? "USD" : peso ? "PHP" : home(), rest, sign: m[2] || "" };
}

/* ---- intent: which command does this text mean? -> {v, arg, guessed} ---- */
const VERBS = {
  alarm: ["alarm", "alarms", "alrm", "alarn", "alaram", "allarm", "alarma", "wake", "wakeup"],
  remind: ["remind", "reminder", "reminders", "remindme", "rem", "r", "rmd", "remember", "rmnd", "remin"],
  event: [
    "event",
    "ev",
    "cal",
    "due",
    "deadline",
    "sched",
    "schedule",
    "appt",
    "appointment",
    "meeting",
    "exam",
    "quiz",
  ],
  todo: ["todo", "task", "t", "to-do", "tdo", "todos", "tasks"],
  spent: ["spent", "spend", "paid", "pay", "exp", "expense", "bought"],
  earned: ["earned", "earn", "income", "received", "salary"],
  note: ["note", "n", "notes"],
  page: ["page"],
  jot: ["jot", "j", "idea"],
  wish: ["wish", "wishlist"],
  sub: ["sub", "subscription", "subscribe"],
  habit: ["habit"],
  link: ["link", "url", "bookmark"],
};
// typo matching only for words that can't easily be ordinary title words
const FUZZY_OK = new Set([
  "alarm",
  "alrm",
  "remind",
  "reminder",
  "remember",
  "event",
  "deadline",
  "schedule",
  "appointment",
  "spent",
  "expense",
  "earned",
  "received",
  "subscription",
  "bookmark",
  "habit",
]);
// verbs whose word also belongs in the title ("quiz fri 3pm" -> event "quiz")
const KEEP = { exam: 1, quiz: 1, meeting: 1, appt: 1, appointment: 1, deadline: 1, salary: 1, bought: 0 };
const LOOKUP = {};
Object.entries(VERBS).forEach(([v, l]) => l.forEach(w => (LOOKUP[w] = v)));

export function intent(q) {
  let s = String(q || "")
    .trim()
    .replace(/^(pls|please|plz|hey|yo|ok|okay)\b[,\s]*/i, "");
  const low = s.toLowerCase();
  let m;
  const out = (v, arg, guessed = false) => ({ v, arg: arg.trim(), guessed });
  if (
    (m = low.match(/^(?:(?:set|make|add|create|new|put)\s+(?:an?\s+|my\s+)?)?alarms?\s*(?:for|at|@)?\b/)) &&
    /^(set|make|add|create|new|put|alarm)/.test(low)
  )
    return out("alarm", s.slice(m[0].length));
  if ((m = low.match(/^wake\s+(?:me\s+)?(?:up\s+)?(?:at|@|by)?\b/)))
    return out("alarm", (/^wake\s+me/.test(low) ? "" : "wake up ") + s.slice(m[0].length));
  if ((m = low.match(/^(?:remind|rmd|rem)\s+me\s*(?:to|about|that|of|abt)?\b/)))
    return out("remind", s.slice(m[0].length));
  if (
    (m = low.match(
      /^(?:(?:set|make|add|create|new|put)\s+(?:an?\s+)?reminder\s*(?:for|to|about|that)?|don'?t\s+forget\s*(?:to|about)?|dont\s+forget\s*(?:to|about)?)\b/,
    ))
  )
    return out("remind", s.slice(m[0].length));
  if (
    (m = low.match(
      /^(?:add|new|create|make|put)\s+(?:an?\s+)?(event|todo|task|note|page|link|habit|wish|sub|subscription|jot|idea)\b(?:\s+(?:for|to|about|called|named))?/,
    ))
  )
    return out(LOOKUP[m[1]], s.slice(m[0].length));
  if ((m = low.match(/^i\s+(spent|paid|bought|earned|got\s+paid|received|made)\b/)))
    return out(/spent|paid|bought/.test(m[1]) ? "spent" : "earned", s.slice(m[0].length));
  if ((m = low.match(/^got\s+paid\b/))) return out("earned", s.slice(m[0].length));

  const sp = s.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!sp) return out("", "");
  const first = sp[1].toLowerCase().replace(/[:,]$/, ""),
    rest = sp[2] || "";
  let v = LOOKUP[first];
  if (!v) {
    const f = fuzzy(first, [...FUZZY_OK]);
    if (f) v = LOOKUP[f];
    // a typo'd verb only counts when the rest fits it ("evnt quiz fri" yes, "even though..." no)
    if (
      v &&
      ((["alarm", "remind", "event"].includes(v) && !when(rest, { loose: v !== "event" }).hasWhen) ||
        (["spent", "earned"].includes(v) && !amount(rest)))
    )
      v = null;
  }
  if (v) {
    if (KEEP[first]) return out(v, s);
    if (v === "spent" && first === "bought") return out(v, rest);
    return out(v, rest);
  }
  return guess(s);
}
/* no verb: what does the text look like it is? */
export function guess(s) {
  const out = (v, arg) => ({ v, arg: arg.trim(), guessed: true });
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|dev|ph|app|me|co|gg|tv|xyz)\b/i.test(s))
    return out("link", s);
  if (/^[+]/.test(s) && amount(s)) return out("earned", s.slice(1));
  if (/^(₱|\$|php\s*\d|p\d)/i.test(s) || /^\d[\d,.]*k?\s*(php|pesos?|usd|dollars?|bucks)\b/i.test(s))
    return out("spent", s);
  if (/\bwake\s*(me\s*)?up\b/i.test(s)) {
    const w = when(s);
    if (w.hasWhen) return out("alarm", s.replace(/\bwake\s*(me\s*)?up\b/i, "wake up"));
  }
  if (/\b(remind|remember|don'?t forget|dont forget)\b/i.test(s))
    return out(
      "remind",
      s.replace(
        /\b(remind\s+me(\s+to)?|remember\s+to|remember|don'?t\s+forget(\s+to)?|dont\s+forget(\s+to)?)\b/i,
        "",
      ),
    );
  const w = when(s, { bare: false });
  if (w.hasWhen && w.title) return out(w.rel && !w.date && !w.time ? "remind" : "event", s);
  return out("", s);
}
