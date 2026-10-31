import { useState, useEffect, useRef } from "preact/hooks";
import { on as featOn } from "../core/features.js";
import { html, today, dAt, timeLabel, rangeLabel } from "../core/lib.js";
import { usePref } from "../core/pref.js";
import { useCols, D, W, drop } from "../core/store.js";
import { toast } from "../core/bus.js";
import { WEEKDAYS, GRID_DAYS, classesOn, weekLayout, weekClock, clockTime } from "../core/schedule.js";
import { Tools, Panel, Group, Btn, Field, Del, Empty, Seg } from "../ui/index.js";
import { openSheet } from "../ui/sheet.js";
import { saveFile } from "../core/files.js";

import { AI } from "../core/pack.js";
const semester = () => D.config.find(x => x._id === "semester");
const openSchedule = () => openSheet({ title: "Semester", Body: SemesterForm });
function semesterDates(s) {
  if (s?.start && s?.end) return rangeLabel(s.start, s.end);
  if (s?.start) return "From " + s.start;
  if (s?.end) return "Until " + s.end;
  return "Repeats every week";
}

function SemesterForm({ close }) {
  const s = semester() || {};
  const [name, setName] = useState(s.name || ""),
    [start, setStart] = useState(s.start || ""),
    [end, setEnd] = useState(s.end || ""),
    [err, setErr] = useState("");
  const save = e => {
    e.preventDefault();
    if (start && end && end < start) {
      setErr("Choose an end date on or after the start.");
      return;
    }
    W.set("config", "semester", { name: name.trim(), start, end });
    close();
  };
  return html`<form class="ask" onSubmit=${save}>
    <label for="sem-name">Semester name</label><${Field} id="sem-name" value=${name} placeholder="2nd semester" maxlength="60" onInput=${e => setName(e.target.value)}/>
    <label for="sem-start">Starts</label><${Field} id="sem-start" type="date" value=${start} onInput=${e => setStart(e.target.value)}/>
    <label for="sem-end">Ends</label><${Field} id="sem-end" type="date" min=${start || undefined} value=${end} onInput=${e => setEnd(e.target.value)}/>
    <div class="mini">Dates are optional. Leave blank to repeat weekly until you clear the schedule.</div>
    ${err ? html`<div role="alert" class="mini">${err}</div>` : null}
    <div class="askb"><span/><${Btn} onClick=${close}>Cancel<//><button type="submit" class="btn go">Save</button></div>
  </form>`;
}

function ClassForm({ entry = {}, close }) {
  const [title, setTitle] = useState(entry.title || ""),
    [room, setRoom] = useState(entry.room || ""),
    [days, setDays] = useState(entry.days || []);
  const [start, setStart] = useState(entry.start || ""),
    [end, setEnd] = useState(entry.end || ""),
    [err, setErr] = useState("");
  const toggle = d => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d]);
  const save = e => {
    e.preventDefault();
    if (!title.trim() || !days.length || !start || !end || end <= start) {
      setErr("Add a class, choose its days, and set an end time after its start.");
      return;
    }
    const doc = { title: title.trim(), room: room.trim(), days, start, end };
    if (entry._id) W.upd("timetable", entry._id, doc);
    else W.add("timetable", doc);
    close();
  };
  return html`<form class="ask" onSubmit=${save}>
    <label for="class-title">Class</label><${Field} id="class-title" value=${title} required maxlength="80" placeholder="CS101" onInput=${e => setTitle(e.target.value)}/>
    <label>Repeats every week</label>${[WEEKDAYS.slice(0, 4), WEEKDAYS.slice(4)].map(group => html`<div class="askb">${group.map(([d, l]) => html`<${Btn} aria-pressed=${String(days.includes(d))} onClick=${() => toggle(d)}>${l}<//>`)}</div>`)}
    <label for="class-start">From</label><${Field} id="class-start" type="time" required value=${start} onInput=${e => setStart(e.target.value)}/>
    <label for="class-end">Until</label><${Field} id="class-end" type="time" required value=${end} onInput=${e => setEnd(e.target.value)}/>
    <label for="class-room">Room / location</label><${Field} id="class-room" value=${room} maxlength="60" onInput=${e => setRoom(e.target.value)}/>
    ${err ? html`<div role="alert" class="mini">${err}</div>` : null}
    <div class="askb">${
      entry._id
        ? html`<${Btn} onClick=${() => {
            drop("timetable", entry._id, "Class removed");
            close();
          }}>Delete<//>`
        : null
    }<span/><${Btn} onClick=${close}>Cancel<//><button type="submit" class="btn go">Save</button></div>
  </form>`;
}
const editClass = entry =>
  openSheet({ title: entry?._id ? "Edit class" : "Add class", Body: ClassForm, props: { entry } });

function clearSemester() {
  const s = semester(),
    snapshot = D.timetable.map(x => ["timetable", x]);
  if (s) snapshot.push(["config", s]);
  W.batch(snapshot.map(([c, x]) => ["del", c, x._id]));
  toast("Semester cleared", {
    label: "Undo",
    run: () => W.batch(snapshot.map(([c, { _id, ...doc }]) => ["set", c, _id, doc])),
  });
}

export function ClassDay({ day }) {
  useCols("timetable", "config");
  const entries = classesOn(D.timetable, semester(), day);
  if (!entries.length) return null;
  return html`<${Group} title="Classes"/>${entries.map(x => html`<div class="lr" key=${x._id}><span class="when">${timeLabel(x.t)}–${timeLabel(x.e)}</span><span class="tt">${x.title}</span>${x.room ? html`<span class="tag">${x.room}</span>` : null}</div>`)}`;
}

function WeekGrid({ semester }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now()),
      timer = setInterval(update, 15000);
    document.addEventListener("visibilitychange", update);
    addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      removeEventListener("focus", update);
    };
  }, []);
  const { blocks, start, end } = weekLayout(D.timetable),
    clock = weekClock(now, semester, start, end);
  const slots = [];
  for (let minute = start; minute < end; minute += 30) {
    const time = clockTime(minute),
      label = timeLabel(dAt(today(), time).getTime()),
      row = minute - start + 2 + " / span 30";
    slots.push(html`<div class="mini wtime" style=${{ gridColumn: 1, gridRow: row }}>${label}</div>`);
    GRID_DAYS.forEach(([day, name], i) =>
      slots.push(
        html`<button type="button" class="mc wslot" tabindex="-1" style=${{ gridColumn: i + 2, gridRow: row }} aria-label=${"Add class " + name + " " + label} onClick=${() => editClass({ days: [day], start: time, end: clockTime(Math.min(minute + 60, 1439)) })}/>`,
      ),
    );
  }
  return html`<div class="weekscroll" role="region" aria-label="Weekly class timetable" tabindex="0"><div class="weekgrid" style=${{ gridTemplateRows: "28px repeat(" + (end - start) + ", 1px)" }}>
    <div class="mgh wcorner" style=${{ gridColumn: 1, gridRow: 1 }}>Time</div>
    ${GRID_DAYS.map(([day, name], i) => html`<div class="mgh whead" aria-current=${clock?.weekday === day ? "date" : null} style=${{ gridColumn: i + 2, gridRow: 1 }}>${name}</div>`)}
    ${slots}
    ${blocks.map(x => {
      const label =
        x.entry.title +
        " · " +
        x.entry.start +
        "–" +
        x.entry.end +
        (x.entry.room ? " · " + x.entry.room : "");
      return html`<button type="button" key=${x.day + ":" + x.entry._id} class=${"btn wclass" + (x.end - x.start < 45 ? " short" : "")} aria-label=${label} title=${label}
        style=${{ gridColumn: GRID_DAYS.findIndex(([day]) => day === x.day) + 2, gridRow: x.start - start + 2 + " / span " + (x.end - x.start), width: "calc(" + 100 / x.columns + "% - 4px)", marginLeft: "calc(" + (100 * x.lane) / x.columns + "% + 2px)" }} onClick=${() => editClass(x.entry)}>
        <b>${x.entry.title}</b>${x.entry.room ? html`<span>${x.entry.room}</span>` : null}<small>${x.entry.start}–${x.entry.end}</small>
      </button>`;
    })}
    ${clock ? html`<div class="wclock" data-minute=${clock.minute} style=${{ gridColumn: "1 / -1", gridRow: clock.minute - start + 2 + " / span 1" }}><span class="tag">${clock.label}</span></div>` : null}
  </div></div>`;
}

function WeekList() {
  return html`${WEEKDAYS.map(([d, l]) => {
    const entries = D.timetable
      .filter(x => x.days?.includes(d))
      .sort((a, b) => a.start.localeCompare(b.start));
    return entries.length
      ? html`<${Group} title=${l}/>${entries.map(x => html`<div class="lr" key=${d + ":" + x._id}><span class="when">${x.start}–${x.end}</span><span class="tt ed" title="Click to edit" onClick=${() => editClass(x)}>${x.title}</span>${x.room ? html`<span class="tag">${x.room}</span>` : null}<${Del} onClick=${() => drop("timetable", x._id, "Class removed")}/></div>`)}`
      : null;
  })}`;
}

export function Schedule() {
  useCols("timetable", "config");
  const s = semester();
  const [view, setView] = usePref("os-sched-view", "grid");
  const image = useRef();
  const importImage = async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { aiBase, draftMessage } = await import("../core/ai.js");
      if (!aiBase()) throw new Error("Connect Sync first so " + AI.name + " can read the image.");
      const id = await saveFile(file, file.name);
      draftMessage(
        "Recreate the weekly classes from this image in my class schedule. Semester dates are optional: keep any existing dates, otherwise leave the schedule undated. Ask about unclear class names or times instead of guessing. Keep existing classes unless I ask to replace them.",
        {
          title: "Import class schedule",
          refs: [{ k: "win", id: "timetable", l: "Class schedule" }],
          img: ["sos:" + id],
        },
      );
    } catch (err) {
      toast(err.message || "Couldn't attach the schedule image");
    }
  };
  let status = "Weekly";
  if (s?.end && today() > s.end) status = "Ended";
  else if (s?.start && today() < s.start) status = "Upcoming";
  return html`<${Tools}><${Btn} onClick=${openSchedule}>${s?.name || "Semester dates"}<//>
    <${Btn} icon="plus" onClick=${() => editClass()}>Add class<//>
    ${featOn("ai") ? html`<${Btn} icon="attach" onClick=${() => image.current.click()}>From image<//>` : null}<input ref=${image} type="file" accept="image/*" aria-label="Schedule image" hidden onChange=${importImage}/>
    <${Btn} disabled=${!s && !D.timetable.length} onClick=${clearSemester}>Clear semester<//>
    <${Seg}><${Btn} icon="grid" aria-label="Weekly grid" aria-pressed=${String(view === "grid")} onClick=${() => setView("grid")}/><${Btn} icon="list" aria-label="Class list" aria-pressed=${String(view === "list")} onClick=${() => setView("list")}/><//><//>
    <${Panel}><div class="ll">
      <${Group} title=${semesterDates(s)} meta=${status}/>
      ${view === "grid" ? html`<${WeekGrid} semester=${s}/>` : html`<${WeekList}/>`}
      ${!D.timetable.length ? html`<${Empty}>No classes yet. Add a class or import an image; semester dates are optional.<//>` : null}
    </div><//>`;
}
