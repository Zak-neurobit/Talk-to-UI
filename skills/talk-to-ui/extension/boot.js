// Runs in the page before the toolbar: turns the settings content.js left on
// <html data-ttui-config> into the globals the toolbar reads.
(() => {
  const root = document.documentElement;
  try {
    const cfg = JSON.parse(root.dataset.ttuiConfig || '{}');
    window.__TTUI_TOKEN__ = cfg.token;
    window.__TTUI_PORT__ = cfg.port;
    window.__TTUI_MODELS__ = cfg.models;
    window.__TTUI_ASSETS__ = cfg.assets;
  } finally {
    delete root.dataset.ttuiConfig;
  }
})();
