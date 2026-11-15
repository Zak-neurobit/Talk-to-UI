# Talk-to-UI

Point at your running site and say what to change. Talk-to-UI puts a small toolbar on your local dev server: pick or circle anything on the page, type or dictate what you want, and your AI writes 1-5 versions straight into your code. Flip through them live, the original included, and keep the one you like.

Works with **Claude Code** and **Codex**.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Zak-neurobit/Talk-to-UI/main/install.sh | bash
```

This installs the skill into `~/.claude/skills` and/or `~/.codex/skills`, whichever you have, and a small always-on launcher that starts at login. Needs Node.js 18+.

**Then, once:** add the browser extension. Open `chrome://extensions` (Chrome, Comet, Arc, Edge, Brave), turn on **Developer mode**, click **Load unpacked**, and choose `~/.talk-to-ui/app/extension`.

## Use

1. Run your dev server as usual and open the site. Any localhost page of a project on your computer gets the toolbar: a small lime mark at the bottom. Hover it to open.
2. **Pick** something (or circle it), say what you want, press Enter. Your AI (Claude Code or Codex, signed in as you) writes the versions in the background; no terminal needed.
3. Use ← → to flip through the versions. The first stop is your original. Enter keeps one; Escape throws them all away.

The first time a project is opened, Talk-to-UI checks which models your account can run (about 15 seconds).

Prefer a terminal? Open the project in Claude Code or Codex and say **"start talk-to-ui"**: it adds the toolbar to the page itself and you watch the AI work.

Any dictation app works in the text box (macOS Dictation, Hex, Wispr Flow): click a part of the page and the cursor is already there.

## The toolbar

| | |
|---|---|
| **Pick · Auto** | Hover to outline an element, click to choose it |
| **Pick · Draw** | Circle anything; the AI gets a picture of exactly what you circled, the page, and the code under it |
| **Variants** | How many versions to write: ×1 to ×5, or **Just do it**: one real change in whatever files it needs (wire a button to a page, make a number call on tap) |
| **Design** | Shows your project's DESIGN.md, if it has one |
| **Model** | The models your account can run, plus a reasoning-level slider |

Every option shows its name on hover, and options with a menu open it on hover.

## What it changes in your project

- A `.talk-to-ui/` folder for its own state, kept out of git through `.git/info/exclude`.
- Terminal mode only: one script tag in your page shell (e.g. `app/layout.tsx`) while the toolbar runs. Stopping Talk-to-UI removes it. **Don't commit or deploy while it's there.** The extension needs no tag.
- While versions are open, they sit side by side in your source file. Keeping one, or discarding, cleans the rest up.

## Frameworks

Setup covers Next.js (App and Pages router), Vite/React, Nuxt, SvelteKit, Astro, and plain multi-page HTML. Tested so far on Next.js 16.

## License

Free for personal, hobby, research, educational and non-profit use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). **Commercial use needs a paid license**: open an issue to ask.

Parts of Talk-to-UI are derived from an Apache-2.0 project; those parts stay under Apache 2.0. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
