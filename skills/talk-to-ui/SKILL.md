---
name: talk-to-ui
description: Talk to your running web app's UI. Starts a toolbar on the local dev site (Next.js, Vite, Astro, SvelteKit, Nuxt, plain HTML) where the user picks an element (hover to outline, or draw a circle around anything), types or dictates what they want, and gets 1-5 versions written into the real source and hot-swapped live, with the original as the first stop; keeping one saves it to the code. Includes a model + reasoning picker for the AI that writes the versions. Use when the user says "talk to the UI", "talk-to-ui", "live edit", "edit the UI in the browser", "let me click on things and change them", or wants to iterate on a page while it is open in the browser.
---

Talk-to-UI puts a toolbar on the user's local dev site. They pick something on the page, say what they want, and you write the versions straight into their source; the dev server's hot reload swaps them in.

`<skill-dir>` below means the folder this SKILL.md lives in. Run every script from the **project root** (the folder with the app's `package.json`), so its state lands in that project's `.talk-to-ui/`.

## Start (in order)

1. **Dev server.** Find the URL that serves the app (terminal output, `package.json` scripts, or an open tab). If nothing is running, start it in the background. The toolbar's helper port (8400) is not the app URL.
2. **Boot the toolbar:** `node <skill-dir>/scripts/live.mjs`. If it returns `config_missing` / `config_invalid`, do **First-time setup** in [reference/live.md](reference/live.md), then run it again. Add `.talk-to-ui/` and `.talk-to-ui-live/` to `.git/info/exclude` so its state never gets committed.
3. **Model check (once per project, ~10 s):** `node <skill-dir>/scripts/models.mjs --provider <claude|codex> --terminal <the model you are running as>`. For Claude Code the terminal id is the alias (`opus`, `sonnet`, `haiku`, `fable`); for Codex it is the model slug. This writes `.talk-to-ui/live/models.json`, which fills the toolbar's model menu with what this account can actually run. Never write that list from your own knowledge of model names.
4. **Tell the user** the app URL in one line, and that the toolbar rests as a lime mark at the bottom: hover it to open.
5. **Listen.** Follow the poll loop in [reference/live.md](reference/live.md). Claude Code: run the poll as a background task and pass `--timeout=1800000` so an idle user costs one check-in per 30 minutes. Codex: run it in the foreground.

## Which model writes the versions

Every `generate` event carries `model` and `effort` from the toolbar's picker.

- `model` missing, or equal to `terminal` in `models.json`: do the work yourself.
- Any other model, **Claude Code**: hand the whole event to one subagent with the Agent tool, `model` = the event's model and `effort` = the event's effort. Brief it with the event JSON, `<skill-dir>`, and the instruction to run [reference/live.md](reference/live.md) "Handle generate" steps 1-8 for that event, including `--reply EVENT_ID done`. Wait for it, check the reply went out, then poll again.
- Any other model, **Codex**: run `codex exec -m <model> -c model_reasoning_effort=<effort> --sandbox workspace-write "<the same brief>"` from the project root, then poll again.

## Requests with nothing to act on

If a `generate` event has no `freeformPrompt`, no comment text, and the action is the freeform one (`ttui`), there is no instruction: reply `--reply EVENT_ID error "Got it, but no instruction came with it. Type or say what to change, then press Go."` instead of guessing a redesign.

## Design rules

Variants stay inside the site's existing identity unless the user asks for a departure. Read [reference/design-laws.md](reference/design-laws.md), plus [reference/brand.md](reference/brand.md) for marketing pages or [reference/product.md](reference/product.md) for app screens. If the project has `PRODUCT.md` / `DESIGN.md` (the toolbar's Design button shows it), they win on voice and visuals; `live.mjs` loads them for you. To create a DESIGN.md from the code, follow [reference/document.md](reference/document.md) when the user asks.

## Stop

On an `exit` event, or when the user is done: `node <skill-dir>/scripts/live-server.mjs stop`. This removes the toolbar's script tag from the app's page shell. Then search the source for leftover `ttui-variants-start` / `ttui-carbonize-start` markers and clean them up. Never commit or deploy while the toolbar's script tag is in the page shell.
