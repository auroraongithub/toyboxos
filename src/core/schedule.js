import { dAt, dkey, hm, timeLabel } from "./lib.js";

export const WEEKDAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];
export const GRID_DAYS = [[0, "Sun"], ...WEEKDAYS.slice(0, 6)];
export const minutes = time => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
export const clockTime = n =>
  String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
export const semesterActive = (semester, day) =>
  (!semester?.start || day >= semester.start) && (!semester?.end || day <= semester.end);

/* Accept common AI representations, but store just one unambiguous numeric format. */
export function normalizeWeekdays(value) {
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\[/.test(text)) {
      try {
        value = JSON.parse(text);
      } catch {
        return null;
      }
    } else if (/^mwf$/i.test(text)) value = [1, 3, 5];
    else if (/^tth$/i.test(text)) value = [2, 4];
    else
      value = text
        .replace(/\band\b/gi, ",")
        .split(/[\s,;/&]+/)
        .filter(Boolean);
  }
  if (!Array.isArray(value) || !value.length || value.length > 32) return null;
  const names = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    th: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  const days = [];
  for (const v of value) {
    let day = v;
    if (typeof v === "string") {
      const key = v
        .trim()
        .toLowerCase()
        .replace(/^['"]|['"]$/g, "");
      day = /^[0-6]$/.test(key) ? Number(key) : names[key];
    }
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    days.push(day);
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/* Expand just the requested day; the weekly template never creates calendar documents. */
export function classesOn(entries, semester, day) {
  if (!semesterActive(semester, day)) return [];
  const weekday = dAt(day).getUTCDay();
  return entries
    .filter(x => x.days?.includes(weekday) && x.start < x.end)
    .map(x => ({
      ...x,
      t: dAt(day, x.start).getTime(),
      e: dAt(day, x.end).getTime(),
    }))
    .sort((a, b) => a.t - b.t || a.title.localeCompare(b.title));
}

/* Overlapping classes share a day column instead of covering each other. */
export function weekLayout(entries) {
  const blocks = [];
  for (const [day] of GRID_DAYS) {
    const sessions = entries
      .filter(x => x.days?.includes(day) && x.start < x.end)
      .map(entry => ({ entry, day, start: minutes(entry.start), end: minutes(entry.end) }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    let group = [],
      lanes = [],
      until = 0;
    const flush = () => {
      blocks.push(...group.map(x => ({ ...x, columns: lanes.length })));
      group = [];
      lanes = [];
    };
    for (const session of sessions) {
      if (group.length && session.start >= until) flush();
      let lane = lanes.findIndex(end => end <= session.start);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = session.end;
      group.push({ ...session, lane });
      until = Math.max(...lanes);
    }
    flush();
  }
  return {
    blocks,
    start: Math.min(420, ...blocks.map(x => Math.floor(x.start / 60) * 60)),
    end: Math.max(1140, ...blocks.map(x => Math.ceil(x.end / 60) * 60)),
  };
}

export function weekClock(now, semester, start, end) {
  const day = dkey(new Date(now)),
    minute = minutes(hm(now));
  if (!semesterActive(semester, day) || minute < start || minute >= end) return null;
  return { minute, weekday: dAt(day).getUTCDay(), label: timeLabel(now) };
}
