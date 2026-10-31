/* The module registry. Modules (one file each) give commands/search; hubs.js groups them into the 5 windows/tabs.
   Optional ones carry opt:"<feature>" (core/features.js); the live*() lists leave out the ones that are off. */
import { HUBS, EXTRA, ALL_MODULES } from "./hubs.js";
import { modOn } from "../core/features.js";
export const MODULES = ALL_MODULES;
export const WINDOWS = [...HUBS, ...EXTRA];
export { HUBS };
export const liveWindows = () => WINDOWS.filter(modOn);
export const liveHubs = () => HUBS.filter(modOn);
export const liveModules = () => MODULES.filter(modOn);
