# Privacy

Talk-to-UI (the browser extension and the local tools it talks to) collects no personal data and sends nothing to its author or to any analytics service.

**What the extension does.** It runs only on `http://localhost` and `http://127.0.0.1` pages. On those pages it asks the Talk-to-UI helper running on your own computer (`localhost:8399`) whether the page belongs to a project on that computer, and if so loads the toolbar from that helper. It reads nothing from other websites and has no other permissions.

**What stays on your computer.** The page you pick from, what you type or dictate, screenshots of the part you picked, and the versions written into your code are handled by the helper on your machine and stored in your project's `.talk-to-ui/` folder.

**Your AI provider.** To write the changes, the helper runs the AI tool you already use (Claude Code or Codex) under your own account. What that tool sends to its provider is covered by that provider's terms, the same as when you use it in a terminal.

**Contact.** Open an issue at https://github.com/Zak-neurobit/Talk-to-UI/issues.
