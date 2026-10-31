# Pack store

Packs change how toybox.os looks and talks: colours, wallpaper, banner, art, mascot pictures and lines, badges, app icons, the assistant's name and voice, and where desktop pieces sit. The Pack store window (Start › Appearance › Pack store, or type `store` in the command bar) lists the packs in this folder and installs them with one tap.

## How it works

- `store/index.json` lists every pack. The app reads it from this repo (`raw.githubusercontent.com/auroraongithub/toyboxos/main/store/`), from your own sync server's `/store/` (put the same folder in `~/sean-os-server/store/`), and from any other store added under ⋯ › Stores.
- Each pack lives in `store/packs/<id>/`: `pack.json` (the file Theme editor › Packs › Export file makes), `meta.json`, and screenshots.
- The index pins every `pack.json` by sha256. The app refuses a file that doesn't match, so a pack can't change after it was reviewed.
- Installing runs the file through the same allowlists as importing a pack by hand: colours must be `#rrggbb`, fonts come from a fixed list, pictures must be inline png/jpeg/webp/gif, icons must be 16×16 grids, layout values are numbers in range. Nothing in a pack can add CSS, scripts or links. Store packs never switch modules on or off.
- Installed packs go into your pack library (Theme editor › Packs) and sync like everything else. Uninstalling the pack you're using puts the built-in look back; Undo reverses either step.
- The assistant's voice (persona) is readable in the store before you install, under Assistant › Read the voice.

## Sharing a pack

1. Make your look in the Theme editor, then Theme editor › Packs › Save current look, and ⋯ › Export file on its tile.
2. Fork this repo and add a folder `store/packs/<id>/` (`id` = 2-32 of `a-z 0-9 -`) with:
   - `pack.json`: the exported file, unchanged.
   - `meta.json`:
     ```json
     {
      "name": "Moss",
      "by": "your name",
      "desc": "One or two sentences on what it looks like.",
      "license": "CC-BY-4.0",
      "credits": "Who drew the art, with a link if they want one.",
      "tags": ["light", "green"],
      "v": "1",
      "thumb": "thumb.webp",
      "shots": ["desktop.webp", "phone.webp"]
     }
     ```
   - Screenshots: `desktop.webp` (around 960×615) and `phone.webp`, plus `thumb.webp` (400×256) for the list. 3 MB each at most.
3. Run `node store/index.mjs` and commit `store/index.json` with your folder. `node store/index.mjs --check` only validates.
4. Open a pull request. No git? Open an issue with the "Share a pack" template and attach the exported file and screenshots instead.

Bumping `v` and updating `pack.json` shows an Update button to people who have the pack.

## Art rules

Fan art packs are welcome. Credit the artists in `credits`, keep it non-commercial, and say in `license` that the rights stay with the artists. A pack comes down if the artist or rights holder asks.
