/* Phone layout (Start > Phone layout on phones, the edit bar's Phone… on desktop): phones stack the side widgets
   under Today, so instead of free placement they get a list: order the sections, show or hide each one and each
   badge. Saved with the layout (core/layout.js ph), so "This device only" covers it too. */
import { html } from "../core/lib.js";
import { useLayout, phone, setPhone } from "../core/layout.js";
import { pack } from "../core/pack.js";
import { useBrand } from "../brand.js";
import { openSheet } from "../ui/sheet.js";
import { Btn, Check } from "../ui/index.js";
import { Badge } from "./chrome.js";
import { StickerBody, desktopStickers } from "./stickers.js";

const NAMES = { badges: "Badges", clock: "Clock", mascot: "Mascot window", stickers: "Stickers" };
function List() {
  const L = useLayout(),
    P = phone(),
    [name] = useBrand(),
    st = desktopStickers(L);
  const move = (i, d) => {
    const o = [...P.order],
      j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setPhone({ order: o });
  };
  const flip = k => {
    const h = { ...P.hide };
    if (h[k]) delete h[k];
    else h[k] = true;
    setPhone({ hide: h });
  };
  return html`<div class="phl">
    ${P.order.map(
      (k, i) => html`<div key=${k} class="phl-s">
      <div class="phl-r"><label class="phl-n"><${Check} on=${!P.hide[k]} label=${"Show " + NAMES[k]} onClick=${() => flip(k)}/>${NAMES[k]}</label>
        <${Btn} icon="up" aria-label=${"Move " + NAMES[k] + " up"} disabled=${!i} onClick=${() => move(i, -1)}/>
        <${Btn} icon="down" aria-label=${"Move " + NAMES[k] + " down"} disabled=${i === P.order.length - 1} onClick=${() => move(i, 1)}/></div>
      ${
        k === "badges" && !P.hide.badges && (pack.badges || []).length
          ? html`<div class="phl-b">${pack.badges.map(
              (b, j) => html`<label key=${j} class=${"phl-bi" + (P.hide["badge:" + j] ? " off" : "")}>
          <${Check} on=${!P.hide["badge:" + j]} label=${"Show badge " + (j + 1)} onClick=${() => flip("badge:" + j)}/><${Badge} b=${b} name=${name}/></label>`,
            )}</div>`
          : null
      }
      ${
        k === "stickers" && !P.hide.stickers
          ? st.length
            ? html`<div class="phl-b">${st.map(
                ([id, v], j) => html`<label key=${id} class=${"phl-bi" + (P.hide[id] ? " off" : "")}>
          <${Check} on=${!P.hide[id]} label=${"Show sticker " + (j + 1)} onClick=${() => flip(id)}/><span class="phl-st"><${StickerBody} p=${v.k === "text" ? { ...v, size: 14 } : v}/></span></label>`,
              )}</div>`
            : html`<div class="phl-b"><small>Add stickers in Edit layout on a computer.</small></div>`
          : null
      }
    </div>`,
    )}
  </div>`;
}
export const openPhoneList = () => openSheet({ title: "Phone layout", Body: List });
