# Chrome Web Store listing: Talk-to-UI

Everything to paste into the developer dashboard. Images are in this folder; the package is `talk-to-ui-extension-<version>.zip` (made by `store/package.sh`).

## Store listing

**Name:** Talk-to-UI

**Summary** (132 characters max):
Edit your local dev site by talking to it: pick anything on a localhost page, say what to change, flip through versions.

**Category:** Developer Tools  **Language:** English

**Description:**
Talk-to-UI puts a small toolbar on your local dev site. Pick something on the page, or circle it, then type or dictate what you want. Your own AI (Claude Code or Codex) writes the change straight into your code, and you flip through the versions live, the original included. Keep the one you like.

- Works on any localhost project on your computer: Next.js, Vite, Astro, SvelteKit, Nuxt, plain HTML
- 1 to 5 versions per request, or "Just do it" for one direct change (wire a button to a page, make a phone number call on tap)
- Pick the model and reasoning level your account can run
- Work on several parts of a page at once: each keeps its versions, marked with a tag, even when you change pages
- Nothing is added to your code to run it, and nothing leaves your computer except through the AI tool you already use

Free and open source (Apache 2.0). Requires the Talk-to-UI helper on your computer (one install line, Mac): https://github.com/Zak-neurobit/Talk-to-UI

**Homepage URL:** https://github.com/Zak-neurobit/Talk-to-UI
**Support URL:** https://github.com/Zak-neurobit/Talk-to-UI/issues

**Images:**
- Store icon: `../skills/talk-to-ui/extension/icon128.png`
- Screenshots (1280×800): `screenshot-1-pick-and-talk.png`, `screenshot-2-versions.png`, `screenshot-3-models.png`
- Small promo tile (440×280): `promo-tile-440x280.png`

## Privacy practices tab

**Single purpose:** Load the Talk-to-UI editing toolbar on localhost development pages whose project is on the user's own computer.

**Host permission justification** (content script on `http://localhost/*` and `http://127.0.0.1/*`): The toolbar only makes sense on a developer's own local site. The extension runs on localhost pages only, asks the local Talk-to-UI helper whether the page belongs to a project on this computer, and if so loads the toolbar from that helper. It never runs on other websites.

**Remote code:** No. All of the extension's code is in its package. It reads only settings (a session token, a port number and a model list) from the Talk-to-UI helper on the user's own computer.

**Data usage:** Collects none of the listed data types. Check all three certifications (not sold, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** https://github.com/Zak-neurobit/Talk-to-UI/blob/main/PRIVACY.md
