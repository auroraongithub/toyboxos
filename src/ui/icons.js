import { html } from "../core/lib.js";
import BRANDS from "../data/brands.js";
export const IC = {
  today:
    '<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/>',
  jobs: '<rect x="2" y="5" width="12" height="8"/><path d="M6 5V3h4v2M2 9h12"/>',
  calendar: '<rect x="2" y="3" width="12" height="11"/><path d="M2 7h12M5 1v3M11 1v3"/>',
  board: '<path d="M2 2h3v12H2zM6.5 2h3v8h-3zM11 2h3v5h-3z"/>',
  notes: '<path d="M3 2h10v12H3zM5.5 6h5M5.5 9h5M5.5 11.5h3"/>',
  pomodoro: '<circle cx="8" cy="9" r="5"/><path d="M8 9V6M6 2h4"/>',
  money: '<circle cx="8" cy="8" r="6"/><path d="M8 4v8M10 6H7a1.5 1.5 0 000 3h2a1.5 1.5 0 010 3H6"/>',
  wishlist: '<path d="M8 1.5l2 4.5 4.5.3-3.4 3 1.1 4.7L8 11.4 3.8 14l1.1-4.7-3.4-3L6 6z"/>',
  cmd: '<circle cx="7" cy="7" r="5"/><path d="M10.6 10.6L14.5 14.5M5.4 5.2l2 1.8-2 1.8"/>',
  reset: '<g transform="translate(0 1)"><path d="M3 8a5 5 0 105-5H5M5 1L3 3l2 2"/></g>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  list: '<path d="M5 4h9M5 8h9M5 12h9M2 4h.5M2 8h.5M2 12h.5"/>',
  grid: '<path d="M2 2h12v12H2zM2 8h12M8 2v12"/>',
  play: '<path d="M5 3l8 5-8 5z"/>',
  pause: '<path d="M5 3v10M11 3v10"/>',
  undo: '<g transform="translate(0 1)"><path d="M3 8a5 5 0 105-5H5M5 1L3 3l2 2"/></g>',
  more: '<path d="M3 8h.5M8 8h.5M13 8h.5"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>',
  links: '<path d="M6.5 9.5l3-3M5 8L3.5 9.5a2.1 2.1 0 003 3L8 11M11 8l1.5-1.5a2.1 2.1 0 00-3-3L8 5"/>',
  habits: '<path d="M2 3h12v10H2zM2 6.5h12M6 3v10M10 3v10"/>',
  key: '<circle cx="5" cy="10.5" r="2.8"/><path d="M7 8.5L13 2.5M11 4.5l1.8 1.8M9.3 6.2l1.4 1.4"/>',
  sync: '<path d="M3 8a5 5 0 019-3M13 3v3h-3M13 8a5 5 0 01-9 3M3 13v-3h3"/>',
  open: '<g transform="translate(-1 1)"><path d="M6 3h7v7M13 3L5 11"/></g>',
  saved: '<path d="M4 2.5h8v11l-4-2.8-4 2.8z"/>',
  applied: '<path d="M3 8.5l3.2 3L13 4.5"/>',
  skip: '<path d="M4 4l8 8M12 4l-8 8"/>',
  export: '<path d="M8 2v8M5 7l3 3 3-3M3 13h10"/>',
  import: '<path d="M8 10V2M5 5l3-3 3 3M3 13h10"/>',
  note: '<path d="M3 2h7l3 3v9H3zM10 2v3h3"/>',
  person: '<circle cx="8" cy="5" r="3"/><path d="M2.5 14c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5"/>',
  company: '<path d="M2 14V3h7v11M9 7h5v7M2 14h12M4.5 5.5h2M4.5 8.5h2M4.5 11.5h2M11 9.5h.5M11 12h.5"/>',
  place:
    '<path d="M8 14.5s-4.5-4.2-4.5-7.7a4.5 4.5 0 019 0c0 3.5-4.5 7.7-4.5 7.7z"/><circle cx="8" cy="6.8" r="1.6"/>',
  thing: '<path d="M2 8.5V2.5h6l6 6-6 6z"/><circle cx="5.2" cy="5.7" r=".9"/>',
  back: '<path d="M10 3L5 8l5 5"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8"/><path d="M3 10.5V2.5h8"/>',
  edit: '<path d="M3 13l1-3.5L10.5 3 13 5.5 6.5 12zM9 4.5L11.5 7"/>',
  image:
    '<rect x="2" y="3" width="12" height="10"/><path d="M2 11l3.5-3.5 3 3 2-2L14 12"/><circle cx="10.5" cy="6" r="1"/>',
  table: '<path d="M2 3h12v10H2zM2 6.5h12M2 10h12M6.5 6.5V13"/>',
  task: '<rect x="2" y="2.5" width="11" height="11"/><path d="M4.5 8l2 2 4-4"/>',
  bullets:
    '<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.8" cy="4" r=".8"/><circle cx="2.8" cy="8" r=".8"/><circle cx="2.8" cy="12" r=".8"/>',
  code: '<path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4"/>',
  wiki: '<path d="M5 3H3v10h2M11 3h2v10h-2M6.5 8h3"/>',
  pin: '<path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6zM8 8.5V14"/>',
  trash: '<path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5"/>',
  subject:
    '<path d="M2.5 3.5c2-.8 3.8-.8 5.5.5v9.5c-1.7-1.3-3.5-1.3-5.5-.5zM13.5 3.5c-2-.8-3.8-.8-5.5.5v9.5c1.7-1.3 3.5-1.3 5.5-.5z"/>',
  cards: '<rect x="2" y="4.5" width="9" height="9"/><path d="M5 4.5V2.5h9v9h-3"/>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  down: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  plan: '<rect x="2" y="3" width="12" height="11"/><path d="M2 7h12M5 1v3M11 1v3M4.5 10l1.5 1.5 3-3"/>',
  subs: '<path d="M3 7a5 5 0 019-2.5M13 2v3h-3M13 9a5 5 0 01-9 2.5M3 14v-3h3"/>',
  gear: '<path d="M2 4h12M2 8h12M2 12h12"/><rect x="9.5" y="2.5" width="2.5" height="3" fill="currentColor"/><rect x="4" y="6.5" width="2.5" height="3" fill="currentColor"/><rect x="8" y="10.5" width="2.5" height="3" fill="currentColor"/>',
  indent: '<path d="M7 4h7M7 8h7M7 12h7M2 5.5L4.5 8 2 10.5"/>',
  outdent: '<path d="M7 4h7M7 8h7M7 12h7M4.5 5.5L2 8l2.5 2.5"/>',
  chev: '<path d="M3.5 6l4.5 4.5L12.5 6"/>',
  buddy: '<path d="M2 3h12v8H8l-3.5 3v-3H2zM5 6.5h6M5 8.5h3.5"/>',
  sources:
    '<path d="M2 3h4.5A1.5 1.5 0 018 4.5V14a1.5 1.5 0 00-1.5-1.5H2zM14 3H9.5A1.5 1.5 0 008 4.5V14a1.5 1.5 0 011.5-1.5H14z"/>',
  send: '<path d="M2 8l12-5.5L10 14l-2-5zM8 9l6-6.5"/>',
  attach: '<path d="M10.5 4.5l-5 5a1.4 1.4 0 002 2l5.5-5.5a2.8 2.8 0 00-4-4L3.5 7.5a4.2 4.2 0 006 6l4-4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3L14 14"/>',
  globe: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/>',
  inbox: '<path d="M2 9l2-6h8l2 6v4H2zM2 9h4l1 2h2l1-2h4"/>',
  bell: '<path d="M8 1.8a3.6 3.6 0 013.6 3.6v2.3l1.2 2.2H3.2l1.2-2.2V5.4A3.6 3.6 0 018 1.8zM6.5 12.2a1.5 1.5 0 003 0"/>',
  alarm: '<circle cx="8" cy="9" r="5"/><path d="M8 6.2V9l2 1.4M2.2 4.2L4.6 2M13.8 4.2L11.4 2"/>',
  graph:
    '<circle cx="4" cy="4" r="1.8"/><circle cx="12" cy="5" r="1.8"/><circle cx="7" cy="12" r="1.8"/><path d="M5.7 4.3l4.5.5M4.8 5.6l1.5 4.7M11 6.6l-3 3.9"/>',
  calc: '<rect x="3" y="1.5" width="10" height="13"/><path d="M5 4.5h6M5.5 8h.5M8 8h.5M10.5 8h.5M5.5 11h.5M8 11h.5M10.5 11h.5"/>',
  graphc: '<path d="M2 2v12h12M4 11.5c2-8 4-8 5.2-3.5s2.200 3 3.800-2"/>',
  whiteboard:
    '<rect x="1.5" y="2.5" width="13" height="9"/><path d="M8 11.5V14M5 14h6M4 8.5c1.2-2.6 2.2-2.6 2.8 0s2 2.4 4.7-2.3"/>',
  pointer: '<path d="M4 2l8.5 7-4.2.4 2.4 4.3-1.7.8-2.3-4.3L4 13.2z"/>',
  hand: '<g transform="translate(1.25 0)"><path d="M5 8.5V4.2a1 1 0 012 0V7.5V3a1 1 0 012 0v4.5V4a1 1 0 012 0v5.5c0 3-1.8 4.6-4.1 4.6-1.6 0-2.6-.8-3.5-2.1L2.7 9.6a1 1 0 011.6-1.2L5 9.4"/></g>',
  pen: '<path d="M2.5 13.5l.8-3.2L10.8 2.8l2.4 2.4-7.5 7.5zM9.4 4.2l2.4 2.4M3.3 10.3l2.4 2.4"/>',
  marker:
    '<g transform="translate(0 -1)"><path d="M6.2 11.2L3.6 13.8H2v-1.6l2.6-2.6M4.6 9.6l6-6.6 3 3-6.6 6M2 15h6"/></g>',
  eraser: '<path d="M9.6 2.4l4 4-6.6 6.6H4.2L2 10.8zM6 6l4 4M8 13h6"/>',
  text: '<path d="M3 4.5v-2h10v2M8 2.5v11M5.8 13.5h4.4"/>',
  sticky: '<path d="M2.5 2.5h11v7.2l-3.8 3.8H2.5zM13.5 9.7H9.7v3.8"/>',
  rect: '<rect x="2.5" y="3.5" width="11" height="9"/>',
  ellipse: '<ellipse cx="8" cy="8" rx="6" ry="4.8"/>',
  arrow: '<path d="M3 13L13 3M7.5 3H13v5.5"/>',
  line: '<path d="M3 13L13 3"/>',
  redo: '<g transform="translate(0 1)"><path d="M13 8a5 5 0 11-5-5h3M11 1l2 2-2 2"/></g>',
  snap: '<path d="M2.5 13.5l7.5-7.5M11.5 1.5v2.5M14.5 4.5H12M13.6 2.4l-1.6 1.6M8.5 3.2l.9.9M12.8 7.5l-.9-.9"/>',
  minus: '<path d="M3 8h10"/>',
  compact: '<path d="M8 1v4M5 3l3 3 3-3M8 15v-4M5 13l3-3 3 3M2 8h12"/>',
  bucket:
    '<path d="M2.5 8.5L8 3l5.5 5.5L8 14zM2.5 8.5h11M14.5 12c0 .8-.4 1.5-1 1.5s-1-.7-1-1.5.4-1.3 1-2.2c.6.9 1 1.4 1 2.2z"/>',
  moodle: '<path d="M1 6l7-3 7 3-7 3zM4 7.5V11c1 1.2 2.4 1.8 4 1.8s3-.6 4-1.8V7.5M14.5 6.3V10"/>',
  nijika:
    '<rect x="2" y="2" width="12" height="5"/><rect x="2" y="9" width="12" height="5"/><path d="M4.5 4.5h1M4.5 11.5h1M9 4.5h3M9 11.5h3"/>',
  term: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M4 6l2.5 2L4 10M8 10.5h4"/>',
  folder: '<g transform="translate(0 -.75)"><path d="M1.5 4h5l1.5 1.5h6.5v8h-13z"/></g>',
  file: '<path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3"/>',
  alignl: '<path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8"/>',
  alignc: '<path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8"/>',
  alignr: '<path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8"/>',
  alignj: '<path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12"/>',
  svc: '<rect x="2" y="3" width="12" height="4"/><rect x="2" y="9" width="12" height="4"/><path d="M4.5 5h.5M4.5 11h.5"/>',
};
/* every icon carries its pixel twin when one exists (appicons.js registers the lookup here, which keeps the imports
   one-way); CSS shows the twin, and the line drawing only where there is none or the icon is tiny (shell.css) */
let pixel = null;
export const setPixel = f => (pixel = f);
const svgs = new Map();
const inner = n => {
  const px = pixel && pixel(n);
  const k = n + " " + (px || "");
  if (!svgs.has(k)) svgs.set(k, `<g class="ln">${IC[n] || ""}</g>` + (px ? `<g class="px">${px}</g>` : ""));
  return svgs.get(k);
};
export const Icon = ({ n }) =>
  html`<svg class="ic" viewBox="0 0 16 16" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: inner(n) }}/>`;
export const brands = BRANDS;
export const Brand = ({ slug }) => {
  const i = BRANDS[slug];
  return i ? html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${i.p}/></svg>` : null;
};
export const brandFor = n =>
  (Object.entries(BRANDS).find(
    ([k, i]) => i.t.toLowerCase() === String(n).toLowerCase() || k === String(n).toLowerCase(),
  ) || [null])[0];
