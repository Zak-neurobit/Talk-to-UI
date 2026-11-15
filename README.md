# Talk-to-UI

Point at your running site and say what to change. Talk-to-UI puts a small toolbar on your local dev server: pick or circle anything on the page, type or dictate what you want, and your AI writes 1-5 versions straight into your code. Flip through them live, the original included, and keep the one you like.

Works with **Claude Code** and **Codex**.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Zak-neurobit/Talk-to-UI/main/install.sh | bash
```

This copies the skill into `~/.claude/skills` and/or `~/.codex/skills`, whichever you have. Needs Node.js 18+.

## Use

1. Open your project in Claude Code or Codex and say **"start talk-to-ui"**.
2. It finds or starts your dev server, adds the toolbar, and checks which models your account can run (about 10 seconds, once per project).
3. Open the site. The toolbar rests as a small lime mark at the bottom: hover it to open.
4. **Pick** something (or circle it), say what you want, press Enter.
5. Use ← → to flip through the versions. The first stop is your original. Enter keeps one; Escape throws them all away.

Any dictation app works in the text box (macOS Dictation, Hex, Wispr Flow): click a part of the page and the cursor is already there.

## The toolbar

| | |
|---|---|
| **Pick · Auto** | Hover to outline an element, click to choose it |
| **Pick · Draw** | Circle anything; the AI gets a picture of exactly what you circled, the page, and the code under it |
| **Variants** | How many versions to write: ×1 to ×5 |
| **Design** | Shows your project's DESIGN.md, if it has one |
| **Model** | The models your account can run, plus a reasoning-level slider. Your terminal's own model is fastest; others start a helper (about 10 s extra) |

Every option shows its name on hover, and options with a menu open it on hover.

## What it changes in your project

- One script tag in your page shell (e.g. `app/layout.tsx`) while the toolbar runs. Stopping Talk-to-UI removes it. **Don't commit or deploy while it's there.**
- A `.talk-to-ui/` folder for its own state. Add it to `.gitignore` (the AI adds it to `.git/info/exclude` for you).
- While versions are open, they sit side by side in your source file. Keeping one, or discarding, cleans the rest up.

## Frameworks

Setup covers Next.js (App and Pages router), Vite/React, Nuxt, SvelteKit, Astro, and plain multi-page HTML. Tested so far on Next.js 16.

## License

Free for personal, hobby, research, educational and non-profit use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). **Commercial use needs a paid license**: open an issue to ask.

Parts of Talk-to-UI are derived from an Apache-2.0 project; those parts stay under Apache 2.0. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
