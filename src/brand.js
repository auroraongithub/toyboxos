/* the name lives in one place; double-click the banner (or Start > Rename) to change it */
import { usePref } from "./core/pref.js";
export const DEFAULT_NAME = "toybox.os";
export const useBrand = () => usePref("os-name", DEFAULT_NAME);
