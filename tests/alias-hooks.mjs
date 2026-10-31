import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
/* the same pack choice as build.mjs: SOS_PACK, else osage when this checkout has it, else default */
const pack =
  process.env.SOS_PACK ||
  (existsSync(fileURLToPath(new URL("src/packs/osage/index.js", root))) ? "osage" : "default");
const MAP = {
  "sos-pack": `src/packs/${pack}/index.js`,
  preact: "vendor/preact.mjs",
  "preact/hooks": "vendor/hooks.mjs",
  htm: "vendor/htm.mjs",
};
export async function resolve(spec, ctx, next) {
  if (MAP[spec]) return { url: new URL(MAP[spec], root).href, shortCircuit: true };
  return next(spec, ctx);
}
/* the bundle inlines images and css; tests only need them to load */
export async function load(url, ctx, next) {
  if (/\.(webp|png|gif|jpe?g|css)$/.test(url))
    return { format: "module", source: 'export default "";', shortCircuit: true };
  return next(url, ctx);
}
