// Talk-to-UI: ask the local launcher whether this page's dev server belongs to
// a project on this computer. If it does, load that project's toolbar.
(async () => {
  const LAUNCHER = 'http://localhost:8399';
  if (window.top !== window) return;                                // not inside iframes
  if (document.querySelector('script[src*="/live.js"]')) return;   // the project already loads it itself
  const port = location.port || '80';
  let info;
  try {
    const res = await fetch(LAUNCHER + '/attach?port=' + encodeURIComponent(port));
    info = await res.json();
  } catch {
    return; // launcher not running: leave the page alone
  }
  if (!info || !info.ok) return;
  const s = document.createElement('script');
  s.src = 'http://' + location.hostname + ':' + info.serverPort + '/live.js';
  document.documentElement.appendChild(s);
})();
