import { ls } from "../core/pref.js";
/* [key, label, swatch]. Each key has a [data-skin=...] block in styles/themes.css */
export const SKINS = [
  ["gray", "Gray", "#8c8c8c"],
  ["mono", "Paper", "#f4f4f2"],
  ["night", "Night", "#1d1d22"],
  ["luna", "Luna", "#245edb"],
  ["olive", "Olive", "#8b9a5b"],
  ["teal", "Teal", "#0e8686"],
  ["sage", "Sage", "#8ba587"],
  ["bubble", "Bubblegum", "#ef7aa6"],
  ["cherry", "Cherry", "#a8243a"],
  ["lilac", "Lilac", "#8a78d6"],
  ["sepia", "Sepia", "#9a7b55"],
];
/* picking a skin (keep=false) switches the custom theme off; the theme editor passes keep=true for its base skin */
export const applySkin = (k, keep) => {
  if (!SKINS.some(s => s[0] === k)) return;
  const r = document.documentElement;
  r.dataset.skin = k;
  ls.set("os-skin", k);
  const t = ls.get("os-theme", null);
  if (!keep && t && t.on) {
    ls.set("os-theme", { ...t, on: false });
    delete r.dataset.custom;
  }
};
export const initSkin = () => {
  document.documentElement.dataset.skin = ls.get("os-skin", "gray");
};
