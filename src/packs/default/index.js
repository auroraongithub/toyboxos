/* The neutral pack: no character art, a plain assistant. Builds use it when the checkout has no osage pack (or SOS_PACK=default).
   Copy this folder to make your own: fill art slots with imports (./art/x.webp), anything left null is simply not drawn. */
/* the toybox.os logo + wordmark are the app's own branding (assets/), shared by every pack */
import logo from "../../../assets/logo.webp";
import wordmark from "../../../assets/wordmark.webp";
import ai from "./ai.js";

export default {
  id: "default",
  name: "Plain",
  ai, // assistant name + persona (ai.js)
  modules: {}, // optional modules on by default: ai, jobs, moodle, nijika, hermes, changes (core/features.js)
  icons: {}, // redraw any app icon: {today: [16 rows of 16 cells, K D M L W .], ...} (ui/appicons.js)
  servers: null, // {sync, admin}: a server a fresh install offers; none = the first run asks
  art: {
    banner: null,
    bannerFace: null,
    logo,
    wordmark,
    avatar: logo,
    startArt: null,
    stand: null,
    clockPeek: null,
    mascotPeek: null,
    jobsPeek: null,
    panelFill: null,
    emptyNotes: null,
    aiAvatar: null,
    egg: null,
  },
  badges: [
    { style: "b", text: "{name}" },
    { style: "a", text: "BEST IN\n800×600" },
    { style: "c", text: "MADE W/\n♥ + HTML" },
    { style: "f", text: "LOCAL\nFIRST" },
  ],
  widgets: { clock: true, counter: null, mascot: false },
  eggs: null,
  mascot: null,
};
