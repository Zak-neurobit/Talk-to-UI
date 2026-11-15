// Talk-to-UI: ask the local launcher whether this page's dev server belongs to
// a project on this computer. If it does, load the toolbar from this
// extension's own package and point it at that project's helper.
(async () => {
  const LAUNCHER = 'http://localhost:8399';
  if (window.top !== window) return;                                // not inside iframes
  if (document.querySelector('script[src*="/live.js"]')) return;   // the project already loads it itself
  const port = location.port || '80';
  let config;
  try {
    const info = await (await fetch(LAUNCHER + '/attach?port=' + encodeURIComponent(port))).json();
    if (!info || !info.ok) return;
    config = await (await fetch('http://localhost:' + info.serverPort + '/config.json')).json();
  } catch {
    return; // launcher or helper not running: leave the page alone
  }
  if (!config || !config.token || !config.port) return;

  // The toolbar runs in the page itself; boot.js reads this and sets its globals.
  config.assets = chrome.runtime.getURL('');
  document.documentElement.dataset.ttuiConfig = JSON.stringify(config);
  for (const file of ['boot.js', 'live-browser-session.js', 'live-browser.js']) {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL(file);
    s.async = false; // run in this order
    document.documentElement.appendChild(s);
  }
})();
