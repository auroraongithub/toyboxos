/* page icon picker: a curated emoji grid (study first), or paste any emoji */
import { useState } from "preact/hooks";
import { html } from "../core/lib.js";
import { Icon } from "./icons.js";
import { openSheet } from "./sheet.js";

export const EMOJI = {
  Study: [
    "📚",
    "📖",
    "📓",
    "📒",
    "📝",
    "✏️",
    "🖊️",
    "📐",
    "📏",
    "🧮",
    "🧪",
    "🔬",
    "🧬",
    "⚗️",
    "🧠",
    "💻",
    "⌨️",
    "🖥️",
    "📊",
    "📈",
    "🗂️",
    "📁",
    "🎓",
    "🏫",
    "🌍",
    "🗺️",
    "🏛️",
    "⚖️",
    "💬",
    "🗣️",
    "🎨",
    "🎵",
    "🎹",
    "⚽",
    "🩺",
    "💊",
    "🧾",
    "💼",
  ],
  People: [
    "🙂",
    "😊",
    "😎",
    "🤓",
    "🥰",
    "😴",
    "🧑",
    "👩",
    "👨",
    "👧",
    "👦",
    "👵",
    "👴",
    "🧑‍🎓",
    "🧑‍💻",
    "🧑‍🏫",
    "👩‍⚕️",
    "🧑‍🍳",
    "👪",
    "🤝",
    "💑",
    "🫂",
    "🐱",
    "🐶",
    "🐦",
  ],
  Places: [
    "🏠",
    "🏡",
    "🏢",
    "🏬",
    "🏥",
    "🏪",
    "🏨",
    "⛪",
    "🕌",
    "🏝️",
    "🏖️",
    "⛰️",
    "🌆",
    "🌃",
    "🚉",
    "✈️",
    "🚗",
    "🛵",
    "☕",
    "🍜",
    "🍔",
  ],
  Things: [
    "⭐",
    "💡",
    "📌",
    "🔖",
    "🏷️",
    "✅",
    "❗",
    "❓",
    "⚠️",
    "🔥",
    "❤️",
    "💜",
    "🌱",
    "🌸",
    "🍀",
    "🎯",
    "📅",
    "⏰",
    "💰",
    "🛒",
    "🎁",
    "🎮",
    "📷",
    "🔑",
    "🧩",
    "🚀",
    "🌙",
    "☀️",
    "🌧️",
    "⚡",
  ],
};

function Grid({ value, onPick, close }) {
  const [own, setOwn] = useState("");
  const pick = v => {
    close();
    onPick(v);
  };
  return html`<div class="ipp">
    <div class="ipt"><input class="field" placeholder="Paste any emoji" maxlength="8" value=${own} onInput=${e => setOwn(e.target.value)} onKeyDown=${e => {
      if (e.key === "Enter" && own.trim()) pick(own.trim());
    }}/>
      <button class="btn" onClick=${() => (own.trim() ? pick(own.trim()) : pick(""))}>${own.trim() ? "Use" : "No icon"}</button></div>
    <div class="ipg">${Object.entries(EMOJI).map(([g, l]) => html`<small>${g}</small><div class="ipr">${l.map(x => html`<button class=${"ipe" + (x === value ? " on" : "")} onClick=${() => pick(x)} aria-label=${x}>${x}</button>`)}</div>`)}</div>
  </div>`;
}
export function IconPick({ value, kind, onPick }) {
  return html`<div class="ipk"><button class="ipb" title="Change icon" aria-label="Change icon" onClick=${e => openSheet({ title: "Page icon", Body: Grid, props: { value, onPick }, at: e.currentTarget })}>${value ? html`<span class="emj">${value}</span>` : html`<${Icon} n=${kind || "note"}/>`}</button></div>`;
}
