/* The active pack: art, persona, badges, eggs that make this OS someone's own. The shell reads pictures only from here.
   Packs live in src/packs/<id>/index.js; build.mjs picks SOS_PACK, else osage when it is there, else default.
   BASE is the build's pack untouched (what the editors reset to); `pack`/ART/AI are live: core/look.js lays the
   user's edits (config/look) over them in place, so read them at render time, never copy them at load. */
import base from "sos-pack"; // build.mjs points this at src/packs/<SOS_PACK>/index.js
export const BASE = {
  ...base,
  art: { ...base.art },
  ai: { ...base.ai },
  widgets: { ...(base.widgets || {}) },
  icons: { ...(base.icons || {}) },
};
export const pack = {
  ...base,
  art: { ...base.art },
  ai: { ...base.ai },
  widgets: { ...(base.widgets || {}) },
  icons: { ...(base.icons || {}) },
};
export const ART = pack.art;
/* the assistant: name (labels, buttons), full name, pronoun, persona (core/prompt.js) */
export const AI = pack.ai;
