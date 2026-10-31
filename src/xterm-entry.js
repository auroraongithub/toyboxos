/* Separate lazy bundle (dist/xterm.js + xterm.css): only loaded when the Home server terminal opens. */
import { Terminal } from "../vendor/xterm/xterm.mjs";
import { FitAddon } from "../vendor/xterm/addon-fit.mjs";
import "../vendor/xterm/xterm.css";
window.XTermKit = { Terminal, FitAddon };
