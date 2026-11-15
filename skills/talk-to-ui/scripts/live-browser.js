/**
 * Talk-to-UI Live Variant Mode — Browser Script
 *
 * Injected into the user's page via <script src="http://localhost:PORT/live.js">.
 * The server prepends window.__TTUI_TOKEN__ and window.__TTUI_PORT__
 * before this code.
 *
 * UI: a single floating bar that morphs between three states —
 * configure (pick action + go), generating (progressive dots), and cycling
 * (prev/next + accept/discard). Feels like Spotlight, not a modal.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // Guard against double-init. Bun's HTML loader may process the <script> tag
  // and create a bundled copy alongside the external load, or HMR may re-execute.
  // Check BEFORE reading token/port to catch all cases.
  if (window.__TTUI_LIVE_INIT__) return;
  window.__TTUI_LIVE_INIT__ = true;

  const TOKEN = window.__TTUI_TOKEN__;
  const PORT = window.__TTUI_PORT__;
  if (!TOKEN || !PORT) {
    window.__TTUI_LIVE_INIT__ = false; // reset so the real load can init
    return;
  }

  // ---------------------------------------------------------------------------
  // Design tokens
  // ---------------------------------------------------------------------------

  // Brand magenta is pinned to the site token (--color-accent in main.css)
  // so Accept / knobs / cycle-dots match the site's accent, not a washed
  // theme-adjusted one.
  const C = {
    brand:     '#c6ff3d',
    brandHov:  '#b3ec2a',
    brandSoft: 'rgb(198 255 61 / 0.16)',
    ink:       '#0d0f0c',
    ash:       '#8a9480',
    paper:     'rgb(13 15 12 / 0.96)',
    paperSolid:'#0d0f0c',
    mist:      'rgb(43 51 38 / 0.6)',
    white:     '#f4fbe9',
  };
  const FONT = '"Space Grotesk", system-ui, -apple-system, sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  // z-index: detect overlays use 99999, so our UI must be above them
  const Z = { highlight: 100001, bar: 100005, picker: 100007, toast: 100010 };
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'; // ease-out-quint
  const PREFIX = 'ttui-live';
  const sessionState = window.__TTUI_LIVE_SESSION__?.createLiveBrowserSessionState({
    prefix: PREFIX,
    storage: localStorage,
    idFactory: () => crypto.randomUUID().replace(/-/g, '').slice(0, 8),
  });
  if (!sessionState) {
    console.error('[ttui] live-browser-session.js was not loaded. Live mode cannot start safely.');
    window.__TTUI_LIVE_INIT__ = false;
    return;
  }
  const HIGHLIGHT_TRANSITION =
    'top 140ms ' + EASE +
    ', left 140ms ' + EASE +
    ', width 140ms ' + EASE +
    ', height 140ms ' + EASE +
    ', opacity 150ms ease';
  const TOOLTIP_TRANSITION =
    'top 140ms ' + EASE + ', left 140ms ' + EASE + ', opacity 150ms ease';

  const SKIP_TAGS = new Set([
    'html', 'head', 'body', 'script', 'style', 'link', 'meta', 'noscript', 'br', 'wbr',
  ]);

  // SVG icons stack above each chip label. All strokes use currentColor so the
  // icon recolors to C.brand when its chip is selected. 20x20 render, 24-viewBox,
  // 1.5 stroke — visually consistent with the Foundation grid on the homepage.
  const ICON_ATTRS = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"';
  const ICONS = {
    ttui: `<svg ${ICON_ATTRS}><path d="M4 20l4-1L18 9l-3-3L5 16z"/><path d="M14 7l3 3"/></svg>`,
    bolder:     `<svg ${ICON_ATTRS}><rect x="6" y="12" width="4" height="7" rx="0.5"/><rect x="14" y="5" width="4" height="14" rx="0.5"/></svg>`,
    quieter:    `<svg ${ICON_ATTRS}><rect x="6" y="5" width="4" height="14" rx="0.5"/><rect x="14" y="12" width="4" height="7" rx="0.5"/></svg>`,
    distill:    `<svg ${ICON_ATTRS}><path d="M4 5h16l-6 8v7l-4-2v-5z"/></svg>`,
    polish:     `<svg ${ICON_ATTRS}><path d="M15 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/><path d="M7 13l0.6 1.8 1.8 0.6-1.8 0.6-0.6 1.8-0.6-1.8-1.8-0.6 1.8-0.6z"/></svg>`,
    typeset:    `<svg ${ICON_ATTRS}><path d="M5 6h14" stroke-width="2.6"/><path d="M5 12h9" stroke-width="1.9"/><path d="M5 18h5" stroke-width="1.3"/></svg>`,
    colorize:   `<svg ${ICON_ATTRS}><circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/></svg>`,
    layout:     `<svg ${ICON_ATTRS}><rect x="3" y="4" width="8" height="16" rx="0.5"/><rect x="13" y="4" width="8" height="7" rx="0.5"/><rect x="13" y="13" width="8" height="7" rx="0.5"/></svg>`,
    adapt:      `<svg ${ICON_ATTRS}><rect x="2.5" y="5" width="12" height="11" rx="1"/><line x1="2.5" y1="19" x2="14.5" y2="19"/><rect x="16.5" y="8" width="5" height="11" rx="1"/></svg>`,
    animate:    `<svg ${ICON_ATTRS}><path d="M3 18c4-4 6-10 10-10"/><path d="M13 8c3 0 5 5 8 10"/><circle cx="13" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>`,
    delight:    `<svg ${ICON_ATTRS}><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>`,
    overdrive:  `<svg ${ICON_ATTRS}><path d="M13 3L5 13h5l-1 8 9-12h-6z"/></svg>`,
  };

  const ACTIONS = [
    { value: 'ttui', label: 'Freeform' },
    { value: 'bolder',     label: 'Bolder' },
    { value: 'quieter',    label: 'Quieter' },
    { value: 'distill',    label: 'Distill' },
    { value: 'polish',     label: 'Polish' },
    { value: 'typeset',    label: 'Typeset' },
    { value: 'colorize',   label: 'Colorize' },
    { value: 'layout',     label: 'Layout' },
    { value: 'adapt',      label: 'Adapt' },
    { value: 'animate',    label: 'Animate' },
    { value: 'delight',    label: 'Delight' },
    { value: 'overdrive',  label: 'Overdrive' },
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let state = 'IDLE';
  let hoveredElement = null;
  let selectedElement = null;
  let currentSessionId = null;
  let expectedVariants = 0;
  let arrivedVariants = 0;
  let visibleVariant = 0;
  let variantObserver = null;
  let hasProjectContext = false;
  let selectedAction = 'ttui';
  let selectedCount = 3;
  // "Just do it": one direct change (any file, no versions to flip through).
  let directMode = false;
  let directSessionId = null; // the direct request in flight, if any
  const browserOwner = sessionState.owner;
  let checkpointTimer = null;

  // Scroll lock — holds window.scrollY at a fixed value while the session is
  // active, so HMR DOM patches and variant swaps can't drift the page. See
  // startScrollLock / stopScrollLock below.
  let scrollLockObserver = null;
  let scrollLockTargetY = null;
  let scrollLockRaf = null;
  let scrollLockAbort = null;

  // Dedicated key for scroll position — SEPARATE from LS_KEY so that
  // saveSession's state updates don't clobber a carefully-captured scrollY.
  // (Previously: saveSession wrote scrollY alongside state, so every call
  // during resume overwrote the pre-reload value with whatever the browser
  // had landed on, typically 0.)
  function writeScrollY(y) { sessionState.writeScrollY(y); }
  function readScrollY() { return sessionState.readScrollY(); }
  function clearScrollY() { sessionState.clearScrollY(); }

  // Pre-empt the browser: apply manual scroll restoration and jump to the
  // saved scrollY at script-parse time. Retries on fonts.ready and load
  // are essential: scrollTo(y) clamps to the current document.scrollHeight,
  // which is often hundreds of pixels short of the final value until
  // async-loaded fonts swap in and reflow.
  try {
    history.scrollRestoration = 'manual';
    const savedY = readScrollY();
    if (savedY != null) {
      const apply = () => {
        if (Math.abs(window.scrollY - savedY) > 0.5) {
          console.log('[ttui.scroll] early restore', { from: window.scrollY, to: savedY });
          window.scrollTo(0, savedY);
        }
      };
      apply();
      if (document.fonts?.ready) document.fonts.ready.then(apply).catch(() => {});
      window.addEventListener('load', apply, { once: true });
    }
  } catch {}

  // UI refs
  let highlightEl = null;
  let tooltipEl = null;
  let barEl = null;
  let pickerEl = null;
  let toastEl = null;
  let scrollRaf = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function own(el) {
    return el && (el.id?.startsWith(PREFIX) || el.closest?.('[id^="' + PREFIX + '"]'));
  }

  function pickable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return false;
    if (own(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 20 && r.height >= 20;
  }

  function desc(el) {
    if (!el) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    return s;
  }

  function id8() { return crypto.randomUUID().replace(/-/g, '').slice(0, 8); }

  // Modal-aware chrome: keep our floating UI clickable inside Radix /
  // Headless UI / vaul portals.
  //
  // Two host-page behaviors break us when the picked element lives inside a
  // modal dialog:
  //
  //   1. Modal scroll-lock disables outside pointer events. Radix's
  //      `DismissableLayer` sets `document.body.style.pointerEvents = 'none'`
  //      while a modal is open and only restores `auto` on the layer. Our
  //      chrome inherits `none` from <body> and becomes unclickable.
  //   2. The dialog's outside-interaction handler (Radix's
  //      `usePointerDownOutside`) listens at document level and dismisses
  //      the dialog whenever a `pointerdown` lands outside the layer node.
  //      Our chrome is a sibling of <body>, so Radix classifies our clicks
  //      as outside and tears the dialog down mid-task.
  //
  // We can't reliably re-parent our chrome into the dialog subtree (z-index
  // stacking, scroll containers, theming all become host-page concerns), so
  // we defang both behaviors at our root:
  //
  //   - `pointer-events: auto !important` overrides the inherited `none`.
  //   - Stop `pointerdown` / `mousedown` propagation so the document-level
  //     dismiss listener never fires for our clicks.
  //   - Stop `focusin` propagation so any focus shifts inside our chrome
  //     don't read as "focus moved outside the dialog" to focus traps.
  //
  // Click events still bubble normally — only the early pointer/focus
  // signals that drive outside-interaction detection are silenced.
  function defangOutsideHandlers(rootEl, { setPointerEvents = true } = {}) {
    if (!rootEl) return;
    if (setPointerEvents) {
      rootEl.style.setProperty('pointer-events', 'auto', 'important');
    }
    const stop = (e) => e.stopPropagation();
    rootEl.addEventListener('pointerdown', stop);
    rootEl.addEventListener('mousedown', stop);
    rootEl.addEventListener('focusin', stop);
  }

  // ---------------------------------------------------------------------------
  // Highlight overlay
  // ---------------------------------------------------------------------------

  function initHighlight() {
    highlightEl = document.createElement('div');
    highlightEl.id = PREFIX + '-highlight';
    Object.assign(highlightEl.style, {
      position: 'fixed', top: '0', left: '0', width: '0', height: '0',
      border: '2px solid ' + C.brand, borderRadius: '3px',
      pointerEvents: 'none', zIndex: Z.highlight, boxSizing: 'border-box',
      transition: HIGHLIGHT_TRANSITION,
      display: 'none', opacity: '0',
    });
    document.body.appendChild(highlightEl);

    tooltipEl = document.createElement('div');
    tooltipEl.id = PREFIX + '-tooltip';
    Object.assign(tooltipEl.style, {
      position: 'fixed',
      background: C.ink, color: C.white,
      fontFamily: MONO, fontSize: '10px', fontWeight: '500',
      padding: '2px 6px', borderRadius: '3px',
      zIndex: Z.highlight + 1, pointerEvents: 'none',
      whiteSpace: 'nowrap', display: 'none',
      letterSpacing: '0.02em',
      transition: TOOLTIP_TRANSITION,
    });
    document.body.appendChild(tooltipEl);
  }

  function showHighlight(el) {
    if (!el || !highlightEl) return;
    const r = el.getBoundingClientRect();
    const top = (r.top - 2) + 'px', left = (r.left - 2) + 'px';
    const width = (r.width + 4) + 'px', height = (r.height + 4) + 'px';
    const tipTop = r.top - 20;
    const tipY = (tipTop < 4 ? r.bottom + 4 : tipTop) + 'px';
    const tipX = Math.max(4, r.left) + 'px';
    tooltipEl.textContent = desc(el);

    const hiWasHidden = highlightEl.style.display === 'none' || highlightEl.style.opacity === '0';
    if (hiWasHidden) {
      // Snap to first target without animating from (0,0), then fade in.
      highlightEl.style.transition = 'none';
      Object.assign(highlightEl.style, { top, left, width, height, display: 'block' });
      tooltipEl.style.transition = 'none';
      Object.assign(tooltipEl.style, { top: tipY, left: tipX, display: 'block' });
      void highlightEl.offsetWidth;
      highlightEl.style.transition = HIGHLIGHT_TRANSITION;
      highlightEl.style.opacity = '1';
      tooltipEl.style.transition = TOOLTIP_TRANSITION;
      tooltipEl.style.opacity = '1';
    } else {
      Object.assign(highlightEl.style, { top, left, width, height, display: 'block', opacity: '1' });
      Object.assign(tooltipEl.style, { top: tipY, left: tipX, display: 'block', opacity: '1' });
    }
  }

  function hideHighlight() {
    if (highlightEl) { highlightEl.style.opacity = '0'; highlightEl.style.display = 'none'; }
    if (tooltipEl) { tooltipEl.style.opacity = '0'; tooltipEl.style.display = 'none'; }
  }

  // ---------------------------------------------------------------------------
  // Annotation overlay (comment pins + magenta strokes)
  //
  // Active while state === 'CONFIGURING'. The overlay is a fixed-positioned
  // sibling of <body> mirroring selectedElement's bounding rect. Click (no
  // drag) drops a comment pin; drag paints a magenta SVG stroke. All coords
  // are stored in element-local CSS px so they survive scroll / resize and
  // correlate directly with the captured PNG.
  // ---------------------------------------------------------------------------

  const DRAG_THRESHOLD = 5;       // px — below this, treat pointerup as a click
  const PIN_DBL_CLICK_MS = 300;   // two clicks on the same pin within this delete it
  let annotOverlayEl = null;
  let annotSvgEl = null;
  let annotPinsEl = null;
  let annotClearChipEl = null;
  let annotState = { comments: [], strokes: [] };
  let annotActive = false;
  // `annotPointer` is either:
  //   { kind: 'new',   x0, y0, moved, strokeEl, strokePoints }   creating a stroke/pin
  //   { kind: 'pin',   idx, startPointer, startPin, moved }     dragging an existing pin
  let annotPointer = null;
  let annotEditing = null;        // { idx, input, wrapEl }
  let annotLastPinClick = { idx: -1, time: 0 }; // for click-click-to-delete

  function initAnnotOverlay() {
    annotOverlayEl = document.createElement('div');
    annotOverlayEl.id = PREFIX + '-annot';
    Object.assign(annotOverlayEl.style, {
      position: 'fixed', top: '0', left: '0', width: '0', height: '0',
      pointerEvents: 'auto', zIndex: Z.highlight + 2,
      display: 'none', overflow: 'visible',
      cursor: 'crosshair', touchAction: 'none',
    });

    annotSvgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    annotSvgEl.id = PREFIX + '-annot-svg';
    Object.assign(annotSvgEl.style, {
      position: 'absolute', top: '0', left: '0',
      width: '100%', height: '100%',
      // The SVG itself doesn't absorb clicks; individual hit-paths opt-in via
      // pointer-events=stroke so gaps still fall through to the overlay.
      pointerEvents: 'none', overflow: 'visible',
    });
    annotOverlayEl.appendChild(annotSvgEl);

    annotPinsEl = document.createElement('div');
    annotPinsEl.id = PREFIX + '-annot-pins';
    Object.assign(annotPinsEl.style, {
      position: 'absolute', inset: '0',
      pointerEvents: 'none',
    });
    annotOverlayEl.appendChild(annotPinsEl);

    annotClearChipEl = document.createElement('div');
    annotClearChipEl.id = PREFIX + '-annot-clear';
    annotClearChipEl.dataset.annotClear = 'true';
    annotClearChipEl.textContent = 'Clear';
    Object.assign(annotClearChipEl.style, {
      position: 'absolute', top: '8px', right: '8px',
      background: C.ink, color: C.white,
      fontFamily: FONT, fontSize: '10px', fontWeight: '500',
      letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '5px 12px', borderRadius: '999px',
      cursor: 'pointer', pointerEvents: 'auto',
      display: 'none', userSelect: 'none',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    });
    annotOverlayEl.appendChild(annotClearChipEl);

    annotOverlayEl.addEventListener('pointerdown', onAnnotDown);
    annotOverlayEl.addEventListener('pointermove', onAnnotMove);
    annotOverlayEl.addEventListener('pointerup', onAnnotUp);
    annotOverlayEl.addEventListener('pointercancel', onAnnotUp);
    document.body.appendChild(annotOverlayEl);
    // Modal-host friendliness: pointer-events is already 'auto' on this
    // overlay; we only need to silence the host's outside-interaction
    // listeners. Don't override pointer-events here (the overlay toggles
    // visibility via display:none, which is fine).
    defangOutsideHandlers(annotOverlayEl, { setPointerEvents: false });
  }

  function updateClearChip() {
    if (!annotClearChipEl) return;
    const hasAny = annotState.comments.length > 0 || annotState.strokes.length > 0;
    annotClearChipEl.style.display = hasAny ? 'block' : 'none';
  }

  function showAnnotOverlay(el) {
    if (!annotOverlayEl || !el) return;
    annotActive = true;
    positionAnnotOverlay(el);
    annotOverlayEl.style.display = 'block';
  }

  function hideAnnotOverlay() {
    annotActive = false;
    if (annotOverlayEl) annotOverlayEl.style.display = 'none';
    // Drop any in-progress edit without touching annotState — clearAnnotations
    // (if the caller is exiting configure mode) handles state reset.
    annotEditing = null;
  }

  function positionAnnotOverlay(el) {
    if (!annotOverlayEl || !el) return;
    const r = el.getBoundingClientRect();
    Object.assign(annotOverlayEl.style, {
      top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px',
    });
    annotSvgEl.setAttribute('viewBox', '0 0 ' + r.width + ' ' + r.height);
  }

  function clearAnnotations() {
    annotState.comments = [];
    annotState.strokes = [];
    if (annotSvgEl) while (annotSvgEl.firstChild) annotSvgEl.removeChild(annotSvgEl.firstChild);
    if (annotPinsEl) annotPinsEl.innerHTML = '';
    annotPointer = null;
    annotEditing = null;
    annotLastPinClick = { idx: -1, time: 0 };
    updateClearChip();
  }

  // Rebuild the SVG layer. Each stroke gets a wider invisible hit path
  // beneath the visible magenta path so clicks register on thin lines.
  function redrawStrokes() {
    while (annotSvgEl.firstChild) annotSvgEl.removeChild(annotSvgEl.firstChild);
    annotState.strokes.forEach((s, idx) => {
      const d = pointsToPath(s.points);
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '16');
      hit.setAttribute('stroke-linecap', 'round');
      hit.setAttribute('stroke-linejoin', 'round');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('pointer-events', 'stroke');
      hit.style.cursor = 'pointer';
      hit.dataset.annotStroke = String(idx);
      annotSvgEl.appendChild(hit);
      const visible = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      visible.setAttribute('d', d);
      visible.setAttribute('stroke', C.brand);
      visible.setAttribute('stroke-width', '3');
      visible.setAttribute('stroke-linecap', 'round');
      visible.setAttribute('stroke-linejoin', 'round');
      visible.setAttribute('fill', 'none');
      visible.setAttribute('pointer-events', 'none');
      annotSvgEl.appendChild(visible);
    });
    updateClearChip();
  }

  function localCoords(e) {
    const rect = annotOverlayEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onAnnotDown(e) {
    if (!annotActive) return;

    // 1) Clear chip → wipe all annotations
    if (e.target.closest?.('[data-annot-clear]')) {
      if (annotEditing) annotEditing = null;
      clearAnnotations();
      renderAllPins();
      redrawStrokes();
      e.stopPropagation(); e.preventDefault();
      return;
    }

    // 2) Stroke hit path → delete that stroke
    const strokeHit = e.target.closest?.('[data-annot-stroke]');
    if (strokeHit) {
      const idx = parseInt(strokeHit.dataset.annotStroke, 10);
      if (Number.isInteger(idx)) {
        annotState.strokes.splice(idx, 1);
        redrawStrokes();
      }
      e.stopPropagation(); e.preventDefault();
      return;
    }

    // 3) Pin → drag, edit, or delete-on-double-click
    const pinWrap = e.target.closest?.('[data-annot-pin]');
    if (pinWrap) {
      const idx = parseInt(pinWrap.dataset.annotPin, 10);
      if (!Number.isInteger(idx)) return;
      // Double-click (two pointerdowns on the same pin within window) → delete.
      const now = Date.now();
      if (annotLastPinClick.idx === idx && now - annotLastPinClick.time < PIN_DBL_CLICK_MS) {
        if (annotEditing && annotEditing.idx === idx) annotEditing = null;
        annotState.comments.splice(idx, 1);
        annotLastPinClick = { idx: -1, time: 0 };
        renderAllPins();
        e.stopPropagation(); e.preventDefault();
        return;
      }
      annotLastPinClick = { idx, time: now };
      // If editing a different pin, commit that edit before starting here.
      if (annotEditing && annotEditing.idx !== idx) finalizeEditingPin();
      // If already editing THIS pin and the user clicked the dot, let the
      // input keep focus (don't start a drag — the click wasn't meant as one).
      if (annotEditing && annotEditing.idx === idx) return;
      const p = localCoords(e);
      const pin = annotState.comments[idx];
      annotPointer = {
        kind: 'pin', idx,
        startPointer: p,
        startPin: { x: pin.x, y: pin.y },
        moved: false,
      };
      try { annotOverlayEl.setPointerCapture(e.pointerId); } catch {}
      e.stopPropagation(); e.preventDefault();
      return;
    }

    // 4) Empty area → commit any open edit, then start new annotation
    if (annotEditing) {
      finalizeEditingPin();
      e.stopPropagation(); e.preventDefault();
      return;
    }
    const p = localCoords(e);
    annotPointer = { kind: 'new', x0: p.x, y0: p.y, moved: false, strokeEl: null, strokePoints: null };
    try { annotOverlayEl.setPointerCapture(e.pointerId); } catch {}
    e.stopPropagation(); e.preventDefault();
  }

  function onAnnotMove(e) {
    if (!annotActive || !annotPointer) return;
    const p = localCoords(e);

    if (annotPointer.kind === 'pin') {
      const dx = p.x - annotPointer.startPointer.x;
      const dy = p.y - annotPointer.startPointer.y;
      if (!annotPointer.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        annotPointer.moved = true;
      }
      const pin = annotState.comments[annotPointer.idx];
      if (!pin) { annotPointer = null; return; }
      pin.x = annotPointer.startPin.x + dx;
      pin.y = annotPointer.startPin.y + dy;
      renderAllPins();
      e.stopPropagation();
      return;
    }

    // kind === 'new'
    const dx = p.x - annotPointer.x0, dy = p.y - annotPointer.y0;
    if (!annotPointer.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      annotPointer.moved = true;
      const strokeEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      strokeEl.setAttribute('stroke', C.brand);
      strokeEl.setAttribute('stroke-width', '3');
      strokeEl.setAttribute('stroke-linecap', 'round');
      strokeEl.setAttribute('stroke-linejoin', 'round');
      strokeEl.setAttribute('fill', 'none');
      strokeEl.setAttribute('pointer-events', 'none');
      annotSvgEl.appendChild(strokeEl);
      annotPointer.strokeEl = strokeEl;
      annotPointer.strokePoints = [[annotPointer.x0, annotPointer.y0]];
    }
    annotPointer.strokePoints.push([p.x, p.y]);
    annotPointer.strokeEl.setAttribute('d', pointsToPath(annotPointer.strokePoints));
    e.stopPropagation();
  }

  function onAnnotUp(e) {
    if (!annotActive || !annotPointer) return;

    if (annotPointer.kind === 'pin') {
      const wasDrag = annotPointer.moved;
      const idx = annotPointer.idx;
      try { annotOverlayEl.releasePointerCapture(e.pointerId); } catch {}
      annotPointer = null;
      if (wasDrag) {
        // A drag is an intentional reposition; a follow-up click shouldn't be
        // interpreted as a double-click-to-delete.
        annotLastPinClick = { idx: -1, time: 0 };
      } else {
        beginEditPin(idx);
      }
      e.stopPropagation();
      return;
    }

    // kind === 'new'
    const wasDrag = annotPointer.moved;
    if (wasDrag) {
      annotState.strokes.push({ points: annotPointer.strokePoints });
      // Swap the temporary preview SVG path for the full render with hit paths.
      redrawStrokes();
    } else {
      const idx = annotState.comments.length;
      annotState.comments.push({ x: annotPointer.x0, y: annotPointer.y0, text: '' });
      renderAllPins();
      beginEditPin(idx);
    }
    try { annotOverlayEl.releasePointerCapture(e.pointerId); } catch {}
    annotPointer = null;
    e.stopPropagation();
  }

  function pointsToPath(points) {
    if (!points || points.length === 0) return '';
    let d = 'M' + points[0][0].toFixed(1) + ' ' + points[0][1].toFixed(1);
    for (let i = 1; i < points.length; i++) {
      d += ' L' + points[i][0].toFixed(1) + ' ' + points[i][1].toFixed(1);
    }
    return d;
  }

  function renderAllPins() {
    annotPinsEl.innerHTML = '';
    annotState.comments.forEach((c, idx) => {
      annotPinsEl.appendChild(buildPinElement(c, idx));
    });
    updateClearChip();
  }

  function buildPinElement(comment, idx) {
    const interactive = idx >= 0;
    const wrap = document.createElement('div');
    if (interactive) wrap.dataset.annotPin = String(idx);
    Object.assign(wrap.style, {
      position: 'absolute',
      left: (comment.x - 7) + 'px', top: (comment.y - 7) + 'px',
      pointerEvents: interactive ? 'auto' : 'none',
      display: 'flex', alignItems: 'flex-start', gap: '6px',
      cursor: interactive ? 'grab' : 'default',
      touchAction: 'none',
    });
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      width: '14px', height: '14px', borderRadius: '50%',
      background: C.brand, border: '2px solid ' + C.white,
      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      flexShrink: '0',
    });
    wrap.appendChild(dot);

    if (comment.text) {
      const bubble = document.createElement('div');
      bubble.textContent = comment.text;
      Object.assign(bubble.style, {
        background: C.ink, color: C.white,
        fontFamily: FONT, fontSize: '12px', lineHeight: '1.4',
        padding: '4px 8px', borderRadius: '3px',
        marginTop: '-2px', maxWidth: '220px',
        pointerEvents: 'none', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      });
      wrap.appendChild(bubble);
    }
    return wrap;
  }

  function beginEditPin(idx) {
    const wrapEl = annotPinsEl.querySelector('[data-annot-pin="' + idx + '"]');
    if (!wrapEl) return;
    // Strip any existing bubble (but keep the dot)
    wrapEl.querySelectorAll('div:not(:first-child)').forEach(n => n.remove());
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Note…';
    Object.assign(input.style, {
      background: C.ink, color: C.white,
      fontFamily: FONT, fontSize: '12px', lineHeight: '1.4',
      padding: '4px 8px', borderRadius: '3px',
      border: '1px solid ' + C.brand,
      outline: 'none', marginTop: '-2px',
      width: '220px', pointerEvents: 'auto',
    });
    const originalText = annotState.comments[idx].text || '';
    input.value = originalText;
    wrapEl.appendChild(input);
    annotEditing = { idx, input, wrapEl, originalText };
    input.addEventListener('keydown', onAnnotInputKey, true);
    input.addEventListener('blur', () => {
      // Fires on both focus-loss and programmatic blur; commit unless we
      // already handled it.
      if (annotEditing && annotEditing.input === input) finalizeEditingPin();
    });
    // Stop clicks/pointerdowns inside the input from bubbling to the overlay
    ['pointerdown', 'click'].forEach(ev => {
      input.addEventListener(ev, e => e.stopPropagation());
    });
    setTimeout(() => input.focus(), 0);
  }

  function onAnnotInputKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      finalizeEditingPin();
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      cancelEditingPin();
    } else {
      // Keep arrows / backspace from hitting global handlers
      e.stopPropagation();
    }
  }

  function finalizeEditingPin() {
    if (!annotEditing) return;
    const { idx, input } = annotEditing;
    const text = input.value.trim();
    annotEditing = null;
    if (text) annotState.comments[idx].text = text;
    else annotState.comments.splice(idx, 1);
    renderAllPins();
  }

  function cancelEditingPin() {
    if (!annotEditing) return;
    const { idx, originalText } = annotEditing;
    annotEditing = null;
    // If the pin had text before this edit, revert to it. If it was a
    // just-created empty pin, Escape removes it.
    if (originalText) {
      annotState.comments[idx].text = originalText;
    } else {
      annotState.comments.splice(idx, 1);
    }
    renderAllPins();
  }

  // Build a detached annotation subtree suitable for injection into the clone
  // modern-screenshot creates. Coordinates are element-local so this slots
  // straight into an element that's been made position:relative. Takes an
  // explicit snapshot so it works after annotState has been cleared.
  function buildAnnotationsForCapture(rect, snapshot) {
    const comments = snapshot ? snapshot.comments : annotState.comments;
    const strokes = snapshot ? snapshot.strokes : annotState.strokes;
    if (comments.length === 0 && strokes.length === 0) return null;
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'absolute', top: '0', left: '0',
      width: rect.width + 'px', height: rect.height + 'px',
      pointerEvents: 'none', overflow: 'visible',
    });
    if (strokes.length > 0) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);
      Object.assign(svg.style, {
        position: 'absolute', top: '0', left: '0',
        width: '100%', height: '100%', overflow: 'visible',
      });
      for (const s of strokes) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke', C.brand);
        path.setAttribute('stroke-width', '3');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('fill', 'none');
        path.setAttribute('d', pointsToPath(s.points));
        svg.appendChild(path);
      }
      wrap.appendChild(svg);
    }
    for (const c of comments) {
      // idx=-1 means non-interactive; pointerEvents stay off in the clone
      wrap.appendChild(buildPinElement(c, -1));
    }
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Element context extraction
  // ---------------------------------------------------------------------------

  function extractContext(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const props = {};
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.style) for (let i = 0; i < rule.style.length; i++) {
            const p = rule.style[i];
            if (p.startsWith('--') && !props[p]) {
              const v = cs.getPropertyValue(p).trim();
              if (v) props[p] = v;
            }
          }
        }
      } catch { /* cross-origin */ }
    }
    return {
      tagName: el.tagName.toLowerCase(), id: el.id || null,
      classes: [...el.classList],
      textContent: (el.textContent || '').slice(0, 500),
      outerHTML: el.outerHTML.slice(0, 10000),
      computedStyles: {
        'font-family': cs.fontFamily, 'font-size': cs.fontSize,
        'font-weight': cs.fontWeight, 'line-height': cs.lineHeight,
        'color': cs.color, 'background': cs.background,
        'background-color': cs.backgroundColor,
        'padding': cs.padding, 'margin': cs.margin,
        'display': cs.display, 'position': cs.position,
        'gap': cs.gap, 'border-radius': cs.borderRadius,
        'box-shadow': cs.boxShadow,
      },
      cssCustomProperties: props,
      parentContext: el.parentElement
        ? '<' + el.parentElement.tagName.toLowerCase()
          + (el.parentElement.id ? ' id="' + el.parentElement.id + '"' : '')
          + (el.parentElement.className ? ' class="' + el.parentElement.className + '"' : '')
          + '>'
        : null,
      boundingRect: { width: Math.round(r.width), height: Math.round(r.height) },
    };
  }

  // ---------------------------------------------------------------------------
  // The Bar — one floating element, three modes
  // ---------------------------------------------------------------------------

  // Contextual-bar palette. Cached at init so every build*Row reads a
  // consistent set of colors; detectPageTheme runs once rather than on every
  // phase transition.
  let BP = null;

  // Bar shadow variants. The default projects down + subtle around. When
  // the Tune popover opens below the bar, a downward shadow lands on the
  // dark popover and reads as a bright ghost line. We swap to UP-only while
  // tune is open below so the popover's top edge is clean.
  const BAR_SHADOW_DEFAULT = '0 4px 20px oklch(0% 0 0 / 0.08), 0 1px 3px oklch(0% 0 0 / 0.06)';
  const BAR_SHADOW_UP = '0 -4px 20px oklch(0% 0 0 / 0.08), 0 -1px 3px oklch(0% 0 0 / 0.06)';
  const BAR_SHADOW_DOWN = BAR_SHADOW_DEFAULT;

  function initBar() {
    BP = barPaletteForTheme(detectPageTheme());
    barEl = document.createElement('div');
    barEl.id = PREFIX + '-bar';
    Object.assign(barEl.style, {
      position: 'fixed', zIndex: Z.bar,
      display: 'none', opacity: '0',
      transform: 'translateY(6px)',
      transition: 'opacity 0.25s ' + EASE + ', transform 0.3s ' + EASE,
      background: BP.surface,
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid ' + BP.hairline,
      borderRadius: '10px',
      boxShadow: BAR_SHADOW_DEFAULT,
      transition: 'box-shadow 0.2s ease, opacity 0.25s ' + EASE + ', transform 0.3s ' + EASE,
      fontFamily: FONT, fontSize: '13px', color: BP.text,
      padding: '6px',
      maxWidth: '520px', minWidth: '320px',
    });
    document.body.appendChild(barEl);
    defangOutsideHandlers(barEl);
  }

  function positionBar() {
    if (!barEl || !selectedElement) return;
    const r = selectedElement.getBoundingClientRect();
    const barH = barEl.offsetHeight || 44;
    const barW = barEl.offsetWidth || 380;
    const GLOBAL_BAR_RESERVE = 64; // global bar height + bottom margin + breathing room
    const GAP = 8;

    // Prefer below the element; fall back to above; if neither fits (element
    // taller than viewport), pin to a stable viewport anchor so the bar
    // doesn't teleport between top and bottom as the user scrolls.
    let top;
    const belowTop = r.bottom + GAP;
    const aboveTop = r.top - barH - GAP;
    if (belowTop + barH + GAP <= window.innerHeight - GLOBAL_BAR_RESERVE) {
      top = belowTop;
    } else if (aboveTop >= GAP) {
      top = aboveTop;
    } else {
      top = window.innerHeight - barH - GLOBAL_BAR_RESERVE;
    }

    let left = r.left + (r.width - barW) / 2;
    if (left < GAP) left = GAP;
    if (left + barW > window.innerWidth - GAP) left = window.innerWidth - barW - GAP;
    Object.assign(barEl.style, { top: top + 'px', left: left + 'px' });
  }

  let barHideTimer = null; // a pending hide must not undo a show that came after it

  function showBar(mode) {
    clearTimeout(barHideTimer);
    barEl.innerHTML = '';
    if (mode === 'configure') barEl.appendChild(buildConfigureRow());
    else if (mode === 'generating') barEl.appendChild(buildGeneratingRow());
    else if (mode === 'cycling') barEl.appendChild(buildCyclingRow());
    barEl.style.display = 'block';
    positionBar();
    requestAnimationFrame(() => {
      barEl.style.opacity = '1';
      barEl.style.transform = 'translateY(0)';
    });
  }

  function hideBar() {
    if (!barEl) return;
    barEl.style.opacity = '0';
    barEl.style.transform = 'translateY(6px)';
    clearTimeout(barHideTimer);
    barHideTimer = setTimeout(() => { if (barEl) barEl.style.display = 'none'; }, 250);
    hideActionPicker();
    closeTunePopover();
  }

  function updateBarContent(mode) {
    if (!barEl || barEl.style.display === 'none') return;
    barEl.innerHTML = '';
    // Reset bar styling to the theme-aware palette
    barEl.style.background = BP.surface;
    barEl.style.border = '1px solid ' + BP.hairline;
    if (mode === 'configure') barEl.appendChild(buildConfigureRow());
    else if (mode === 'generating') barEl.appendChild(buildGeneratingRow());
    else if (mode === 'cycling') barEl.appendChild(buildCyclingRow());
    else if (mode === 'saving') barEl.appendChild(buildSavingRow());
    else if (mode === 'confirmed') {
      barEl.appendChild(buildConfirmedRow());
      barEl.style.background = 'oklch(95% 0.05 145)';
      barEl.style.border = '1px solid oklch(75% 0.12 145 / 0.4)';
    }
  }

  // --- Configure row ---

  function buildConfigureRow() {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '4px',
    });

    // Action pill
    const pill = el('button', {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '5px 10px', borderRadius: '6px',
      background: BP.mark, color: BP.markText,
      fontFamily: FONT, fontSize: '12px', fontWeight: '500',
      border: 'none', cursor: 'pointer',
      transition: 'background 0.12s ease, transform 0.1s ease',
      whiteSpace: 'nowrap', flexShrink: '0',
    });
    pill.textContent = actionLabel() + ' \u25BE';
    pill.addEventListener('mouseenter', () => pill.style.background = BP.accent);
    pill.addEventListener('mouseleave', () => pill.style.background = BP.mark);
    pill.addEventListener('mousedown', () => pill.style.transform = 'scale(0.97)');
    pill.addEventListener('mouseup', () => pill.style.transform = 'scale(1)');
    pill.addEventListener('click', (e) => { e.stopPropagation(); toggleActionPicker(); });
    row.appendChild(pill);

    // Freeform input. Focus state shows an accent-colored border only —
    // an earlier version tinted the background with `BP.accentSoft`, which
    // composited against the dark bar surface to a murky purple where the
    // browser's default placeholder gray was unreadable. Placeholder color
    // is set explicitly via a one-shot stylesheet keyed off this input's id
    // so it picks up the bar's `textDim` token in both themes.
    const input = document.createElement('input');
    input.id = PREFIX + '-input';
    input.type = 'text';
    input.placeholder = selectedAction === 'ttui' ? 'describe what you want...' : 'refine further (optional)...';
    Object.assign(input.style, {
      flex: '1', minWidth: '0',
      padding: '5px 8px', borderRadius: '6px',
      border: '1px solid transparent', background: 'transparent',
      fontFamily: FONT, fontSize: '12px', color: BP.text,
      outline: 'none',
      transition: 'border-color 0.15s ease',
    });
    if (!document.getElementById(PREFIX + '-input-style')) {
      const s = document.createElement('style');
      s.id = PREFIX + '-input-style';
      s.textContent =
        '#' + PREFIX + '-input::placeholder { color: ' + BP.textDim + '; opacity: 1; }';
      document.head.appendChild(s);
    }
    input.addEventListener('focus', () => {
      input.style.borderColor = BP.accent;
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = 'transparent';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); handleGo(); return; }
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); input.blur(); hideBar(); state = 'PICKING'; return; }
      // Let arrow keys pass through to the element picker when the input is empty
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !input.value) return;
      e.stopPropagation();
    });
    row.appendChild(input);


    // Go button
    const go = el('button', {
      padding: '5px 12px', borderRadius: '6px',
      border: 'none', background: BP.accent, color: BP.markText,
      fontFamily: FONT, fontSize: '12px', fontWeight: '600',
      cursor: 'pointer',
      transition: 'filter 0.12s ease, transform 0.1s ease',
      flexShrink: '0', whiteSpace: 'nowrap',
    });
    go.id = PREFIX + '-go';
    go.textContent = (directMode ? 'Do it' : 'Go') + ' \u2192';
    go.addEventListener('mouseenter', () => go.style.filter = 'brightness(1.1)');
    go.addEventListener('mouseleave', () => go.style.filter = 'none');
    go.addEventListener('mousedown', () => go.style.transform = 'scale(0.97)');
    go.addEventListener('mouseup', () => go.style.transform = 'scale(1)');
    go.addEventListener('click', (e) => { e.stopPropagation(); handleGo(); });
    row.appendChild(go);

    // Auto-focus input after a beat
    setTimeout(() => input.focus(), 60);
    return row;
  }

  // --- Generating row ---

  function buildGeneratingRow() {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '2px 4px',
    });

    // Action label
    const label = el('span', {
      fontWeight: '600', fontSize: '12px', color: BP.text,
      flexShrink: '0', whiteSpace: 'nowrap',
    });
    label.textContent = actionLabel();
    row.appendChild(label);

    // Dots (one per version; a direct change has no versions)
    if (!directSessionId) row.appendChild(buildDots(false));

    // Status
    const status = el('span', {
      fontSize: '11px', color: BP.textDim, whiteSpace: 'nowrap',
      marginLeft: 'auto',
    });
    // Variants currently arrive atomically in a single file edit, so a
    // per-variant counter would lie. Say what's true.
    status.textContent = directSessionId
      ? 'Doing it' + (MODELS ? ' with ' + choiceLabel() : '') + '...'
      : arrivedVariants < expectedVariants
      ? 'Writing ' + expectedVariants + (expectedVariants === 1 ? ' version' : ' versions') + (MODELS ? ' with ' + choiceLabel() : '') + '...'
      : 'Done';
    row.appendChild(status);

    return row;
  }

  // --- Cycling row ---

  const TUNE_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="flex-shrink:0"><line x1="4" y1="8" x2="20" y2="8"/><circle cx="14" cy="8" r="2.4" fill="currentColor" stroke="none"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="10" cy="16" r="2.4" fill="currentColor" stroke="none"/></svg>';

  function buildCyclingRow() {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '1px 2px',
    });

    // Prev
    const prev = navBtn('\u2190');
    prev.addEventListener('click', (e) => { e.stopPropagation(); cycleVariant(-1); });
    if (visibleVariant <= 0) prev.style.opacity = '0.3';
    row.appendChild(prev);

    // Dots (clickable)
    row.appendChild(buildDots(true));

    // Counter
    const counter = el('span', {
      fontFamily: MONO, fontSize: '11px', fontWeight: '500',
      color: BP.textDim, minWidth: '24px', textAlign: 'center',
    });
    counter.textContent = visibleVariant === 0 ? 'Original' : visibleVariant + '/' + arrivedVariants;
    row.appendChild(counter);

    // Next
    const next = navBtn('\u2192');
    next.addEventListener('click', (e) => { e.stopPropagation(); cycleVariant(1); });
    if (visibleVariant >= arrivedVariants) next.style.opacity = '0.3';
    row.appendChild(next);

    // Tune chip — only when the visible variant exposes params
    const visParams = parseVariantParams(getVisibleVariantEl());
    const hasParams = visParams.length > 0;
    if (hasParams) {
      const tune = el('button', {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '5px',
        border: '1px solid transparent',
        background: tuneOpen ? BP.accentSoft : 'transparent',
        color: tuneOpen ? BP.accent : BP.text,
        fontFamily: FONT, fontSize: '11px', fontWeight: '500',
        cursor: 'pointer',
        transition: 'color 0.12s ease, background 0.12s ease',
        whiteSpace: 'nowrap',
      });
      tune.innerHTML = TUNE_ICON_SVG;
      const tuneLabel = document.createElement('span');
      tuneLabel.textContent = 'Tune';
      tune.appendChild(tuneLabel);
      const tuneBadge = document.createElement('span');
      Object.assign(tuneBadge.style, {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: '16px', height: '16px', padding: '0 4px',
        borderRadius: '999px',
        background: tuneOpen ? C.brand : BP.hairline,
        color: tuneOpen ? C.ink : 'inherit',
        fontFamily: MONO, fontSize: '9.5px', fontWeight: '600',
        lineHeight: '1',
        boxSizing: 'border-box',
      });
      tuneBadge.textContent = String(visParams.length);
      tune.appendChild(tuneBadge);
      tune.title = 'Tune this variant (' + visParams.length + ' knob' + (visParams.length === 1 ? '' : 's') + ')';
      tune.addEventListener('mouseenter', () => {
        if (!tuneOpen) tune.style.background = BP.accentSoft;
      });
      tune.addEventListener('mouseleave', () => {
        if (!tuneOpen) tune.style.background = 'transparent';
      });
      tune.addEventListener('click', (e) => { e.stopPropagation(); toggleTunePopover(); });
      tune.dataset.iceqTune = '1';
      row.appendChild(tune);
    }

    // Spacer
    row.appendChild(el('div', { flex: '1' }));

    // Accept — primary action, uses the site's saturated brand magenta
    // with paper-white text, not the theme-muted BP.accent.
    const accept = el('button', {
      padding: '5px 14px', borderRadius: '5px',
      border: 'none', background: C.brand, color: C.ink,
      fontFamily: FONT, fontSize: '11px', fontWeight: '600',
      cursor: 'pointer', transition: 'filter 0.12s ease, transform 0.1s ease',
      whiteSpace: 'nowrap',
    });
    accept.textContent = visibleVariant === 0 ? '\u2713 Keep original' : '\u2713 Accept';
    accept.addEventListener('mouseenter', () => accept.style.filter = 'brightness(1.08)');
    accept.addEventListener('mouseleave', () => accept.style.filter = 'none');
    accept.addEventListener('mousedown', () => accept.style.transform = 'scale(0.97)');
    accept.addEventListener('mouseup', () => accept.style.transform = 'scale(1)');
    accept.addEventListener('click', (e) => { e.stopPropagation(); handleAccept(); });
    if (arrivedVariants === 0) { accept.style.opacity = '0.3'; accept.style.pointerEvents = 'none'; }
    row.appendChild(accept);

    // Discard
    const discard = el('button', {
      padding: '4px 6px', borderRadius: '5px',
      border: '1px solid ' + BP.hairline, background: 'transparent',
      fontFamily: FONT, fontSize: '11px', color: BP.textDim,
      cursor: 'pointer', transition: 'color 0.12s ease, border-color 0.12s ease',
    });
    discard.textContent = '\u2715';
    discard.title = 'Discard all variants';
    discard.addEventListener('mouseenter', () => { discard.style.color = BP.text; discard.style.borderColor = BP.text; });
    discard.addEventListener('mouseleave', () => { discard.style.color = BP.textDim; discard.style.borderColor = BP.hairline; });
    discard.addEventListener('click', (e) => { e.stopPropagation(); handleDiscard(); });
    row.appendChild(discard);

    return row;
  }

  // --- Shared UI builders ---

  // --- Saving row (waiting for agent to process accept/discard) ---

  function buildSavingRow() {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '2px 8px',
    });
    const spinner = el('div', {
      width: '14px', height: '14px', borderRadius: '50%',
      border: '2px solid ' + BP.hairline,
      borderTopColor: BP.accent,
      animation: 'ttui-spin 0.6s linear infinite',
      flexShrink: '0',
    });
    row.appendChild(spinner);
    const label = el('span', {
      fontSize: '12px', color: BP.textDim, fontWeight: '500',
    });
    label.textContent = 'Applying variant...';
    row.appendChild(label);

    // Inject the keyframes if not already present
    if (!document.getElementById(PREFIX + '-keyframes')) {
      const style = document.createElement('style');
      style.id = PREFIX + '-keyframes';
      style.textContent = '@keyframes ttui-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
    return row;
  }

  // --- Confirmed row (green success, auto-dismisses) ---

  function buildConfirmedRow() {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '2px 8px',
    });
    const check = el('span', {
      fontSize: '15px', lineHeight: '1', flexShrink: '0',
      color: 'oklch(45% 0.15 145)',
    });
    check.textContent = '\u2713';
    row.appendChild(check);
    const label = el('span', {
      fontSize: '12px', color: 'oklch(35% 0.1 145)', fontWeight: '600',
    });
    label.textContent = 'Variant applied';
    row.appendChild(label);
    return row;
  }

  // --- Shared UI builders ---

  function buildDots(clickable) {
    const container = el('div', {
      display: 'flex', alignItems: 'center', gap: '4px',
    });
    for (let i = clickable ? 0 : 1; i <= expectedVariants; i++) {
      const isOriginal = i === 0;
      const arrived = isOriginal || i <= arrivedVariants;
      const active = i === visibleVariant;
      // active: solid site-brand magenta dot. arrived+inactive: muted neutral.
      // pending (not yet arrived): faint outline ring. No borders on arrived
      // dots — the previous "accent ring + ash fill" combo read as noisy
      // magenta chips, especially when all variants had arrived and every
      // dot wore an accent ring.
      const dotBg = isOriginal ? 'transparent'
        : active ? C.brand
        : arrived ? BP.textDim
        : 'transparent';
      const dotBorder = isOriginal ? '1.5px solid ' + (active ? C.brand : BP.textDim)
        : arrived ? 'none' : '1.5px solid ' + BP.hairline;
      const dot = el('div', {
        width: active ? '8px' : '6px',
        height: active ? '8px' : '6px',
        borderRadius: '50%',
        background: dotBg,
        border: dotBorder,
        boxSizing: 'border-box',
        transition: 'all 0.2s ' + EASE,
        cursor: (clickable && arrived) ? 'pointer' : 'default',
        transform: arrived ? 'scale(1)' : 'scale(0.85)',
        opacity: arrived ? (active ? '1' : '0.6') : '0.4',
      });
      if (isOriginal) dot.title = 'Original';
      if (clickable && arrived) {
        const idx = i;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          visibleVariant = idx;
          showVariantInDOM(currentSessionId, idx);
          updateSelectedElement();
          updateBarContent('cycling');
        });
      }
      container.appendChild(dot);
    }
    return container;
  }

  function navBtn(text) {
    const b = el('button', {
      width: '26px', height: '26px', borderRadius: '5px',
      border: '1px solid ' + BP.hairline, background: 'transparent',
      color: BP.text, fontFamily: FONT, fontSize: '13px',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'border-color 0.12s ease, background 0.12s ease',
      padding: '0', lineHeight: '1',
    });
    b.textContent = text;
    b.addEventListener('mouseenter', () => { b.style.borderColor = BP.text; });
    b.addEventListener('mouseleave', () => { b.style.borderColor = BP.hairline; });
    return b;
  }

  function actionLabel() {
    const a = ACTIONS.find(a => a.value === selectedAction);
    return a ? a.label : 'Freeform';
  }

  function el(tag, styles) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    return e;
  }

  // ---------------------------------------------------------------------------
  // Action picker popover
  // ---------------------------------------------------------------------------

  function initActionPicker() {
    const P = barPaletteForTheme(detectPageTheme());
    pickerEl = document.createElement('div');
    pickerEl.id = PREFIX + '-picker';
    Object.assign(pickerEl.style, {
      position: 'fixed', zIndex: Z.picker,
      display: 'none', opacity: '0',
      transform: 'scale(0.96) translateY(4px)',
      transformOrigin: 'bottom left',
      transition: 'opacity 0.18s ' + EASE + ', transform 0.2s ' + EASE,
      background: P.surface,
      border: '1px solid ' + P.hairline,
      borderRadius: '10px',
      boxShadow: '0 8px 30px oklch(0% 0 0 / 0.10), 0 2px 6px oklch(0% 0 0 / 0.06)',
      padding: '6px',
      fontFamily: FONT,
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
    });

    // Build the chip grid
    const grid = el('div', {
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px',
    });

    ACTIONS.forEach(action => {
      const chip = el('button', {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '4px',
        padding: '8px 6px', borderRadius: '6px',
        border: 'none',
        background: action.value === selectedAction ? P.accentSoft : 'transparent',
        color: action.value === selectedAction ? P.accent : P.text,
        fontFamily: FONT, fontSize: '11px', fontWeight: '500',
        cursor: 'pointer',
        transition: 'background 0.1s ease, color 0.1s ease',
        textAlign: 'center', whiteSpace: 'nowrap',
      });
      const iconWrap = el('span', {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '20px', opacity: '0.9',
      });
      iconWrap.innerHTML = ICONS[action.value] || '';
      const labelEl = el('span', { lineHeight: '1' });
      labelEl.textContent = action.label;
      chip.appendChild(iconWrap);
      chip.appendChild(labelEl);
      chip.dataset.action = action.value;
      chip.addEventListener('mouseenter', () => {
        if (action.value !== selectedAction) chip.style.background = P.accentSoft;
      });
      chip.addEventListener('mouseleave', () => {
        chip.style.background = action.value === selectedAction ? P.accentSoft : 'transparent';
      });
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedAction = action.value;
        hideActionPicker();
        updateBarContent('configure');
      });
      grid.appendChild(chip);
    });

    pickerEl.appendChild(grid);
    document.body.appendChild(pickerEl);
    defangOutsideHandlers(pickerEl);

    // Cache the palette on the picker so toggleActionPicker's state refresh
    // uses the same theme-aware colors when it repaints chips.
    pickerEl.__iceq_palette = P;
  }

  function toggleActionPicker() {
    if (pickerEl.style.display !== 'none') { hideActionPicker(); return; }
    // Rebuild chips to reflect current selection
    const P = pickerEl.__iceq_palette || barPaletteForTheme(detectPageTheme());
    pickerEl.querySelectorAll('button').forEach(chip => {
      const isActive = chip.dataset.action === selectedAction;
      chip.style.background = isActive ? P.accentSoft : 'transparent';
      chip.style.color = isActive ? P.accent : P.text;
    });
    // Position above the bar
    const barRect = barEl.getBoundingClientRect();
    const pickerH = 170; // approximate; grows with icon + label rows
    let top = barRect.top - pickerH - 6;
    if (top < 8) top = barRect.bottom + 6;
    Object.assign(pickerEl.style, {
      top: top + 'px', left: barRect.left + 'px',
      display: 'block',
    });
    requestAnimationFrame(() => {
      pickerEl.style.opacity = '1';
      pickerEl.style.transform = 'scale(1) translateY(0)';
    });
  }

  function hideActionPicker() {
    if (!pickerEl) return;
    pickerEl.style.opacity = '0';
    pickerEl.style.transform = 'scale(0.96) translateY(4px)';
    setTimeout(() => { if (pickerEl) pickerEl.style.display = 'none'; }, 180);
  }

  // ---------------------------------------------------------------------------
  // Params panel (per-variant coarse controls)
  //
  // Variants may declare a parameter manifest via a JSON attribute on the
  // variant wrapper:
  //
  //   <div data-ttui-variant="1"
  //        data-ttui-params='[{"id":"density","kind":"steps",...}]'>
  //
  // The panel docks to the right edge of the outline during CYCLING and
  // exposes 2-5 coarse knobs. Values apply to the variant wrapper so scoped
  // CSS can respond instantly without regeneration:
  //
  //   range  / numeric toggle  → CSS var  (`--p-<id>`)  used via var(--p-foo, N)
  //   steps  / boolean toggle  → data-p-<id> attribute  used via :scope[data-p-foo="..."]
  //
  // On variant switch, values reset to that variant's declared defaults.
  // On accept, current values are sent in the event payload so the agent
  // can bake them into the source-file write.
  // ---------------------------------------------------------------------------

  let paramsPanelEl = null;     // outer wrapper (overflow:hidden, clips the slide)
  let paramsPanelInner = null;  // translating content (carries bg, padding, knobs)
  let paramsPanelBody = null;   // grid holding the knob cells
  let paramsCurrentValues = {}; // {paramId: value} — mirror of the visible variant's live values
  let tuneOpen = false;         // whether the Tune popover is open right now

  // Theme-aware Tune popover. Appears as a drawer that slides out from the
  // contextual bar's bar-facing edge (below if the bar sits below the
  // element, above otherwise). Same width as the bar. Auto-wraps to extra
  // rows when the knobs exceed one row. The bar's border-radius on the
  // popover side goes flat while open so the two shapes read as one.
  let paramsPanelPalette = null;

  function initParamsPanel() {
    paramsPanelPalette = barPaletteForTheme(detectPageTheme());
    const P = paramsPanelPalette;

    // Single element, always in the DOM. The slide animation is a CSS mask
    // with mask-size growing from 0% to 100% along the bar-facing axis — no
    // display toggle, no opacity toggle, no transform trickery. The mask
    // hides everything initially; as it grows, content is revealed from
    // the bar edge outward.
    paramsPanelEl = document.createElement('div');
    paramsPanelEl.id = PREFIX + '-params-panel';
    Object.assign(paramsPanelEl.style, {
      position: 'fixed', zIndex: String(Z.bar - 1),
      background: P.surfaceDeep,
      color: P.text,
      fontFamily: FONT,
      padding: '14px 18px',
      boxSizing: 'border-box',
      borderRadius: '0 0 10px 10px',
      pointerEvents: 'none',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',

      // clip-path is the same conceptual reveal as mask but with rock-solid
      // transition support across engines. Closed state clips from the far
      // edge; open = inset(0) shows everything.
      clipPath: 'inset(0 0 100% 0)',
      transition: 'clip-path 0.44s ' + EASE,

      // Park off-screen until positionParamsPanel places it. These are NOT
      // in the transition list, so they snap instantly — no fly-in from the
      // top-left when first shown.
      top: '-9999px', left: '-9999px', width: '0',
    });

    paramsPanelBody = el('div', {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: '12px 16px',
    });

    paramsPanelEl.appendChild(paramsPanelBody);
    document.body.appendChild(paramsPanelEl);
    // Don't override pointer-events: the panel toggles between 'none' (closed,
    // click-through) and 'auto' (open) on its own. Just silence the host's
    // outside-interaction listeners while the panel is open.
    defangOutsideHandlers(paramsPanelEl, { setPointerEvents: false });
    paramsPanelInner = paramsPanelEl; // compatibility alias for the rest of the code
  }

  function getVisibleVariantEl() {
    if (!currentSessionId) return null;
    const wrapper = document.querySelector('[data-ttui-variants="' + currentSessionId + '"]');
    if (!wrapper) return null;
    return wrapper.querySelector('[data-ttui-variant="' + variantKey(visibleVariant) + '"]');
  }

  function parseVariantParams(variantEl) {
    if (!variantEl) return [];
    const raw = variantEl.getAttribute('data-ttui-params');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[ttui] Invalid data-ttui-params JSON:', err.message);
      return [];
    }
  }

  function applyParamValue(variantEl, param, value) {
    if (!variantEl) return;
    const attr = 'data-p-' + param.id;
    if (param.kind === 'range') {
      variantEl.style.setProperty('--p-' + param.id, String(value));
    } else if (param.kind === 'toggle') {
      const on = !!value;
      variantEl.style.setProperty('--p-' + param.id, on ? '1' : '0');
      if (on) variantEl.setAttribute(attr, 'on');
      else variantEl.removeAttribute(attr);
    } else if (param.kind === 'steps') {
      variantEl.setAttribute(attr, String(value));
    }
  }

  function applyParamDefaults(variantEl, params) {
    paramsCurrentValues = {};
    for (const p of params) {
      paramsCurrentValues[p.id] = p.default;
      applyParamValue(variantEl, p, p.default);
    }
  }

  function formatRangeValue(input) {
    const max = parseFloat(input.max), min = parseFloat(input.min);
    const v = parseFloat(input.value);
    if (!isFinite(v)) return input.value;
    return (max - min) <= 2 ? v.toFixed(2) : String(Math.round(v));
  }

  function buildParamsPanel(variantEl, params) {
    const P = paramsPanelPalette || barPaletteForTheme(detectPageTheme());
    paramsPanelBody.innerHTML = '';
    for (const p of params) {
      const row = el('div', { display: 'flex', flexDirection: 'column', gap: '6px' });
      const labelRow = el('div', {
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', gap: '8px',
      });
      const lbl = el('span', {
        fontSize: '10.5px', fontWeight: '600', color: P.text,
        letterSpacing: '0.03em',
      });
      lbl.textContent = p.label || p.id;
      labelRow.appendChild(lbl);
      const readout = el('span', {
        fontSize: '10.5px', color: P.textDim,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      });
      labelRow.appendChild(readout);
      row.appendChild(labelRow);

      if (p.kind === 'range') {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(p.min != null ? p.min : 0);
        input.max = String(p.max != null ? p.max : 1);
        input.step = String(p.step != null ? p.step : 0.05);
        input.value = String(p.default);
        Object.assign(input.style, {
          width: '100%', accentColor: C.brand, cursor: 'pointer',
        });
        readout.textContent = formatRangeValue(input);
        input.addEventListener('input', (e) => {
          e.stopPropagation();
          const v = parseFloat(input.value);
          paramsCurrentValues[p.id] = v;
          readout.textContent = formatRangeValue(input);
          applyParamValue(variantEl, p, v);
          queueCheckpoint('param_changed');
        });
        row.appendChild(input);
      } else if (p.kind === 'toggle') {
        const initial = !!p.default;
        readout.textContent = initial ? 'On' : 'Off';
        const track = el('button', {
          position: 'relative', width: '36px', height: '20px',
          borderRadius: '10px', border: 'none', padding: '0',
          cursor: 'pointer',
          background: initial ? C.brand : P.hairline,
          transition: 'background 0.15s ease',
          alignSelf: 'flex-start',
        });
        const knob = el('span', {
          position: 'absolute', top: '2px',
          left: initial ? '18px' : '2px',
          width: '16px', height: '16px', borderRadius: '50%',
          background: 'oklch(98% 0 0)',
          transition: 'left 0.18s ' + EASE,
          boxShadow: '0 1px 2px oklch(0% 0 0 / 0.2)',
        });
        track.appendChild(knob);
        track.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = !paramsCurrentValues[p.id];
          paramsCurrentValues[p.id] = next;
          track.style.background = next ? C.brand : P.hairline;
          knob.style.left = next ? '18px' : '2px';
          readout.textContent = next ? 'On' : 'Off';
          applyParamValue(variantEl, p, next);
          queueCheckpoint('param_changed');
        });
        row.appendChild(track);
      } else if (p.kind === 'steps') {
        const opts = (p.options || []).map(o =>
          typeof o === 'string' ? { value: o, label: o } : o
        );
        const activeOpt = opts.find(o => o.value === p.default) || opts[0];
        readout.textContent = activeOpt ? activeOpt.label : String(p.default);
        const segRow = el('div', {
          display: 'grid',
          gridTemplateColumns: 'repeat(' + opts.length + ', 1fr)',
          gap: '1px', padding: '2px',
          background: P.hairline, borderRadius: '5px',
        });
        const segBtns = [];
        opts.forEach(o => {
          const active = o.value === p.default;
          const b = el('button', {
            padding: '5px 4px', border: 'none', borderRadius: '3px',
            background: active ? C.brand : 'transparent',
            color: active ? C.ink : P.text,
            fontFamily: FONT, fontSize: '10.5px', fontWeight: '500',
            cursor: 'pointer', whiteSpace: 'nowrap',
            transition: 'background 0.1s ease, color 0.1s ease',
          });
          b.textContent = o.label;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            paramsCurrentValues[p.id] = o.value;
            readout.textContent = o.label;
            segBtns.forEach(({ btn, val }) => {
              const on = val === o.value;
              btn.style.background = on ? C.brand : 'transparent';
              btn.style.color = on ? C.ink : P.text;
            });
            applyParamValue(variantEl, p, o.value);
            queueCheckpoint('param_changed');
          });
          segRow.appendChild(b);
          segBtns.push({ btn: b, val: o.value });
        });
        row.appendChild(segRow);
      }

      paramsPanelBody.appendChild(row);
    }
  }

  // Decide which way the popover opens: away from the picked element. If the
  // bar landed below the element, popover slides DOWN from the bar's bottom.
  // If the bar landed above, popover slides UP from the bar's top.
  function popoverDirection() {
    if (!barEl || !selectedElement) return 'below';
    const br = barEl.getBoundingClientRect();
    const er = selectedElement.getBoundingClientRect();
    return br.top >= er.bottom - 4 ? 'below' : 'above';
  }

  // The popover overlaps the bar by OVERLAP px on the bar-facing side. With
  // popover z-index below bar, that overlap sits behind bar (invisible) and
  // reinforces the "tucked behind" feel. Padding compensates so the real
  // content starts flush with bar's outer edge.
  const TUNE_OVERLAP = 6;

  // Closed clip-path depends on direction: for 'below' clip from the far
  // (bottom) edge so the reveal grows downward from the bar; for 'above'
  // clip from the top edge so the reveal grows upward from the bar.
  function closedClipPath(direction) {
    return direction === 'below' ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)';
  }

  function setClipPath(value, withTransition) {
    const saved = paramsPanelEl.style.transition;
    if (!withTransition) paramsPanelEl.style.transition = 'none';
    paramsPanelEl.style.clipPath = value;
    if (!withTransition) {
      void paramsPanelEl.offsetHeight;
      paramsPanelEl.style.transition = saved;
    }
  }

  function positionParamsPanel() {
    if (!paramsPanelEl || !barEl || barEl.style.display === 'none') return;
    const br = barEl.getBoundingClientRect();
    const direction = popoverDirection();
    const prevDirection = paramsPanelEl.dataset.tuneDirection;

    // top/left/width are NOT in the transition list, so they snap instantly.
    paramsPanelEl.style.left = br.left + 'px';
    paramsPanelEl.style.width = br.width + 'px';

    if (direction === 'below') {
      paramsPanelEl.style.top = (br.bottom - TUNE_OVERLAP) + 'px';
      paramsPanelEl.style.borderRadius = '0 0 10px 10px';
      paramsPanelEl.style.paddingTop = (14 + TUNE_OVERLAP) + 'px';
      paramsPanelEl.style.paddingBottom = '14px';
    } else {
      const ih = paramsPanelEl.offsetHeight || 80;
      paramsPanelEl.style.top = (br.top - ih + TUNE_OVERLAP) + 'px';
      paramsPanelEl.style.borderRadius = '10px 10px 0 0';
      paramsPanelEl.style.paddingTop = '14px';
      paramsPanelEl.style.paddingBottom = (14 + TUNE_OVERLAP) + 'px';
    }
    paramsPanelEl.dataset.tuneDirection = direction;

    // If currently closed and direction flipped (or first-time setup),
    // snap the clip-path to the new direction's closed pose without
    // transitioning (so the clip doesn't slide across the element).
    if (!tuneOpen && (!prevDirection || prevDirection !== direction)) {
      setClipPath(closedClipPath(direction), false);
    }
  }

  function showParamsPanel() {
    if (!paramsPanelEl) return;
    positionParamsPanel();
    paramsPanelEl.style.pointerEvents = 'auto';
    // rAF so the positioning paint commits before the transition fires.
    requestAnimationFrame(() => {
      setClipPath('inset(0 0 0 0)', true);
    });
  }

  function hideParamsPanel() {
    if (!paramsPanelEl) return;
    paramsPanelEl.style.pointerEvents = 'none';
    const direction = paramsPanelEl.dataset.tuneDirection || 'below';
    setClipPath(closedClipPath(direction), true);
  }

  // Build/rebuild the panel's contents for the current variant AND apply
  // its defaults to the variant wrapper (so scoped CSS responds even before
  // the user opens the popover). Visibility is governed by tuneOpen.
  function refreshParamsPanel() {
    if (state !== 'CYCLING') {
      paramsCurrentValues = {};
      tuneOpen = false;
      hideParamsPanel();
      return;
    }
    const variantEl = getVisibleVariantEl();
    const params = parseVariantParams(variantEl);
    if (!variantEl || params.length === 0) {
      paramsCurrentValues = {};
      tuneOpen = false;
      hideParamsPanel();
      return;
    }
    applyParamDefaults(variantEl, params);
    buildParamsPanel(variantEl, params);
    if (tuneOpen) {
      // If already visible (variant cycled while open), refresh in place
      // instead of re-running the clip-path animation.
      const alreadyVisible = paramsPanelEl.style.display === 'block'
        && paramsPanelEl.style.opacity === '1';
      if (alreadyVisible) positionParamsPanel();
      else showParamsPanel();
    } else {
      hideParamsPanel();
    }
  }

  function toggleTunePopover() {
    if (tuneOpen) { closeTunePopover(); return; }
    openTunePopover();
  }

  function openTunePopover() {
    if (state !== 'CYCLING') return;
    const variantEl = getVisibleVariantEl();
    const params = parseVariantParams(variantEl);
    if (!variantEl || params.length === 0) return;
    // Build fresh to ensure the current variant's controls are shown.
    applyParamDefaults(variantEl, params);
    buildParamsPanel(variantEl, params);
    tuneOpen = true;
    showParamsPanel();
    // Kill the bar's shadow on the popover-facing side so the dark popover
    // doesn't pick up a bright glow line.
    if (barEl) {
      const direction = paramsPanelEl?.dataset.tuneDirection || 'below';
      barEl.style.boxShadow = direction === 'below' ? BAR_SHADOW_UP : BAR_SHADOW_DOWN;
    }
    // Re-render the bar so the Tune chip picks up the active styling.
    updateBarContent('cycling');
  }

  function closeTunePopover() {
    tuneOpen = false;
    hideParamsPanel();
    if (barEl) barEl.style.boxShadow = BAR_SHADOW_DEFAULT;
    if (barEl && barEl.style.display !== 'none' && state === 'CYCLING') {
      updateBarContent('cycling');
    }
  }

  // ---------------------------------------------------------------------------
  // Variant cycling in DOM
  // ---------------------------------------------------------------------------

  function showVariantInDOM(sessionId, num) {
    const wrapper = document.querySelector('[data-ttui-variants="' + sessionId + '"]');
    if (!wrapper) return;
    for (const child of wrapper.children) {
      const v = child.dataset ? child.dataset.ttuiVariant : null;
      if (!v) continue;
      child.style.display = (v === variantKey(num)) ? '' : 'none';
    }
    // Unconditional refresh — covers first-reveal (no-op if state isn't
    // CYCLING yet, the subsequent CYCLING transition triggers its own
    // refresh) and every cycle step.
    refreshParamsPanel();
  }

  /**
   * No-HMR fallback: fetch the raw source file from the live server,
   * parse it, extract the variant wrapper, and inject it into the live DOM.
   * This works even when the dev server caches HTML (Bun, static servers).
   */
  function injectVariantsFromSource(filePath, sessionId) {
    const url = 'http://localhost:' + PORT + '/source?token=' + TOKEN + '&path=' + encodeURIComponent(filePath);
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(html => {
        // Parse the raw source HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const srcWrapper = doc.querySelector('[data-ttui-variants="' + sessionId + '"]');
        if (!srcWrapper) {
          console.error('[ttui] Variant wrapper not found in source file.');
          return;
        }

        // Find the original element in the live DOM.
        // The original is inside the wrapper in the source. We find the
        // corresponding element in the live DOM by matching the first child's
        // tag + classes from the original snapshot.
        const origContent = srcWrapper.querySelector('[data-ttui-variant="original"] > :first-child');
        if (!origContent) return;

        const tag = origContent.tagName.toLowerCase();
        const cls = origContent.className;
        let liveEl = null;
        if (currentSessionId === sessionId && selectedElement && selectedElement.isConnected && !own(selectedElement)) {
          liveEl = selectedElement; // the element the user picked for this request
        } else if (origContent.id) {
          liveEl = document.getElementById(origContent.id);
        } else if (cls) {
          // Find by tag + exact class match
          const candidates = document.querySelectorAll(tag + '.' + cls.split(' ')[0]);
          for (const c of candidates) {
            if (c.className === cls && !own(c)) { liveEl = c; break; }
          }
        }

        if (!liveEl) {
          console.error('[ttui] Could not find original element in live DOM.');
          return;
        }

        const previousVisibleVariant = currentSessionId === sessionId ? visibleVariant : 0;

        // Replace the live element with the full wrapper from source
        const wrapper = srcWrapper.cloneNode(true);
        liveEl.parentElement.replaceChild(wrapper, liveEl);

        // Update state: count variants, preserving the user's current variant
        // when a late HMR/source reinjection lands after they have cycled.
        const variants = wrapper.querySelectorAll('[data-ttui-variant]:not([data-ttui-variant="original"])');
        arrivedVariants = variants.length;
        expectedVariants = parseInt(wrapper.dataset.ttuiVariantCount || arrivedVariants);
        const saved = loadSession();
        const savedVisibleVariant = saved && saved.id === sessionId ? saved.visible : 0;
        visibleVariant = previousVisibleVariant > 0 && previousVisibleVariant <= arrivedVariants
          ? previousVisibleVariant
          : (savedVisibleVariant > 0 && savedVisibleVariant <= arrivedVariants ? savedVisibleVariant : 1);
        showVariantInDOM(sessionId, visibleVariant);

        // Update selectedElement to the visible variant's content
        selectedElement = pickVariantContent(wrapper, visibleVariant) || wrapper.parentElement;

        state = 'CYCLING';
        hideShaderOverlay();
        updateBarContent('cycling');
        refreshParamsPanel();
        saveSession();
        console.log('[ttui] Injected ' + arrivedVariants + ' variants from source file.');
      })
      .catch(err => {
        console.error('[ttui] Failed to fetch source:', err);
        showToast('Could not load variants. Try refreshing the page.', 5000);
      });
  }

  function cycleVariant(dir) {
    const next = visibleVariant + dir;
    if (next < 0 || next > arrivedVariants) return;
    visibleVariant = next;
    showVariantInDOM(currentSessionId, next); // calls refreshParamsPanel itself
    updateSelectedElement();
    updateBarContent('cycling');
    saveSession();
    rememberOpen(currentSessionId, next);
    queueCheckpoint('variant_changed');
  }

  function updateSelectedElement() {
    if (!currentSessionId) return;
    const wrapper = document.querySelector('[data-ttui-variants="' + currentSessionId + '"]');
    if (!wrapper) return;
    const visEl = pickVariantContent(wrapper, visibleVariant);
    if (visEl) selectedElement = visEl;
  }

  function readVisibleVariantFromDOM(sessionId) {
    const wrapper = document.querySelector('[data-ttui-variants="' + sessionId + '"]');
    if (!wrapper) return 0;
    const variants = wrapper.querySelectorAll('[data-ttui-variant]:not([data-ttui-variant="original"])');
    for (const variant of variants) {
      if (variant.style.display === 'none') continue;
      const idx = parseInt(variant.dataset.ttuiVariant || '0', 10);
      if (idx > 0) return idx;
    }
    return 0;
  }

  // Resolve the element that represents the variant's visible content.
  // Contract: each variant div should contain exactly one top-level element
  // (the full replacement). In practice a model may ship loose siblings or
  // lead with <style>/<script>. Be defensive: skip non-visual elements, and
  // if the variant has multiple element children, use the variant div itself
  // (it wraps all of them and gets correct bounds).
  // Version 0 is the untouched original; 1..N are the generated versions.
  function variantKey(num) { return num === 0 ? 'original' : String(num); }

  function pickVariantContent(wrapper, index) {
    if (!wrapper) return null;
    const key = typeof index === 'number' ? variantKey(index) : index;
    const variantDiv = wrapper.querySelector('[data-ttui-variant="' + key + '"]');
    if (!variantDiv) return null;
    const NON_VISUAL = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'TEMPLATE']);
    const visual = [];
    for (const child of variantDiv.children) {
      if (!NON_VISUAL.has(child.tagName)) visual.push(child);
    }
    if (visual.length === 1) return visual[0];
    return variantDiv;
  }

  // Hold window.scrollY at a fixed value across DOM mutations inside the
  // session's wrapper (HMR patches, variant inserts, cycle swaps).
  function startScrollLock(sessionId, initialTargetY) {
    stopScrollLock();
    scrollLockTargetY = typeof initialTargetY === 'number' && isFinite(initialTargetY)
      ? initialTargetY
      : window.scrollY;
    console.log('[ttui.scroll] startScrollLock', { sessionId, scrollY: window.scrollY, targetY: scrollLockTargetY, initialOverride: initialTargetY });

    try { history.scrollRestoration = 'manual'; } catch {}

    const prevHtmlAnchor = document.documentElement.style.overflowAnchor;
    const prevBodyAnchor = document.body.style.overflowAnchor;
    document.documentElement.style.overflowAnchor = 'none';
    document.body.style.overflowAnchor = 'none';

    const correct = (why) => {
      scrollLockRaf = null;
      if (scrollLockTargetY == null) return;
      const before = window.scrollY;
      const delta = before - scrollLockTargetY;
      if (Math.abs(delta) < 0.5) {
        console.log('[ttui.scroll] correct noop', { why, scrollY: before, targetY: scrollLockTargetY });
        return;
      }
      window.scrollTo({ top: scrollLockTargetY, left: window.scrollX, behavior: 'instant' });
      console.log('[ttui.scroll] corrected', { why, from: before, to: scrollLockTargetY, delta, nowAt: window.scrollY });
    };
    const schedule = (why) => {
      if (scrollLockRaf != null) return;
      scrollLockRaf = requestAnimationFrame(() => correct(why));
    };

    scrollLockObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.target?.closest?.('[data-ttui-variants="' + sessionId + '"]')) {
          const childAdds = Array.from(m.addedNodes).map(n => n.nodeType === 1 ? (n.tagName + (n.dataset?.ttuiVariant ? ('[variant=' + n.dataset.ttuiVariant + ']') : '')) : n.nodeType).join(',');
          console.log('[ttui.scroll] mutation inside wrapper', { type: m.type, target: m.target?.tagName, adds: childAdds, scrollYBefore: window.scrollY, targetY: scrollLockTargetY });
          schedule('mutation-in-wrapper');
          return;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && (n.matches?.('[data-ttui-variants="' + sessionId + '"]') || n.querySelector?.('[data-ttui-variants="' + sessionId + '"]'))) {
            console.log('[ttui.scroll] wrapper node added', { tag: n.tagName, scrollYBefore: window.scrollY, targetY: scrollLockTargetY });
            schedule('wrapper-added');
            return;
          }
        }
      }
    });
    scrollLockObserver.observe(document.body, { childList: true, subtree: true });

    scrollLockAbort = new AbortController();
    scrollLockAbort.signal.addEventListener('abort', () => {
      document.documentElement.style.overflowAnchor = prevHtmlAnchor;
      document.body.style.overflowAnchor = prevBodyAnchor;
    }, { once: true });
    const sig = { signal: scrollLockAbort.signal };
    // Track whether the most recent scroll came from a user gesture. We
    // gate user-scroll re-anchoring on this flag so programmatic smooth
    // scrolls (browser reload-restore, scrollIntoView from other scripts)
    // don't accidentally update our target.
    let userGestureAt = 0;
    const USER_GESTURE_WINDOW_MS = 250;

    const reanchor = (why) => {
      if (scrollLockRaf != null) { cancelAnimationFrame(scrollLockRaf); scrollLockRaf = null; }
      const prevTarget = scrollLockTargetY;
      scrollLockTargetY = window.scrollY;
      writeScrollY(scrollLockTargetY);
      console.log('[ttui.scroll] reanchor', { why, prevTarget, newTarget: scrollLockTargetY });
    };
    const markGesture = (why) => {
      userGestureAt = performance.now();
      reanchor(why);
    };
    window.addEventListener('wheel', () => markGesture('wheel'), { passive: true, ...sig });
    window.addEventListener('touchstart', () => markGesture('touchstart'), { passive: true, ...sig });
    window.addEventListener('touchmove', () => markGesture('touchmove'), { passive: true, ...sig });
    window.addEventListener('keydown', (e) => {
      if (['PageDown', 'PageUp', ' ', 'End', 'Home', 'ArrowDown', 'ArrowUp'].includes(e.key)) markGesture('key:' + e.key);
    }, sig);

    // Correct on EVERY scroll event: whether it's the browser's
    // post-reload animated restore or some other script calling
    // scrollIntoView, we want to snap back immediately. Only skip if a
    // user gesture fired in the last 250ms.
    let lastLoggedScrollY = window.scrollY;
    window.addEventListener('scroll', () => {
      const now = window.scrollY;
      if (Math.abs(now - lastLoggedScrollY) > 5) {
        console.log('[ttui.scroll] scroll event', { from: lastLoggedScrollY, to: now, targetY: scrollLockTargetY });
        lastLoggedScrollY = now;
      }
      if (scrollLockTargetY == null) return;
      if (performance.now() - userGestureAt < USER_GESTURE_WINDOW_MS) return;
      if (Math.abs(now - scrollLockTargetY) < 0.5) return;
      console.log('[ttui.scroll] scroll-event snap', { from: now, to: scrollLockTargetY });
      window.scrollTo({ top: scrollLockTargetY, left: window.scrollX, behavior: 'instant' });
    }, { passive: true, ...sig });

    // Apply target synchronously, not via rAF — racing the browser's
    // restore or a smooth-scroll animation means we want to win now.
    if (Math.abs(window.scrollY - scrollLockTargetY) > 0.5) {
      window.scrollTo({ top: scrollLockTargetY, left: window.scrollX, behavior: 'instant' });
      console.log('[ttui.scroll] startScrollLock initial apply', { to: scrollLockTargetY });
    }
  }

  function stopScrollLock() {
    if (scrollLockObserver) { scrollLockObserver.disconnect(); scrollLockObserver = null; }
    if (scrollLockRaf != null) { cancelAnimationFrame(scrollLockRaf); scrollLockRaf = null; }
    if (scrollLockAbort) { scrollLockAbort.abort(); scrollLockAbort = null; }
    scrollLockTargetY = null;
    // NOTE: do NOT clear the persistent scroll key here. startScrollLock
    // calls us as a reset, and clearing the key would nuke the Go-time
    // scrollY that the next resume needs to read.
  }

  // ---------------------------------------------------------------------------
  // MutationObserver for progressive variant reveal
  // ---------------------------------------------------------------------------

  function startVariantObserver(sessionId) {
    let updating = false; // re-entrancy guard

    const obs = new MutationObserver((mutations) => {
      if (updating) return;

      // Only react to mutations that add nodes with data-ttui-variant,
      // or mutations inside the variant wrapper. Ignore our own bar/UI changes.
      let dominated = false;
      for (const m of mutations) {
        if (m.target.closest?.('[data-ttui-variants]')) { dominated = true; break; }
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          // Direct hit: the added node itself is the wrapper or a variant.
          if (n.dataset?.ttuiVariants || n.dataset?.ttuiVariant) {
            dominated = true; break;
          }
          // Subtree hit: framework HMR (notably SvelteKit) sometimes replaces
          // a whole subtree where the wrapper is a descendant of the added
          // node. Without this check, the observer ignores those mutations
          // and the session stays in GENERATING forever.
          if (n.querySelector?.('[data-ttui-variants],[data-ttui-variant]')) {
            dominated = true; break;
          }
        }
        if (dominated) break;
      }
      if (!dominated) return;

      const wrapper = document.querySelector('[data-ttui-variants="' + sessionId + '"]');
      if (!wrapper) return;

      // Re-anchor selectedElement if it was detached by live-wrap's HMR swap.
      // Without this, the shader / highlight / bar track a zero-rect phantom
      // and the overlay appears frozen.
      if (selectedElement && !document.body.contains(selectedElement)) {
        selectedElement = pickVariantContent(wrapper, 'original') || wrapper;
      }

      const variants = wrapper.querySelectorAll('[data-ttui-variant]:not([data-ttui-variant="original"])');
      const count = variants.length;

      // Nothing new
      if (count <= arrivedVariants) return;

      updating = true;
      arrivedVariants = count;
      if (visibleVariant === 0 && arrivedVariants > 0) {
        const saved = loadSession();
        const savedVisibleVariant = saved && saved.id === sessionId ? saved.visible : 0;
        visibleVariant = savedVisibleVariant > 0 && savedVisibleVariant <= arrivedVariants ? savedVisibleVariant : 1;
        showVariantInDOM(sessionId, visibleVariant);
        // showVariantInDOM hid the original (display:none); if we were still
        // anchored to the original's content, its boundingRect is now zero
        // and the bar snaps to (0,0). Re-point at the visible variant instead.
        const visEl = pickVariantContent(wrapper, visibleVariant);
        if (visEl) selectedElement = visEl;
      }

      const expected = parseInt(wrapper.dataset.ttuiVariantCount || '0');
      if (expected > 0) expectedVariants = expected;

      if (arrivedVariants >= expectedVariants && expectedVariants > 0) {
        state = 'CYCLING';
        hideShaderOverlay();
        updateBarContent('cycling');
        refreshParamsPanel();
      } else if (state === 'GENERATING') {
        updateBarContent('generating');
      }
      saveSession();
      queueCheckpoint(state === 'CYCLING' ? 'variants_ready' : 'variants_progress');
      updating = false;
    });

    obs.observe(document.body, { childList: true, subtree: true });
    return obs;
  }

  // ---------------------------------------------------------------------------
  // Bar scroll tracking
  // ---------------------------------------------------------------------------

  function startScrollTracking() {
    function tick() {
      if (state === 'CONFIGURING' || state === 'GENERATING' || state === 'CYCLING') {
        positionBar();
        showHighlight(selectedElement);
        if (tuneOpen) positionParamsPanel();
      }
      if (annotActive) positionAnnotOverlay(selectedElement);
      // Shader overlay (via debug P toggle or generation) is repositioned
      // by its own branch below; debug no longer has a separate overlay.
      if (shaderState) positionShaderOverlay();
      scrollRaf = requestAnimationFrame(tick);
    }
    scrollRaf = requestAnimationFrame(tick);
  }

  function stopScrollTracking() {
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
  }

  // ---------------------------------------------------------------------------
  // SSE (server→browser) + fetch POST (browser→server)
  // Zero-dependency replacement for WebSocket.
  // ---------------------------------------------------------------------------

  let evtSource = null;
  let sseRetries = 0;
  const SSE_MAX_RETRIES = 20;  // generous: heartbeats keep the connection alive, so retries mean real trouble

  function connectSSE() {
    evtSource = new EventSource('http://localhost:' + PORT + '/events?token=' + TOKEN);

    evtSource.onopen = () => {
      sseRetries = 0; // reset on successful (re)connect
    };

    evtSource.onmessage = (e) => {
      sseRetries = 0; // reset on any successful message
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case 'connected':
          hasProjectContext = !!msg.hasProjectContext;
          if (!hasProjectContext) showToast('No PRODUCT.md found. Variants will be brand-agnostic. Run /ttui teach to generate one.', 7000);
          console.log('[ttui] Live mode connected.');
          if (state === 'IDLE') state = 'PICKING';
          break;
        case 'complete':
          if (msg.id === directSessionId) finishDirect(msg.message);
          break;
        case 'done':
          if (msg.id === directSessionId) { finishDirect(msg.message); break; }
          // Variants already arrived via HMR → normal transition.
          if (arrivedVariants >= expectedVariants && expectedVariants > 0) {
            if (state === 'GENERATING') {
              state = 'CYCLING';
              updateBarContent('cycling');
              refreshParamsPanel();
            }
            break;
          }
          // Variants are in source but not in the DOM yet. Common when the
          // picked element lived inside conditional render (closed modal,
          // hidden tab, a route the user navigated away from). The variant
          // MutationObserver stays armed and auto-transitions to CYCLING
          // the moment the wrapper actually mounts. Nudge the user toward
          // that path with a toast — better than the prior force-reload
          // which reset framework state and left the session stuck.
          setTimeout(() => {
            if (arrivedVariants >= expectedVariants && expectedVariants > 0) return;
            if (state !== 'GENERATING') return;
            // Plain HTML on a server without hot reload: nothing will swap the
            // page, so read the versions straight from the source file.
            if (msg.file && /\.html?$/i.test(msg.file) && !document.querySelector('[data-ttui-variants="' + msg.id + '"]')) {
              injectVariantsFromSource(msg.file, msg.id);
              return;
            }
            showToast(
              "Variants ready. If the picked element isn't visible, retrace the path that revealed it — they'll appear automatically.",
              15000,
            );
          }, 2000);
          break;
        case 'answer':
        case 'error':
          if (msg.type === 'error') console.error('[ttui] Error:', msg.message);
          showToast(msg.type === 'answer' ? msg.message : 'Error: ' + msg.message, msg.type === 'answer' ? 12000 : 5000);
          hideBar();
          if (msg.id && msg.id === currentSessionId) {
            // The request is over: stop the sweep and forget it, so a reload doesn't resume it.
            hideShaderOverlay();
            hideHighlight();
            stopScrollLock();
            if (variantObserver) { variantObserver.disconnect(); variantObserver = null; }
            clearSession();
            directSessionId = null;
            currentSessionId = null;
            selectedElement = null;
          }
          state = 'PICKING';
          break;
      }
    };

    evtSource.onerror = () => {
      sseRetries++;
      if (sseRetries <= SSE_MAX_RETRIES) {
        console.log('[ttui] SSE connection lost. Retry ' + sseRetries + '/' + SSE_MAX_RETRIES + '...');
        return; // EventSource auto-reconnects
      }
      // Server is gone. Clean up gracefully.
      console.log('[ttui] Live server unreachable. Cleaning up UI.');
      evtSource.close();
      evtSource = null;
      handleServerLost();
    };
  }

  /** Server died or became unreachable. Reset UI to a clean state. */
  function handleServerLost() {
    const recoveryState = currentSessionId ? state : 'IDLE';
    if (state === 'GENERATING' || state === 'CYCLING' || state === 'SAVING') {
      showToast('Live server disconnected. Session ended.', 5000);
    }
    hideBar();
    hideHighlight();
    hideShaderOverlay();
    hideAnnotOverlay();
    stopScrollTracking();
    if (variantObserver) { variantObserver.disconnect(); variantObserver = null; }
    stopScrollLock();
    // Preserve local session state on server loss. The durable journal is the
    // source of truth, but localStorage plus the variant wrapper lets the UI
    // resume after a helper restart or page reload instead of treating a
    // transient disconnect as an explicit discard.
    selectedElement = null;
    selectedAction = 'ttui';
    state = recoveryState;
    if (currentSessionId) saveSession();
  }

  function sendEvent(msg, opts) {
    msg.token = TOKEN;
    function handleFailure(err) {
      console.error('[ttui] Failed to send event:', err);
      if (opts && opts.throwOnError) throw err;
      return null;
    }
    return fetch('http://localhost:' + PORT + '/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).then(res => {
      if (res.ok) return res;
      return handleFailure(new Error('HTTP ' + res.status + ' ' + res.statusText));
    }).catch(handleFailure);
  }

  function checkpointPayload(reason) {
    return {
      type: 'checkpoint',
      id: currentSessionId,
      revision: sessionState.nextCheckpointRevision(),
      owner: browserOwner,
      phase: String(state || '').toLowerCase(),
      reason,
      pageUrl: location.pathname,
      expectedVariants,
      arrivedVariants,
      visibleVariant,
      paramValues: { ...paramsCurrentValues },
    };
  }

  function sendCheckpoint(reason) {
    if (!currentSessionId) return Promise.resolve(null);
    return sendEvent(checkpointPayload(reason)).catch(() => null);
  }

  function queueCheckpoint(reason) {
    if (!currentSessionId) return;
    if (checkpointTimer) clearTimeout(checkpointTimer);
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null;
      sendCheckpoint(reason);
    }, 120);
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function handleMouseMove(e) {
    if (state !== 'PICKING' || !pickActive || pickMode === 'draw') return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || !pickable(target) || target === hoveredElement) return;
    hoveredElement = target;
    showHighlight(target);
  }

  function handleClick(e) {
    // The click that ends a Draw-to-pick gesture must not cancel the new selection.
    if (Date.now() < suppressClickUntil) { suppressClickUntil = 0; e.preventDefault(); e.stopPropagation(); return; }
    // Close action picker on any outside click
    if (pickerEl?.style.display !== 'none' && !own(e.target)) {
      hideActionPicker();
    }
    // Close Tune popover on outside click (anything outside panel + bar)
    if (tuneOpen && paramsPanelEl && !paramsPanelEl.contains(e.target) && barEl && !barEl.contains(e.target)) {
      closeTunePopover();
    }
    // In CONFIGURING: click outside the bar and selected element returns to PICKING
    if (state === 'CONFIGURING' && !own(e.target) && selectedElement && !selectedElement.contains(e.target)) {
      hideBar();
      stopScrollTracking();
      hideAnnotOverlay();
      clearAnnotations();
      state = 'PICKING';
      hoveredElement = null;
      hideHighlight();
      return;
    }
    // Flipping through versions and clicking something else on the page: keep
    // those versions where they are (tagged) and start on the clicked thing.
    if (state === 'CYCLING' && pickActive && !own(e.target)
        && !e.target.closest?.('[data-ttui-variants="' + currentSessionId + '"]')) {
      parkCurrent();
      const under = document.elementFromPoint(e.clientX, e.clientY);
      hoveredElement = under && pickable(under) ? under : null;
    }
    if (state !== 'PICKING' || !pickActive) return;
    if (own(e.target)) return;
    if (!hoveredElement || !pickable(hoveredElement)) return;
    e.preventDefault();
    e.stopPropagation();
    // Inside something that already has versions: show those instead of
    // starting a second, overlapping set.
    const openWrapper = hoveredElement.closest?.('[data-ttui-variants]');
    if (openWrapper && !isSessionHandled(openWrapper.dataset.ttuiVariants)) {
      hideHighlight();
      focusSession(openWrapper.dataset.ttuiVariants);
      return;
    }
    selectedElement = hoveredElement;
    state = 'CONFIGURING';
    showHighlight(selectedElement);
    clearAnnotations();
    showAnnotOverlay(selectedElement);
    showBar('configure');
    startScrollTracking();
    maybePrefetchPage();
    maybeWarnConditionalAncestor(selectedElement);
  }

  /**
   * Surface a brief, non-blocking heads-up when the picked element lives
   * inside a container whose visibility is gated by ephemeral state — modals,
   * collapsible panels, popovers, off-screen tab panels. If HMR remounts the
   * parent during generation (Vite Fast Refresh, SvelteKit page reload), the
   * variants land in source but stay invisible until the user re-opens the
   * container. Telling the user upfront is much friendlier than the silent
   * timeout-then-toast that they'd otherwise hit.
   *
   * Heuristic, intentionally narrow — only fires for unambiguous cases so
   * we don't cry wolf on every nested element.
   */
  function maybeWarnConditionalAncestor(el) {
    let node = el?.parentElement;
    let depth = 0;
    while (node && depth < 12) {
      // 1. Active dialog / modal
      if (node.getAttribute && node.getAttribute('role') === 'dialog'
          && node.getAttribute('aria-modal') === 'true') {
        showToast('Heads up: this element lives inside a dialog. If state resets during generation, you may need to re-open it.', 6000);
        return;
      }
      // 2. Common Radix / shadcn / headless-ui open-state attribute
      if (node.dataset && node.dataset.state === 'open') {
        showToast('Heads up: this element lives inside an open panel. If state resets during generation, you may need to re-open it.', 6000);
        return;
      }
      // 3. Tab panel — only meaningful when the page also shows ANOTHER
      // tab as selected. A single tabpanel with no tablist is just a static
      // section in disguise and isn't conditional.
      if (node.getAttribute && node.getAttribute('role') === 'tabpanel') {
        const list = document.querySelector('[role="tablist"]');
        if (list) {
          const tabs = list.querySelectorAll('[role="tab"]');
          if (tabs.length > 1) {
            showToast('Heads up: this element lives in a tab panel. If state resets during generation, switch back to this tab.', 6000);
            return;
          }
        }
      }
      // 4. Collapsible: aria-expanded sibling. Look for the trigger button.
      if (node.id) {
        const trigger = document.querySelector(`[aria-controls="${CSS.escape(node.id)}"][aria-expanded="true"]`);
        if (trigger) {
          showToast('Heads up: this element lives inside an expandable section. If state resets during generation, re-expand it.', 6000);
          return;
        }
      }
      node = node.parentElement;
      depth++;
    }
  }

  // Fire a lightweight prefetch event the first time the user selects an
  // element on a given route. The agent uses this to Read the underlying file
  // into context before Go is hit, shaving the read off the critical path.
  // Dedupe per session by pathname — clicking around on the same page doesn't
  // re-fire.
  //
  // DISABLED: quick-Go workflows pay an extra harness round trip because
  // prefetch + generate arrive as two events instead of one. Re-enable with
  // a browser-side debounce (~800–1000ms, cancelled on Go) if we want to
  // resurrect this. Server validator and skill dispatch remain in place so
  // flipping this flag is the only change needed.
  const PREFETCH_ENABLED = false;
  const prefetchedPaths = new Set();
  function maybePrefetchPage() {
    if (!PREFETCH_ENABLED) return;
    const path = location.pathname;
    if (prefetchedPaths.has(path)) return;
    prefetchedPaths.add(path);
    sendEvent({ type: 'prefetch', pageUrl: path });
  }

  function handleKeyDown(e) {
    if (e.__ttuiHandled || (globalBarEl && globalBarEl.contains(e.target))) return;
    // When the annotation input is focused, let it handle its own keys.
    if (annotEditing && annotEditing.input && e.target === annotEditing.input) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pickerEl?.style.display !== 'none') { hideActionPicker(); return; }
      if (state === 'CONFIGURING') { hideBar(); stopScrollTracking(); hideAnnotOverlay(); clearAnnotations(); state = 'PICKING'; return; }
      if (state === 'CYCLING') { handleDiscard(); return; }
      if (state === 'SAVING' || state === 'CONFIRMED') return; // don't interrupt
      if (state === 'PICKING') { hoveredElement = null; hideHighlight(); return; }
    }

    // Arrow/Enter nav works in PICKING (hover) and CONFIGURING (selected, input empty)
    var navEl = (state === 'PICKING') ? hoveredElement : (state === 'CONFIGURING') ? selectedElement : null;
    if (navEl && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || (e.key === 'Enter' && state === 'PICKING'))) {
      let next = null;
      if (e.key === 'ArrowDown' && !e.shiftKey) {
        next = navEl.nextElementSibling;
        while (next && !pickable(next)) next = next.nextElementSibling;
      } else if (e.key === 'ArrowUp' && !e.shiftKey) {
        next = navEl.previousElementSibling;
        while (next && !pickable(next)) next = next.previousElementSibling;
      } else if (e.key === 'ArrowUp' && e.shiftKey) {
        next = navEl.parentElement;
        if (next && !pickable(next)) next = null;
      } else if (e.key === 'ArrowDown' && e.shiftKey) {
        next = navEl.firstElementChild;
        while (next && !pickable(next)) next = next.nextElementSibling;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectedElement = hoveredElement;
        state = 'CONFIGURING';
        showHighlight(selectedElement);
        clearAnnotations();
        showAnnotOverlay(selectedElement);
        showBar('configure');
        startScrollTracking();
        return;
      }
      if (next) {
        e.preventDefault();
        if (state === 'PICKING') {
          hoveredElement = next;
        } else {
          // CONFIGURING: re-select the new element and refresh the bar
          selectedElement = next;
          clearAnnotations();
          showAnnotOverlay(next);
          showBar('configure');
          startScrollTracking();
        }
        showHighlight(next);
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      return;
    }

    if (state === 'CYCLING') {
      if (e.key === 'ArrowLeft') { e.preventDefault(); cycleVariant(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); cycleVariant(1); }
      if (e.key === 'Enter') { e.preventDefault(); handleAccept(); }
    }
  }

  function handleGo() {
    if (!selectedElement || state !== 'CONFIGURING') return;
    const input = document.getElementById(PREFIX + '-input');
    const prompt = input ? input.value.trim() : '';

    // Commit any pending pin edit BEFORE we snapshot annotations.
    if (annotEditing) finalizeEditingPin();

    currentSessionId = id8();
    const direct = directMode;
    directSessionId = direct ? currentSessionId : null;
    expectedVariants = direct ? 1 : selectedCount;
    arrivedVariants = 0;
    visibleVariant = 0;

    // Flip to GENERATING immediately so the bar morphs without waiting on
    // capture + upload. The event is emitted from captureAndEmit() once the
    // screenshot is uploaded (or capture fails — we still emit, just without
    // screenshotPath).
    const elForCapture = selectedElement;
    const captureRect = elForCapture.getBoundingClientRect();
    const snapshot = {
      comments: annotState.comments.map(c => ({ x: c.x, y: c.y, text: c.text })),
      strokes: annotState.strokes.map(s => ({ points: s.points.map(p => [p[0], p[1]]) })),
    };
    const basePayload = {
      type: 'generate', id: currentSessionId,
      action: selectedAction,
      freeformPrompt: prompt || undefined,
      count: expectedVariants,
      mode: direct ? 'direct' : undefined,
      pageUrl: location.pathname,
      element: extractContext(elForCapture),
      ...currentChoice(),
    };
    if (snapshot.comments.length > 0) basePayload.comments = snapshot.comments;
    if (snapshot.strokes.length > 0) basePayload.strokes = snapshot.strokes;

    // Hide the interactive overlay so it doesn't linger during generation.
    hideAnnotOverlay();
    clearAnnotations();

    state = 'GENERATING';
    showBar('generating');
    showShaderOverlay(elForCapture, null, captureRect);
    if (direct) {
      // No wrapper will appear: the sweep runs until the agent's reply.
      captureAndEmit(elForCapture, basePayload, snapshot, captureRect);
      return;
    }
    saveSession();
    sendCheckpoint('generate_started');
    writeScrollY(window.scrollY);
    if (variantObserver) variantObserver.disconnect();
    variantObserver = startVariantObserver(currentSessionId);
    console.log('[ttui.scroll] Go pressed', { scrollY: window.scrollY, sessionId: currentSessionId });
    startScrollLock(currentSessionId);

    captureAndEmit(elForCapture, basePayload, snapshot, captureRect);
  }

  /** The agent finished a "Just do it" change: stop the sweep, say so, keep picking. */
  function finishDirect(message) {
    directSessionId = null;
    currentSessionId = null;
    selectedElement = null;
    hideShaderOverlay();
    hideHighlight();
    hideBar();
    state = 'PICKING';
    showToast(message ? 'Done: ' + message : 'Done', 4000);
  }

  // ---------------------------------------------------------------------------
  // Screenshot capture + upload
  // ---------------------------------------------------------------------------

  let msLoadPromise = null;
  function loadModernScreenshot() {
    if (window.modernScreenshot) return Promise.resolve(window.modernScreenshot);
    if (msLoadPromise) return msLoadPromise;
    msLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'http://localhost:' + PORT + '/modern-screenshot.js';
      s.onload = () => resolve(window.modernScreenshot);
      s.onerror = () => { msLoadPromise = null; reject(new Error('modern-screenshot failed to load')); };
      document.head.appendChild(s);
    });
    return msLoadPromise;
  }

  // Collect @font-face rules from every stylesheet on the page. Cross-origin
  // sheets (Google Fonts, Typekit, etc.) throw SecurityError on .cssRules
  // access, so modern-screenshot can't embed them on its own — the resulting
  // SVG falls back to system fonts and text re-wraps + renders with different
  // weight. We fetch the raw CSS text (CORS-permitted for these providers),
  // extract @font-face blocks, inline the referenced font files as base64
  // data URIs (SVGs rasterized via canvas can't fetch external resources,
  // so URLs inside the SVG silently fail without this), and pass the result
  // to modern-screenshot as font.cssText.
  const FONT_EXT_RE = /\.(woff2?|ttf|otf|eot)(\?.*)?$/i;
  const FONT_MIME = {
    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  };
  function bufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  async function inlineFontUrls(cssText) {
    const urlRe = /url\((['"]?)(https?:\/\/[^'")\s]+)\1\)/g;
    const urls = new Set();
    let m;
    while ((m = urlRe.exec(cssText))) {
      if (FONT_EXT_RE.test(m[2])) urls.add(m[2]);
    }
    const map = new Map();
    await Promise.all([...urls].map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const ext = url.toLowerCase().match(FONT_EXT_RE)?.[1] || 'woff2';
        const mime = FONT_MIME[ext] || 'application/octet-stream';
        map.set(url, 'data:' + mime + ';base64,' + bufferToBase64(buf));
      } catch { /* skip; fall through to URL */ }
    }));
    return cssText.replace(urlRe, (orig, q, url) => {
      const data = map.get(url);
      return data ? 'url(' + q + data + q + ')' : orig;
    });
  }
  async function collectFontCssText() {
    const chunks = [];
    const fontFaceRe = /@font-face\s*\{[^}]*\}/g;
    for (const sheet of document.styleSheets) {
      try {
        const rules = sheet.cssRules;
        for (const rule of rules) {
          if (rule.constructor.name === 'CSSFontFaceRule' || rule.cssText?.startsWith('@font-face')) {
            chunks.push(rule.cssText);
          }
        }
      } catch {
        if (!sheet.href) continue;
        try {
          const res = await fetch(sheet.href);
          if (!res.ok) continue;
          const text = await res.text();
          let m2;
          while ((m2 = fontFaceRe.exec(text))) chunks.push(m2[0]);
        } catch { /* ignore; capture is best-effort */ }
      }
    }
    if (chunks.length === 0) return '';
    return inlineFontUrls(chunks.join('\n'));
  }

  // True if `s` is a computed color string that renders as nothing
  // (explicit `transparent`, or `rgba(...)` with alpha 0).
  function isTransparentColor(s) {
    if (!s) return true;
    if (s === 'transparent') return true;
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return false;
    const parts = m[1].split(',').map((p) => p.trim());
    if (parts.length === 4) return parseFloat(parts[3]) === 0;
    return false;
  }

  // modern-screenshot force-sets `background-color: X !important` on the
  // cloned root whenever `backgroundColor` is passed, clobbering the
  // element's own background. So we only pass it when the element is
  // genuinely transparent (no own color, no own image) — in that case
  // we resolve up the DOM to the nearest opaque ancestor so the capture
  // sits on the page's real background instead of rendering black.
  function resolveCanvasBackground(el) {
    const own = getComputedStyle(el);
    if (!isTransparentColor(own.backgroundColor)) return null;
    if (own.backgroundImage && own.backgroundImage !== 'none') return null;
    let node = el.parentElement;
    while (node) {
      const cs = getComputedStyle(node);
      if (!isTransparentColor(cs.backgroundColor)) return cs.backgroundColor;
      // A gradient/image backdrop (e.g. a navy hero gradient) has a transparent
      // background-color; without this the capture lands on the light body
      // colour and white text disappears. Use the gradient's first colour stop.
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        const stop = cs.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i);
        if (stop && !isTransparentColor(stop[0])) return stop[0];
      }
      node = node.parentElement;
    }
    // The walk already passed through <body> and <html>; if they had been
    // opaque we would have returned. Falling through with the previous
    // `getComputedStyle(body).backgroundColor || …` chain is a trap: that
    // call returns the literal string `"rgba(0, 0, 0, 0)"` for a page that
    // never set its own bg, which is truthy and short-circuits the chain to
    // transparent-black — modern-screenshot then renders the capture on a
    // black canvas and the shader overlay flashes solid black during load.
    // The browser canvas defaults to white, so we do too.
    return '#ffffff';
  }

  // Capture the element (with current annotations baked in) and return a PNG
  // Blob. Shared between the Go flow (uploads it to the server) and the
  // debug toggle (displays it as an overlay for side-by-side comparison).
  async function captureElementToBlob(el, snapshot, rect) {
    try { if (document.fonts?.ready) await document.fonts.ready; } catch {}
    const hasAnnotations = snapshot && (snapshot.comments.length > 0 || snapshot.strokes.length > 0);
    let annotNode = null;
    let savedPosition = null;
    if (hasAnnotations) {
      const pos = getComputedStyle(el).position;
      if (pos === 'static') {
        savedPosition = el.style.position;
        el.style.position = 'relative';
      }
      annotNode = buildAnnotationsForCapture(rect, snapshot);
      el.appendChild(annotNode);
    }
    try {
      const ms = await loadModernScreenshot();
      const fontCssText = await collectFontCssText();
      const backgroundColor = resolveCanvasBackground(el);
      return await ms.domToBlob(el, {
        scale: Math.min(window.devicePixelRatio || 1, 2),
        font: fontCssText ? { cssText: fontCssText } : undefined,
        ...(backgroundColor ? { backgroundColor } : {}),
      });
    } finally {
      if (annotNode) annotNode.remove();
      if (savedPosition !== null) el.style.position = savedPosition;
    }
  }

  async function captureAndEmit(el, basePayload, snapshot, rect) {
    let screenshotPath;
    let blob;
    try {
      blob = await captureElementToBlob(el, snapshot, rect);
    } catch (err) {
      console.warn('[ttui] capture failed, proceeding without screenshot:', err);
    }
    // Light up the shader overlay the moment capture is ready — no reason to
    // wait for the upload to complete before the user sees something alive.
    if (blob && state === 'GENERATING') {
      showShaderOverlay(el, blob, rect);
    }
    // Only upload + forward the screenshot when annotations (comments/strokes)
    // are present. Without annotations the image is pure visual anchoring —
    // it biases the model toward the current rendering and works against the
    // three-distinct-directions brief.
    const hasAnnotations = snapshot && (snapshot.comments.length > 0 || snapshot.strokes.length > 0);
    if (blob && hasAnnotations) {
      try {
        const uploadRes = await fetch(
          'http://localhost:' + PORT + '/annotation?token=' + encodeURIComponent(TOKEN) +
          '&eventId=' + encodeURIComponent(basePayload.id),
          { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob },
        );
        if (uploadRes.ok) {
          const { path: p } = await uploadRes.json();
          screenshotPath = p;
        } else {
          console.warn('[ttui] annotation upload failed:', uploadRes.status);
        }
      } catch (err) {
        console.warn('[ttui] annotation upload failed:', err);
      }
    }
    sendEvent(screenshotPath ? { ...basePayload, screenshotPath } : basePayload);
  }

  // ---------------------------------------------------------------------------
  // Working overlay: a neon-green light sweeps around the edge of the picked
  // element while versions are being written. Pure CSS (conic gradient on a
  // masked ring), so it needs no screenshot and starts the instant Go is
  // pressed. Kept under the old shader* names so every call site still works.
  // ---------------------------------------------------------------------------

  let shaderState = null; // { canvas: overlay div, rafId: 0, gl: null }

  function ensureSweepStyle() {
    if (document.getElementById(PREFIX + '-sweep-style')) return;
    const s = document.createElement('style');
    s.id = PREFIX + '-sweep-style';
    s.textContent =
      '@property --ttui-sweep { syntax: "<angle>"; inherits: false; initial-value: 0deg; }' +
      '@keyframes ttui-sweep { to { --ttui-sweep: 360deg; } }' +
      '#' + PREFIX + '-shader {' +
      '  position: fixed; pointer-events: none; box-sizing: border-box; padding: 2px; border-radius: 10px;' +
      '  background: conic-gradient(from var(--ttui-sweep), transparent 0deg, rgb(0 229 160 / 0.15) 40deg, #00e5a0 90deg, #39ff88 130deg, #c6ff3d 165deg, transparent 200deg, transparent 360deg);' +
      '  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;' +
      '  animation: ttui-sweep 1.4s linear infinite;' +
      '}' +
      '@media (prefers-reduced-motion: reduce) { #' + PREFIX + '-shader { animation: none; background: linear-gradient(120deg, #00e5a0, #39ff88 50%, #c6ff3d); } }';
    document.head.appendChild(s);
  }

  function positionShaderOverlay() {
    if (!shaderState || !selectedElement) return;
    const r = selectedElement.getBoundingClientRect();
    Object.assign(shaderState.canvas.style, {
      top: (r.top - 4) + 'px', left: (r.left - 4) + 'px',
      width: (r.width + 8) + 'px', height: (r.height + 8) + 'px',
    });
  }

  function hideShaderOverlay() {
    if (!shaderState) return;
    if (shaderState.canvas) shaderState.canvas.remove();
    shaderState = null;
  }

  // `blob` is accepted for call-site compatibility; the sweep doesn't need it.
  function showShaderOverlay(el, _blob, rect) {
    if (!el) return;
    if (shaderState && shaderState.el === el) return; // already sweeping this element
    hideShaderOverlay();
    ensureSweepStyle();
    const r = rect || el.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.id = PREFIX + '-shader';
    Object.assign(ring.style, {
      top: (r.top - 4) + 'px', left: (r.left - 4) + 'px',
      width: (r.width + 8) + 'px', height: (r.height + 8) + 'px',
      zIndex: Z.bar - 1,
    });
    document.body.appendChild(ring);
    shaderState = { canvas: ring, el, gl: null, rafId: 0 };
  }

  function handleAccept() {
    if (!currentSessionId || arrivedVariants === 0) return;
    const domVisibleVariant = readVisibleVariantFromDOM(currentSessionId);
    if (domVisibleVariant > 0) visibleVariant = domVisibleVariant;
    if (visibleVariant === 0) { handleDiscard(); return; }
    const acceptPayload = { type: 'accept', id: currentSessionId, variantId: String(visibleVariant) };
    if (Object.keys(paramsCurrentValues).length > 0) {
      acceptPayload.paramValues = { ...paramsCurrentValues };
    }
    // The accepted variant is already the only visible child of the wrapper
    // (all other variants are display:none). HMR from the source rewrite will
    // replace the wrapper imminently. Don't eagerly replaceChild here — React
    // reconciliation races with our mutation and throws NotFoundError in Next
    // 16 / Turbopack. Schedule a fallback that runs the manual swap only if
    // HMR hasn't cleaned up by then (keeps static-server flows working).
    const acceptedSessionId = currentSessionId;
    const acceptedVariant = visibleVariant;

    state = 'SAVING';
    updateBarContent('saving');

    sendEvent(acceptPayload, { throwOnError: true })
      .then(() => {
        markSessionHandled();
        confirmAcceptAfterReceipt();
      })
      .catch(() => {
        state = 'CYCLING';
        updateBarContent('cycling');
        showToast('Could not confirm accept with the live server. Session kept for recovery; try Accept again.', 5000);
      });

    function confirmAcceptAfterReceipt() {
      state = 'CONFIRMED';
      updateBarContent('confirmed');
      scheduleAcceptCleanup();
    }

    function scheduleAcceptCleanup() {
      setTimeout(function() {
      hideBar();
      hideHighlight();
      stopScrollTracking();
      if (variantObserver) { variantObserver.disconnect(); variantObserver = null; }
      stopScrollLock();
      clearScrollY();
      clearSession();
      selectedElement = null;
      currentSessionId = null;
      selectedAction = 'ttui';
      state = 'PICKING';
    }, 1800);

    // Static-server / no-HMR fallback: if the wrapper is still around 2s after
    // the cleanup above, swap it out manually. By now React has either moved
    // on or the app isn't React at all. Preserve the `data-ttui-variant="N"`
    // div (with display:contents) so @scope rules anchored to the variant
    // attribute keep matching until reload replaces it with the carbonize block.
    setTimeout(function() {
      const wrapper = document.querySelector('[data-ttui-variants="' + acceptedSessionId + '"]');
      if (!wrapper) return;
      const accepted = wrapper.querySelector('[data-ttui-variant="' + acceptedVariant + '"]');
      if (accepted && accepted.firstElementChild) {
        const parent = wrapper.parentElement;
        if (!parent) return;
        accepted.style.display = 'contents';
        parent.replaceChild(accepted, wrapper);
      }
      }, 2000);
    }
  }

  function handleDiscard() {
    if (!currentSessionId) return;
    sendEvent({ type: 'discard', id: currentSessionId }, { throwOnError: true })
      .then(() => {
        markSessionHandled();
        cleanup();
      })
      .catch(() => showToast('Could not confirm discard with the live server. Session kept for recovery.', 5000));
  }

  // ---------------------------------------------------------------------------
  // Session persistence via live-browser-session.js
  // ---------------------------------------------------------------------------
  // Survives page reloads, browser close/reopen, HMR, and accidental refreshes.

  function saveSession() {
    if (!currentSessionId) return;
    // NOTE: scrollY is stored under a separate key (writeScrollY). Storing
    // it here would overwrite the Go-time value every time state changes.
    sessionState.saveSession({
      id: currentSessionId,
      state,
      action: selectedAction,
      count: selectedCount,
      expected: expectedVariants,
      arrived: arrivedVariants,
      visible: visibleVariant,
    });
  }

  function loadSession() {
    return sessionState.loadSession();
  }

  function clearSession() {
    sessionState.clearSession();
  }

  /** Mark session as handled (accepted/discarded). The agent will clean up
   *  the source, but until it does the wrapper is still in the HTML. This
   *  prevents resumeSession from picking it up again after reload. */
  function markSessionHandled() {
    if (!currentSessionId) return;
    sessionState.markHandled(currentSessionId);
    forgetOpen(currentSessionId);
  }

  function isSessionHandled(id) {
    return sessionState.isHandled(id);
  }

  function clearHandled() {
    sessionState.clearHandled();
  }

  // ---------------------------------------------------------------------------
  // Open versions (A/B/C): several components keep their versions at once.
  // Each one not being flipped through right now is "parked": it stays on the
  // version the user last looked at and wears a lime tag; clicking the tag (or
  // the component) brings its switcher back. Remembered per site in
  // localStorage, so tags and chosen versions survive page changes and reloads.
  // ---------------------------------------------------------------------------

  const OPEN_KEY = PREFIX + '-open';
  const SCOUT_WINDOW_MS = 10000;
  const OPEN_SYNC_MS = 600;
  const OPEN_PRUNE_MS = 10000; // how often to ask the helper which sets are still open
  const tagEls = new Map();    // session id -> tag element
  let openSyncTimer = null;
  let openPruneTimer = null;

  function loadOpen() {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch { return {}; }
  }
  function saveOpen(map) {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(map)); } catch { /* storage blocked */ }
  }
  function wrapperFor(id) {
    return document.querySelector('[data-ttui-variants="' + id + '"]');
  }
  function variantCount(wrapper) {
    return wrapper.querySelectorAll('[data-ttui-variant]:not([data-ttui-variant="original"])').length;
  }

  function rememberOpen(id, visible) {
    const open = loadOpen();
    const prev = open[id];
    const letter = prev?.letter || String.fromCharCode(65 + (Object.keys(open).length % 26));
    saveOpen({ ...open, [id]: { letter, page: prev?.page || location.pathname, visible } });
  }

  function forgetOpen(id) {
    const open = loadOpen();
    if (!open[id]) return;
    const { [id]: _gone, ...rest } = open;
    saveOpen(rest);
    tagEls.get(id)?.remove();
    tagEls.delete(id);
  }

  /** Show version `num` of a parked wrapper, only touching the DOM when it differs. */
  function applyVisible(wrapper, num) {
    const key = variantKey(num);
    for (const child of wrapper.children) {
      const v = child.dataset ? child.dataset.ttuiVariant : null;
      if (!v) continue;
      const want = v === key ? '' : 'none';
      if (child.style.display !== want) child.style.display = want;
    }
  }

  /** Stop flipping through the current versions but keep them on the page. */
  function parkCurrent() {
    if (state !== 'CYCLING' || !currentSessionId) return;
    rememberOpen(currentSessionId, visibleVariant);
    hideBar();
    hideHighlight();
    closeTunePopover();
    hideParamsPanel();
    stopScrollTracking();
    stopScrollLock();
    if (variantObserver) { variantObserver.disconnect(); variantObserver = null; }
    clearSession();
    currentSessionId = null;
    selectedElement = null;
    state = 'PICKING';
  }

  /** Bring a parked component's switcher back. */
  function focusSession(id) {
    const wrapper = wrapperFor(id);
    if (!wrapper || isSessionHandled(id)) return;
    if (state === 'CONFIGURING') { hideBar(); hideAnnotOverlay(); clearAnnotations(); }
    parkCurrent();
    if (state !== 'PICKING' && state !== 'CONFIGURING') return; // busy generating or saving
    const arrived = variantCount(wrapper);
    const saved = loadOpen()[id];
    currentSessionId = id;
    expectedVariants = parseInt(wrapper.dataset.ttuiVariantCount || String(arrived), 10);
    arrivedVariants = arrived;
    visibleVariant = saved && saved.visible >= 0 && saved.visible <= arrived ? saved.visible : Math.min(1, arrived);
    showVariantInDOM(id, visibleVariant);
    selectedElement = pickVariantContent(wrapper, visibleVariant) || wrapper.parentElement;
    tagEls.get(id)?.remove();
    tagEls.delete(id);
    state = 'CYCLING';
    showBar('cycling');
    startScrollTracking();
    refreshParamsPanel();
    saveSession();
  }

  function tagLabel(entry, wrapper) {
    const n = variantCount(wrapper);
    return entry.letter + ' · ' + (entry.visible > 0 ? entry.visible + '/' + n : 'Original');
  }

  function ensureTag(id, entry, wrapper) {
    let tag = tagEls.get(id);
    if (!tag) {
      tag = document.createElement('button');
      tag.id = PREFIX + '-tag-' + id;
      tag.type = 'button';
      tag.title = 'Show these versions';
      Object.assign(tag.style, {
        position: 'fixed', zIndex: String(Z.highlight + 1), padding: '3px 9px',
        borderRadius: '999px', border: '1px solid ' + C.ink, background: C.brand, color: C.ink,
        fontFamily: FONT, fontSize: '11px', fontWeight: '600', lineHeight: '16px',
        cursor: 'pointer', boxShadow: '0 2px 8px rgb(0 0 0 / 0.25)', whiteSpace: 'nowrap',
      });
      tag.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); focusSession(id); });
      document.body.appendChild(tag);
      tagEls.set(id, tag);
    }
    const text = tagLabel(entry, wrapper);
    if (tag.textContent !== text) tag.textContent = text;
    positionTag(tag, wrapper, entry.visible);
  }

  function positionTag(tag, wrapper, visible) {
    const content = pickVariantContent(wrapper, visible) || wrapper.parentElement;
    const r = content ? content.getBoundingClientRect() : null;
    if (!r || (r.width === 0 && r.height === 0)) { tag.style.display = 'none'; return; }
    tag.style.display = '';
    tag.style.top = Math.max(4, r.top - 12) + 'px';
    tag.style.left = Math.max(4, r.left) + 'px';
  }

  function positionTags() {
    const open = loadOpen();
    for (const [id, tag] of tagEls) {
      const wrapper = wrapperFor(id);
      if (wrapper && open[id]) positionTag(tag, wrapper, open[id].visible);
    }
  }

  /** Keep the page's wrappers, tags and remembered versions in step. */
  function syncOpen() {
    const open = loadOpen();
    const onPage = new Set();
    for (const wrapper of document.querySelectorAll('[data-ttui-variants]')) {
      const id = wrapper.dataset.ttuiVariants;
      if (!id || isSessionHandled(id) || variantCount(wrapper) === 0) continue;
      onPage.add(id);
      if (id === currentSessionId) continue;
      let entry = open[id];
      if (!entry) { rememberOpen(id, Math.min(1, variantCount(wrapper))); entry = loadOpen()[id]; }
      applyVisible(wrapper, entry.visible);
      ensureTag(id, entry, wrapper);
    }
    // The page changed under the set being flipped through: keep it for when the user comes back.
    if (state === 'CYCLING' && currentSessionId && !onPage.has(currentSessionId)) parkCurrent();
    for (const [id, tag] of tagEls) {
      if (!onPage.has(id) || id === currentSessionId) { tag.remove(); tagEls.delete(id); }
    }
  }

  /** Forget sets the helper says are finished (kept or discarded, maybe in another tab). */
  function pruneOpen() {
    if (Object.keys(loadOpen()).length === 0) return;
    fetch('http://localhost:' + PORT + '/status?token=' + TOKEN)
      .then((r) => (r.ok ? r.json() : null))
      .then((status) => {
        if (!status || !Array.isArray(status.activeSessions)) return;
        const active = new Set(status.activeSessions
          .filter((x) => x.phase !== 'completed' && x.phase !== 'discarded')
          .map((x) => x.id));
        for (const id of Object.keys(loadOpen())) if (!active.has(id)) forgetOpen(id);
      })
      .catch(() => { /* helper unreachable: keep everything */ });
  }

  function startOpenSync() {
    if (openSyncTimer) return;
    syncOpen();
    pruneOpen();
    openSyncTimer = setInterval(syncOpen, OPEN_SYNC_MS);
    openPruneTimer = setInterval(pruneOpen, OPEN_PRUNE_MS);
    window.addEventListener('scroll', positionTags, { passive: true, capture: true });
    window.addEventListener('resize', positionTags, { passive: true });
  }

  function stopOpenSync() {
    clearInterval(openSyncTimer);
    clearInterval(openPruneTimer);
    openSyncTimer = null;
    openPruneTimer = null;
    window.removeEventListener('scroll', positionTags, { capture: true });
    window.removeEventListener('resize', positionTags);
    for (const tag of tagEls.values()) tag.remove();
    tagEls.clear();
  }

  function cleanup() {
    // Hide the wrapper immediately so variants disappear. DON'T structurally
    // mutate the DOM yet — HMR from the agent's source rewrite is on its way,
    // and a manual replaceChild under React causes NotFoundError when the
    // reconciler later tries to remove a wrapper we already removed.
    // Schedule a 2s fallback that does the manual swap only if HMR hasn't
    // replaced the wrapper by then (keeps static-server / no-HMR flows alive).
    const cleanupSessionId = currentSessionId;
    if (cleanupSessionId) {
      const wrapper = document.querySelector('[data-ttui-variants="' + cleanupSessionId + '"]');
      if (wrapper) wrapper.style.display = 'none';
    }
    setTimeout(function() {
      if (!cleanupSessionId) return;
      const wrapper = document.querySelector('[data-ttui-variants="' + cleanupSessionId + '"]');
      if (!wrapper) return;
      const orig = wrapper.querySelector('[data-ttui-variant="original"]');
      if (orig) {
        const content = orig.firstElementChild;
        if (content) {
          wrapper.parentElement.replaceChild(content, wrapper);
          return;
        }
      }
      wrapper.remove();
    }, 2000);
    hideBar();
    hideHighlight();
    stopScrollTracking();
    if (variantObserver) { variantObserver.disconnect(); variantObserver = null; }
    stopScrollLock();
    clearScrollY();
    clearSession();
    selectedElement = null;
    currentSessionId = null;
    selectedAction = 'ttui';
    state = 'PICKING';
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  function showToast(message, duration) {
    if (toastEl) toastEl.remove();
    // Stack the toast above the global bar (which sits at bottom:14px) so
    // the two never overlap. Read the bar's actual rect — its height varies
    // with hover-expanded labels — and fall back to a sensible default
    // when the bar isn't mounted yet.
    const barRect = globalBarEl?.getBoundingClientRect();
    const barTopFromBottom = barRect && barRect.height > 0
      ? Math.max(16, window.innerHeight - barRect.top + 12)
      : 16;
    toastEl = el('div', {
      position: 'fixed', bottom: barTopFromBottom + 'px', left: '50%',
      transform: 'translateX(-50%) translateY(8px)',
      background: C.ink, color: C.white,
      fontFamily: FONT, fontSize: '12px',
      padding: '8px 16px', borderRadius: '8px',
      zIndex: Z.toast, opacity: '0',
      transition: 'opacity 0.25s ' + EASE + ', transform 0.25s ' + EASE,
      pointerEvents: 'none', maxWidth: '420px', textAlign: 'center',
    });
    toastEl.id = PREFIX + '-toast';
    toastEl.textContent = message;
    document.body.appendChild(toastEl);
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      if (toastEl) {
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translateX(-50%) translateY(8px)';
        setTimeout(() => { if (toastEl) { toastEl.remove(); toastEl = null; } }, 250);
      }
    }, duration);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  // Resume an active variant session after HMR/page reload.
  // If a [data-ttui-variants] wrapper exists in the DOM, the agent wrote
  // variants before HMR fired. Pick up where we left off.
  function resumeSession() {
    // Resume the set that was being worked on (saved as the current session);
    // otherwise only a set nobody parked. Parked sets just get their tags.
    const saved0 = loadSession();
    const open = loadOpen();
    const all = [...document.querySelectorAll('[data-ttui-variants]')];
    if (all.length === 0) {
      // Another page: keep the set being worked on for when the user returns.
      if (!(saved0 && open[saved0.id])) clearSession();
      clearHandled();
      return false;
    }
    const wrapper = (saved0 && all.find((w) => w.dataset.ttuiVariants === saved0.id))
      || all.find((w) => !open[w.dataset.ttuiVariants] && !isSessionHandled(w.dataset.ttuiVariants));
    if (!wrapper) return false;

    const sessionId = wrapper.dataset.ttuiVariants;

    // Don't resume if this session was already accepted/discarded
    if (isSessionHandled(sessionId)) return false;

    currentSessionId = sessionId;
    expectedVariants = parseInt(wrapper.dataset.ttuiVariantCount || '0');
    const variants = wrapper.querySelectorAll('[data-ttui-variant]:not([data-ttui-variant="original"])');
    arrivedVariants = variants.length;

    // Restore state from localStorage if available
    const saved = loadSession();
    if (saved && saved.id === sessionId) {
      visibleVariant = (saved.visible > 0 && saved.visible <= arrivedVariants) ? saved.visible : (arrivedVariants > 0 ? 1 : 0);
      if (saved.action) selectedAction = saved.action;
      if (saved.count) selectedCount = saved.count;
    } else {
      visibleVariant = arrivedVariants > 0 ? 1 : 0;
    }

    // Find the visible variant's content element for highlight positioning.
    // Try the visible variant first, fall back to the original's content.
    const visEl = visibleVariant > 0 ? pickVariantContent(wrapper, visibleVariant) : null;
    const origEl = pickVariantContent(wrapper, 'original');
    selectedElement = visEl || origEl || wrapper.parentElement;

    // Set display state BEFORE starting observer (avoid triggering it)
    if (visibleVariant > 0) showVariantInDOM(currentSessionId, visibleVariant);

    state = arrivedVariants >= expectedVariants ? 'CYCLING' : 'GENERATING';
    showBar(state === 'CYCLING' ? 'cycling' : 'generating');
    startScrollTracking();
    // Build the params panel for the restored visible variant. Previously
    // this was missed on page-reload resume: showVariantInDOM above fires
    // refreshParamsPanel, but state was still IDLE at that moment so it
    // hid. Now that state is CYCLING, re-fire.
    if (state === 'CYCLING') refreshParamsPanel();
    saveSession();
    queueCheckpoint('browser_resumed');

    // Start observing for more variants AFTER initial setup
    if (variantObserver) variantObserver.disconnect();
    variantObserver = startVariantObserver(currentSessionId);

    // Hold the target at its saved viewport top through any subsequent
    // HMR patches, variant inserts, or cycle swaps.
    startScrollLock(currentSessionId, readScrollY());

    // If we reloaded mid-generation (Bun's HTML HMR destroys the shader
    // canvas), re-capture the original's content and restart the shader so
    // the wait doesn't go dead.
    if (state === 'GENERATING' && origEl) {
      (async () => {
        try {
          const rect = origEl.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const blob = await captureElementToBlob(origEl, null, rect);
          if (blob && state === 'GENERATING') {
            showShaderOverlay(origEl, blob, rect);
          }
        } catch (err) {
          console.warn('[ttui] shader resume failed:', err);
        }
      })();
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Global bar (always visible at bottom): Signal design
  // Pick (Auto / Draw) · Variants ×1-5 · Design · model + reasoning · exit
  // ---------------------------------------------------------------------------

  let globalBarEl = null;
  let pickActive = true;
  const PREFS_KEY = 'ttui-live-prefs';
  const EFFORT_LABELS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
  const DEFAULT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const MODELS = (window.__TTUI_MODELS__ && Array.isArray(window.__TTUI_MODELS__.models) && window.__TTUI_MODELS__.models.length)
    ? window.__TTUI_MODELS__ : null;

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
  }
  const prefs = loadPrefs();
  // Picking is always on unless the user explicitly chooses Off in the Pick
  // menu (to click around the page normally). Off is never remembered: every
  // page load starts picking again, in the last on-mode used.
  let pickMode = prefs.pickMode === 'draw' ? 'draw' : 'auto';
  let lastOnMode = pickMode;
  if (Number.isInteger(prefs.count) && prefs.count >= 1 && prefs.count <= 5) selectedCount = prefs.count;
  directMode = prefs.direct === true;

  function modelById(id) { return MODELS ? MODELS.models.find((m) => m.id === id) || null : null; }
  function effortsFor(id) {
    const list = modelById(id)?.efforts;
    return Array.isArray(list) && list.length ? list : DEFAULT_EFFORTS;
  }
  function defaultEffortFor(id) {
    const list = effortsFor(id);
    return list.includes('high') ? 'high' : list[Math.floor(list.length / 2)];
  }
  let currentModelId = MODELS ? (modelById(prefs.model) ? prefs.model : MODELS.models[0].id) : null;
  let currentEffort = effortsFor(currentModelId).includes(prefs.effort) ? prefs.effort : defaultEffortFor(currentModelId);

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        pickMode: lastOnMode, count: selectedCount, direct: directMode, model: currentModelId, effort: currentEffort,
      }));
    } catch { /* storage blocked: prefs just don't persist */ }
  }

  /** Model + reasoning level to attach to a generate event ({} when no list was provided). */
  function currentChoice() {
    return MODELS ? { model: currentModelId, effort: currentEffort } : {};
  }

  function choiceLabel() {
    if (!MODELS) return '';
    return (modelById(currentModelId)?.label || currentModelId) + ' · ' + (EFFORT_LABELS[currentEffort] || currentEffort);
  }

  // Page theme probe. Still used by the contextual bar and panels to decide
  // light/dark details; the Signal palette itself is the same everywhere.
  function detectPageTheme() {
    try {
      const override = localStorage.getItem('ttui-dev-theme');
      if (override === 'light' || override === 'dark') return override;
      function readOpaque(el) {
        if (!el) return null;
        const bg = getComputedStyle(el).backgroundColor;
        const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
        if (!m) return null;
        const alpha = m[4] == null ? 1 : parseFloat(m[4]);
        if (alpha < 0.5) return null;
        return [+m[1], +m[2], +m[3]];
      }
      const rgb = readOpaque(document.body) || readOpaque(document.documentElement);
      if (!rgb) return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      const [r, g, b] = rgb;
      const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return L > 0.55 ? 'light' : 'dark';
    } catch { return 'light'; }
  }

  function barPaletteForTheme(_theme) {
    // Signal: near-black capsule, lime accent. Same on light and dark pages;
    // the lime ring on hover/active keeps it legible against dark sites.
    return {
      surface: 'rgb(13 15 12 / 0.97)',
      surfaceDeep: '#151912',
      hairline: '#2b3326',
      text: '#e9f5d6',
      textDim: '#8a9480',
      accent: '#c6ff3d',
      accentSoft: 'rgb(198 255 61 / 0.16)',
      mark: '#c6ff3d',
      markText: '#0d0f0c',
      exitHover: '#1d221a',
    };
  }

  // Styles live in one id-scoped sheet so host-page CSS (button resets,
  // `input[type=range]` rules, hover states) can't out-rank them.
  // Motion: the bar collapses to just the mark and opens on hover/focus.
  // Widths animate via grid 0fr -> 1fr, which tracks the real content width,
  // so expand and collapse both feel immediate (no max-width guesswork).
  function ensureBarStyles() {
    if (document.getElementById(PREFIX + '-gb-style')) return;
    const font = document.createElement('link');
    font.id = PREFIX + '-gb-font';
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap';
    document.head.appendChild(font);

    const G = '#' + PREFIX + '-global-bar';
    const k = (n) => '.' + PREFIX + '-gb-' + n;
    const c = (n) => G + ' ' + k(n);
    const OPEN = [G + ':hover', G + ':focus-within', G + k('isopen')];
    const whenOpen = (sel) => OPEN.map((o) => o + ' ' + sel).join(',');
    const LABEL_ON = [':hover', ':focus-visible', '[aria-expanded="true"]', '[data-active="true"]']
      .map((st) => c('btn') + st + ' ' + k('lw')).join(',');
    const LABEL_ON_TEXT = [':hover', ':focus-visible', '[aria-expanded="true"]', '[data-active="true"]']
      .map((st) => c('btn') + st + ' ' + k('lw') + ' > span').join(',');
    const s = document.createElement('style');
    s.id = PREFIX + '-gb-style';
    s.textContent = [
      G + '{position:fixed;bottom:16px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;z-index:' + (Z.bar + 5) + ';display:flex;align-items:center;padding:6px;background:rgb(13 15 12 / 0.97);border-radius:24px;box-shadow:0 0 0 1px #2b3326,0 14px 30px rgb(0 0 0 / 0.45);font-family:' + FONT + ';font-size:13px;line-height:1;color:#e9f5d6;-webkit-font-smoothing:antialiased;transition:opacity .3s ' + EASE + ',transform .3s ' + EASE + ';}',
      G + ',' + G + ' *{box-sizing:border-box;}',
      ':where(' + G + ') button{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-family:inherit;-webkit-tap-highlight-color:transparent;}',
      G + ' button:focus-visible{outline:2px solid #c6ff3d;outline-offset:1px;}',
      // Mark (always visible; the whole bar collapses to this)
      c('mark') + '{flex:none;width:36px;height:36px;border-radius:13px;background:#c6ff3d;color:#0d0f0c;display:inline-flex;align-items:center;justify-content:center;transition:transform .35s ' + EASE + ';}',
      c('mark') + ' svg{display:block;}',
      whenOpen(k('mark')) + '{transform:rotate(-8deg) scale(1.05);}',
      // Collapsible track
      c('items') + '{display:grid;grid-template-columns:0fr;transition:grid-template-columns .2s ' + EASE + ' .1s;}',
      whenOpen(k('items')) + '{grid-template-columns:1fr;transition-duration:.24s;transition-delay:0s;}',
      c('track') + '{min-width:0;overflow:clip;overflow-clip-margin:6px;display:flex;align-items:center;gap:4px;opacity:0;transition:opacity .12s ease .06s;}',
      whenOpen(k('track')) + '{opacity:1;transition:opacity .18s ease .03s;}',
      c('track') + ' > :first-child{margin-left:6px;}',
      // Buttons: icon always, label slides out on hover / when active / when its menu is open
      c('btn') + '{flex:none;height:36px;padding:0 10px;border-radius:13px;color:#8a9480;font-weight:600;font-size:13px;white-space:nowrap;transition:background .18s ease,color .18s ease,transform .25s ' + EASE + ';}',
      c('btn') + ':hover{background:#1d221a;color:#e9f5d6;transform:translateY(-2px);}',
      c('btn') + '[data-active="true"]{background:#c6ff3d;color:#0d0f0c;}',
      c('btn') + '[data-active="true"]:hover{background:#d4ff66;}',
      c('btn') + ' svg{display:block;flex:none;width:16px;height:16px;}',
      c('lw') + '{display:grid;grid-template-columns:0fr;margin-left:0;transition:grid-template-columns .2s ' + EASE + ',margin-left .2s ' + EASE + ';}',
      c('lw') + ' > span{min-width:0;overflow:hidden;white-space:nowrap;opacity:0;transition:opacity .12s ease;}',
      LABEL_ON + '{grid-template-columns:1fr;margin-left:6px;}',
      LABEL_ON_TEXT + '{opacity:1;transition:opacity .18s ease .05s;}',
      c('sub') + '{color:#c6ff3d;margin-left:5px;font-weight:700;}',
      c('btn') + '[data-active="true"] ' + k('sub') + '{color:#0d0f0c;}',
      c('mini') + '{display:inline-flex;gap:2px;margin-left:6px;vertical-align:-1px;}',
      c('mini') + ' i{display:block;width:3px;height:10px;border-radius:2px;background:#3a4234;}',
      c('mini') + ' i.on{background:#c6ff3d;}',
      c('div') + '{flex:none;width:1px;height:20px;background:#2b3326;margin:0 2px;}',
      c('exit') + '{flex:none;width:32px;height:36px;border-radius:12px;color:#8a9480;transition:background .15s ease,color .15s ease;}',
      c('exit') + ':hover{background:#1d221a;color:#e9f5d6;}',
      c('exit') + ' svg{display:block;}',
      // Drop-ups
      c('pop') + '{position:absolute;bottom:calc(100% + 10px);padding:6px;background:#0d0f0c;border-radius:16px;box-shadow:0 0 0 1px #2b3326,0 16px 32px rgb(0 0 0 / .5);display:flex;flex-direction:column;gap:2px;min-width:200px;opacity:0;visibility:hidden;transform:translateY(6px) scale(.98);transform-origin:bottom left;pointer-events:none;transition:opacity .14s ease,transform .2s ' + EASE + ',visibility 0s linear .2s;}',
      c('pop') + '[data-align="right"]{transform-origin:bottom right;}',
      c('pop') + '.open{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:opacity .16s ease,transform .22s ' + EASE + ',visibility 0s;}',
      c('pop') + '::after{content:"";position:absolute;left:0;right:0;top:100%;height:12px;}',
      c('pophead') + '{padding:6px 10px 4px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8a9480;}',
      c('opt') + '{justify-content:space-between;gap:14px;padding:9px 10px;border-radius:10px;color:#e9f5d6;font-weight:600;font-size:13px;white-space:nowrap;transition:background .12s ease;}',
      c('opt') + ':hover{background:#1d221a;}',
      c('opt') + '.sel{background:#c6ff3d;color:#0d0f0c;}',
      c('opt') + ' small{font-weight:500;font-size:11px;color:#8a9480;}',
      c('opt') + '.sel small{color:#3a4234;}',
      c('row') + '{display:flex;gap:4px;padding:2px;}',
      c('row') + ' ' + k('opt') + '{width:40px;height:34px;justify-content:center;padding:0;}',
      // Reasoning slider (inside the model drop-up)
      c('sep') + '{height:1px;background:#2b3326;margin:6px 4px;}',
      c('rhead') + '{display:flex;justify-content:space-between;align-items:baseline;padding:4px 10px 0;}',
      c('rval') + '{font-size:13px;font-weight:700;color:#c6ff3d;}',
      c('rwrap') + '{position:relative;margin:16px 10px 2px;--p:0.5;}',
      c('range') + '{-webkit-appearance:none;appearance:none;display:block;width:100%;height:24px;margin:0;padding:0;background:transparent;cursor:pointer;touch-action:none;}',
      c('range') + ':focus{outline:none;}',
      c('range') + '::-webkit-slider-runnable-track{height:8px;border-radius:999px;background:linear-gradient(90deg,#c6ff3d 0 calc(5px + (100% - 10px) * var(--p)),#2b3326 0);}',
      c('range') + '::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:24px;margin-top:-8px;border-radius:999px;background:#c6ff3d;border:3px solid #0d0f0c;box-shadow:none;transition:transform .15s ' + EASE + ',box-shadow .15s ease;}',
      c('range') + ':hover::-webkit-slider-thumb{transform:scaleY(1.08);}',
      c('range') + ':active::-webkit-slider-thumb{transform:scale(1.12);}',
      c('range') + ':focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px rgb(198 255 61 / .35);}',
      c('range') + '::-moz-range-track{height:8px;border-radius:999px;background:#2b3326;}',
      c('range') + '::-moz-range-progress{height:8px;border-radius:999px;background:#c6ff3d;}',
      c('range') + '::-moz-range-thumb{width:4px;height:18px;border-radius:999px;background:#c6ff3d;border:3px solid #0d0f0c;}',
      c('bubble') + '{position:absolute;bottom:calc(100% + 4px);left:calc(5px + (100% - 10px) * var(--p));padding:4px 8px;border-radius:8px;background:#c6ff3d;color:#0d0f0c;font-size:11px;font-weight:700;white-space:nowrap;pointer-events:none;opacity:0;transform:translateX(-50%) translateY(4px) scale(.9);transition:opacity .14s ease,transform .18s ' + EASE + ',left .12s ' + EASE + ';}',
      c('bubble') + '::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:4px solid transparent;border-top-color:#c6ff3d;}',
      c('rwrap') + ':hover ' + k('bubble') + ',' + c('rwrap') + ':focus-within ' + k('bubble') + ',' + c('rwrap') + k('dragging') + ' ' + k('bubble') + '{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}',
      c('ticks') + '{position:relative;height:16px;margin:2px 10px 4px;}',
      c('ticks') + ' span{position:absolute;top:2px;transform:translateX(-50%);font-size:10px;font-weight:600;color:#5f6a57;white-space:nowrap;transition:color .15s ease;}',
      c('ticks') + ' span.on{color:#e9f5d6;}',
      'html.' + PREFIX + '-drawing, html.' + PREFIX + '-drawing *{cursor:crosshair !important;}',
      '@media (prefers-reduced-motion: reduce){' + G + ',' + G + ' *,' + G + ' *::after{transition:none !important;}}',
    ].join('\n');
    document.head.appendChild(s);
  }

  const GB_ICONS = {
    mark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10H9l-5 4z"/><path d="M9 10h.01M13 10h.01"/></svg>',
    pick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 7-6 2-2 6z"/></svg>',
    draw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20c-5 0-9-2.5-9-6.5S7 5 12 5s9 3 9 7-3 5-6 5c-2 0-3-1-3-2.5"/></svg>',
    variants: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    design: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M10 2v4M14 2v4M10 18v4M14 18v4M2 10h4M2 14h4M18 10h4M18 14h4"/></svg>',
    exit: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/></svg>',
  };
  const EFFORT_TICKS = { low: 'Low', medium: 'Med', high: 'High', xhigh: 'X-High', max: 'Max', ultra: 'Ultra' };

  function gbEl(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls.split(' ').map((x) => PREFIX + '-gb-' + x).join(' ');
    if (html != null) n.innerHTML = html;
    return n;
  }

  // A bar button: icon + a label that slides out. `label` may contain a sub span.
  function gbButton(id, icon, labelHtml, ariaLabel) {
    const b = gbEl('button', 'btn');
    b.id = PREFIX + '-' + id;
    b.setAttribute('aria-label', ariaLabel);
    b.innerHTML = '<span class="' + PREFIX + '-gb-icon">' + icon + '</span>' +
      '<span class="' + PREFIX + '-gb-lw"><span>' + labelHtml + '</span></span>';
    return b;
  }

  // Drop-ups: one open at a time. Hovering an anchor opens its menu (after a
  // 70 ms dwell so sweeping across the bar doesn't flash menus); hovering a
  // plain button, leaving the bar, clicking outside, or Escape closes it.
  // While a menu is open the bar stays expanded (.isopen).
  let openPop = null;
  let popOpenTimer = null;
  let popCloseTimer = null;
  let sliderDragging = false;
  function setPop(pop, anchor) {
    clearTimeout(popCloseTimer);
    clearTimeout(popOpenTimer);
    if (openPop === pop) return;
    if (openPop) { openPop.classList.remove('open'); openPop._anchor?.setAttribute('aria-expanded', 'false'); }
    openPop = pop;
    pop._anchor = anchor;
    if (pop.dataset.align === 'right') { pop.style.right = '0px'; pop.style.left = 'auto'; }
    else pop.style.left = Math.max(0, anchor.offsetLeft - 6) + 'px';
    pop.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    globalBarEl.classList.add(PREFIX + '-gb-isopen');
  }
  function closePop() {
    clearTimeout(popOpenTimer);
    if (!openPop || sliderDragging) return;
    openPop.classList.remove('open');
    openPop._anchor?.setAttribute('aria-expanded', 'false');
    openPop = null;
    globalBarEl?.classList.remove(PREFIX + '-gb-isopen');
  }
  function scheduleClosePop(ms) { clearTimeout(popCloseTimer); popCloseTimer = setTimeout(closePop, ms); }
  function hoverAnchor(anchor, pop) {
    anchor.addEventListener('mouseenter', () => {
      clearTimeout(popCloseTimer);
      clearTimeout(popOpenTimer);
      popOpenTimer = setTimeout(() => setPop(pop, anchor), openPop ? 0 : 70);
    });
    anchor.addEventListener('mouseleave', () => clearTimeout(popOpenTimer));
    pop.addEventListener('mouseenter', () => clearTimeout(popCloseTimer));
  }
  function onPopOutside(e) { if (openPop && globalBarEl && !globalBarEl.contains(e.target)) closePop(); }
  function onPopEscape(e) {
    if (e.key !== 'Escape' || !openPop) return;
    e.__ttuiHandled = true;
    closePop();
    e.preventDefault();
  }

  function initGlobalBar() {
    ensureBarStyles();
    globalBarEl = document.createElement('div');
    globalBarEl.id = PREFIX + '-global-bar';
    globalBarEl.dataset.theme = detectPageTheme();
    globalBarEl.setAttribute('role', 'toolbar');
    globalBarEl.setAttribute('aria-label', 'Talk-to-UI');

    const mark = gbEl('span', 'mark', GB_ICONS.mark);
    mark.title = 'Talk-to-UI';
    const items = gbEl('div', 'items');
    const track = gbEl('div', 'track');
    items.appendChild(track);
    globalBarEl.append(mark, items);

    // --- Pick: click toggles picking; hover opens Auto / Draw ---
    const pickBtn = gbButton('pick-toggle', GB_ICONS.pick, 'Pick<span class="' + PREFIX + '-gb-sub"></span>', 'Pick element');
    pickBtn.setAttribute('aria-haspopup', 'true');
    pickBtn.addEventListener('click', () => (openPop === pickPop ? closePop() : setPop(pickPop, pickBtn)));
    const pickPop = gbEl('div', 'pop');
    pickPop.innerHTML = '<div class="' + PREFIX + '-gb-pophead">How to pick</div>';
    [['auto', 'Auto', 'outline on hover'], ['draw', 'Draw', 'circle anything'], ['off', 'Off', 'use the page normally']].forEach(([mode, name, hint]) => {
      const o = gbEl('button', 'opt', '<span>' + name + '</span><small>' + hint + '</small>');
      o.dataset.mode = mode;
      o.addEventListener('click', () => { setPickMode(mode); closePop(); });
      pickPop.appendChild(o);
    });
    hoverAnchor(pickBtn, pickPop);
    track.appendChild(pickBtn);

    // --- Variants ×1-5 ---
    const varBtn = gbButton('variants-toggle', GB_ICONS.variants, 'Variants<span class="' + PREFIX + '-gb-sub" id="' + PREFIX + '-variants-n"></span>', 'Number of versions');
    varBtn.setAttribute('aria-haspopup', 'true');
    const varPop = gbEl('div', 'pop');
    const doIt = gbEl('button', 'opt', '<span>Just do it</span><small>one change, any file</small>');
    doIt.dataset.direct = 'true';
    doIt.addEventListener('click', () => { directMode = true; savePrefs(); renderGlobalBar(); closePop(); });
    varPop.appendChild(doIt);
    varPop.appendChild(gbEl('div', 'sep'));
    varPop.appendChild(gbEl('div', 'pophead', 'How many versions?'));
    const varRow = gbEl('div', 'row');
    for (let n = 1; n <= 5; n++) {
      const o = gbEl('button', 'opt', '×' + n);
      o.dataset.n = String(n);
      o.addEventListener('click', () => { directMode = false; selectedCount = n; savePrefs(); renderGlobalBar(); closePop(); });
      varRow.appendChild(o);
    }
    varPop.appendChild(varRow);
    varBtn.addEventListener('click', () => (openPop === varPop ? closePop() : setPop(varPop, varBtn)));
    hoverAnchor(varBtn, varPop);
    track.appendChild(varBtn);

    // --- DESIGN.md panel (no menu: hovering it closes any open one) ---
    const designBtn = gbButton('design-toggle', GB_ICONS.design, 'Design', 'Toggle DESIGN.md panel');
    designBtn.addEventListener('click', () => { closePop(); toggleDesignPanel(); });
    designBtn.addEventListener('mouseenter', () => scheduleClosePop(120));
    track.appendChild(designBtn);

    const pops = [pickPop, varPop];

    // --- Model + reasoning slider (only when setup supplied a model list) ---
    if (MODELS) {
      track.appendChild(gbEl('span', 'div'));
      const modelBtn = gbButton('model-toggle', GB_ICONS.model, '<span id="' + PREFIX + '-model-name"></span><span class="' + PREFIX + '-gb-mini" id="' + PREFIX + '-model-mini"></span>', 'Model and reasoning');
      modelBtn.setAttribute('aria-haspopup', 'true');
      const mPop = gbEl('div', 'pop');
      mPop.dataset.align = 'right';
      mPop.style.minWidth = '260px';
      mPop.innerHTML = '<div class="' + PREFIX + '-gb-pophead">' + (MODELS.provider ? MODELS.provider + ' models' : 'Models') + '</div>';
      MODELS.models.forEach((m) => {
        const hint = !MODELS.terminal ? '' : m.id === MODELS.terminal ? 'in your terminal · fastest' : '+~10 s to start';
        const o = gbEl('button', 'opt', '<span>' + m.label + '</span>' + (hint ? '<small>' + hint + '</small>' : ''));
        o.dataset.model = m.id;
        o.addEventListener('click', () => {
          currentModelId = m.id;
          if (!effortsFor(m.id).includes(currentEffort)) currentEffort = defaultEffortFor(m.id);
          savePrefs(); renderGlobalBar();
        });
        mPop.appendChild(o);
      });
      mPop.appendChild(gbEl('div', 'sep'));
      mPop.appendChild(gbEl('div', 'rhead',
        '<span class="' + PREFIX + '-gb-pophead" style="padding:0">Reasoning</span><span class="' + PREFIX + '-gb-rval" id="' + PREFIX + '-effort-val"></span>'));
      const range = document.createElement('input');
      range.type = 'range';
      range.className = PREFIX + '-gb-range';
      range.id = PREFIX + '-effort-range';
      range.min = '0';
      range.step = '1';
      range.setAttribute('aria-label', 'Reasoning level');
      range.addEventListener('input', () => {
        currentEffort = effortsFor(currentModelId)[+range.value];
        renderGlobalBar();
      });
      range.addEventListener('change', savePrefs);
      range.addEventListener('pointerdown', () => {
        sliderDragging = true;
        range.parentElement.classList.add(PREFIX + '-gb-dragging');
        window.addEventListener('pointerup', () => {
          sliderDragging = false;
          range.parentElement.classList.remove(PREFIX + '-gb-dragging');
          if (!globalBarEl.matches(':hover')) scheduleClosePop(250);
        }, { once: true });
      });
      const rwrap = gbEl('div', 'rwrap');
      rwrap.id = PREFIX + '-effort-wrap';
      const bubble = gbEl('span', 'bubble');
      bubble.id = PREFIX + '-effort-bubble';
      rwrap.append(bubble, range);
      mPop.appendChild(rwrap);
      const ticks = gbEl('div', 'ticks');
      ticks.id = PREFIX + '-effort-ticks';
      mPop.appendChild(ticks);
      modelBtn.addEventListener('click', () => (openPop === mPop ? closePop() : setPop(mPop, modelBtn)));
      hoverAnchor(modelBtn, mPop);
      track.appendChild(modelBtn);
      pops.push(mPop);
    }

    track.appendChild(gbEl('span', 'div'));
    const exitBtn = gbEl('button', 'exit', GB_ICONS.exit);
    exitBtn.title = 'Exit live mode';
    exitBtn.setAttribute('aria-label', 'Exit live mode');
    exitBtn.addEventListener('mouseenter', () => scheduleClosePop(120));
    exitBtn.addEventListener('click', () => { sendEvent({ type: 'exit' }); teardown(); });
    track.appendChild(exitBtn);

    globalBarEl.append(...pops);
    globalBarEl.addEventListener('mouseleave', () => scheduleClosePop(250));
    globalBarEl.addEventListener('mouseenter', () => clearTimeout(popCloseTimer));
    document.addEventListener('pointerdown', onPopOutside, true);
    document.addEventListener('keydown', onPopEscape, true);
    document.addEventListener('pointerdown', onDrawDown, true);

    document.body.appendChild(globalBarEl);
    defangOutsideHandlers(globalBarEl);
    renderGlobalBar();
    requestAnimationFrame(() => {
      globalBarEl.style.opacity = '1';
      globalBarEl.style.transform = 'translateX(-50%) translateY(0)';
    });
  }

  /** Refresh every label/selection in the bar from current state. */
  function renderGlobalBar() {
    if (!globalBarEl) return;
    const byId = (id) => document.getElementById(PREFIX + '-' + id);
    const pickBtn = byId('pick-toggle');
    if (pickBtn) {
      pickBtn.querySelector('.' + PREFIX + '-gb-icon').innerHTML = pickMode === 'draw' ? GB_ICONS.draw : GB_ICONS.pick;
      pickBtn.querySelector('.' + PREFIX + '-gb-sub').textContent = { auto: 'Auto', draw: 'Draw', off: 'Off' }[pickMode];
    }
    globalBarEl.querySelectorAll('[data-mode]').forEach((o) => o.classList.toggle('sel', o.dataset.mode === pickMode));
    const n = byId('variants-n');
    if (n) n.textContent = directMode ? 'Just do it' : '×' + selectedCount;
    globalBarEl.querySelectorAll('[data-n]').forEach((o) => o.classList.toggle('sel', !directMode && +o.dataset.n === selectedCount));
    globalBarEl.querySelectorAll('[data-direct]').forEach((o) => o.classList.toggle('sel', directMode));
    const go = byId('go');
    if (go) go.textContent = (directMode ? 'Do it' : 'Go') + ' →';
    if (MODELS) {
      const m = modelById(currentModelId);
      const list = effortsFor(currentModelId);
      const idx = Math.max(0, list.indexOf(currentEffort));
      byId('model-name').textContent = m ? m.label : currentModelId;
      byId('model-mini').innerHTML = list.map((_, i) => '<i class="' + (i <= idx ? 'on' : '') + '"></i>').join('');
      globalBarEl.querySelectorAll('[data-model]').forEach((o) => o.classList.toggle('sel', o.dataset.model === currentModelId));
      byId('effort-val').textContent = EFFORT_LABELS[currentEffort] || currentEffort;
      const range = byId('effort-range');
      const max = Math.max(1, list.length - 1);
      range.max = String(list.length - 1);
      range.value = String(idx);
      byId('effort-wrap').style.setProperty('--p', String(idx / max));
      byId('effort-bubble').textContent = EFFORT_LABELS[currentEffort] || currentEffort;
      range.setAttribute('aria-valuetext', EFFORT_LABELS[currentEffort] || currentEffort);
      const ticks = byId('effort-ticks');
      ticks.innerHTML = list.map((e, i) =>
        '<span class="' + (i === idx ? 'on' : '') + '" style="left:calc(5px + (100% - 10px) * ' + (i / max) + ')">' + (EFFORT_TICKS[e] || e) + '</span>').join('');
    }
    updateGlobalBarState();
  }

  function updateGlobalBarState() {
    const sync = (btn, active) => { if (btn) btn.dataset.active = active ? 'true' : 'false'; };
    sync(document.getElementById(PREFIX + '-pick-toggle'), pickActive);
    sync(document.getElementById(PREFIX + '-design-toggle'), designState.open);
    document.documentElement.classList.toggle(PREFIX + '-drawing', pickActive && pickMode === 'draw' && state === 'PICKING');
  }

  function setPickMode(mode) {
    pickMode = mode === 'draw' || mode === 'off' ? mode : 'auto';
    hoveredElement = null;
    hideHighlight();
    if (pickMode === 'off') {
      pickActive = false;
      // Turning picking off drops any half-made selection so nothing stale
      // stays on screen. Versions already being written/flipped are untouched.
      if (state === 'CONFIGURING') { hideBar(); stopScrollTracking(); hideAnnotOverlay(); clearAnnotations(); selectedElement = null; }
      if (state === 'PICKING' || state === 'CONFIGURING') state = 'IDLE';
    } else {
      pickActive = true;
      lastOnMode = pickMode;
      if (state === 'IDLE') state = 'PICKING';
    }
    savePrefs();
    renderGlobalBar();
  }


  // ---------------------------------------------------------------------------
  // Draw-to-pick: circle anything on the page. The smallest element that
  // contains the drawing becomes the selection, and the stroke is carried as
  // an annotation, so the agent gets the screenshot with the circle baked in,
  // the stroke coordinates, the element's code context, and the page URL.
  // ---------------------------------------------------------------------------

  let drawPad = null;          // { svg, path, points }
  let suppressClickUntil = 0;  // swallow the click that follows a drawing

  function drawModeLive() { return pickActive && pickMode === 'draw' && state === 'PICKING'; }

  function onDrawDown(e) {
    if (!drawModeLive() || e.button !== 0 || own(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = PREFIX + '-drawpad';
    Object.assign(svg.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      zIndex: String(Z.highlight + 3), cursor: 'crosshair', touchAction: 'none',
    });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke', C.brand);
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
    document.body.appendChild(svg);
    drawPad = { svg, path, points: [[e.clientX, e.clientY]] };
    try { svg.setPointerCapture(e.pointerId); } catch {}
    svg.addEventListener('pointermove', onDrawMove);
    svg.addEventListener('pointerup', onDrawUp);
    svg.addEventListener('pointercancel', onDrawUp);
  }

  function onDrawMove(e) {
    if (!drawPad) return;
    drawPad.points.push([e.clientX, e.clientY]);
    drawPad.path.setAttribute('d', pointsToPath(drawPad.points));
  }

  function onDrawUp(e) {
    if (!drawPad) return;
    const { svg, points } = drawPad;
    drawPad = null;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    svg.remove();
    suppressClickUntil = Date.now() + 400;

    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    const isTap = (box.maxX - box.minX) < DRAG_THRESHOLD && (box.maxY - box.minY) < DRAG_THRESHOLD;
    const target = isTap ? topPageElementAt(points[0][0], points[0][1]) : elementForDrawing(box);
    if (!target) { showToast('Nothing pickable under that drawing', 2200); return; }

    selectedElement = target;
    state = 'CONFIGURING';
    showHighlight(target);
    clearAnnotations();
    showAnnotOverlay(target);
    if (!isTap) {
      const r = target.getBoundingClientRect();
      annotState.strokes.push({ points: points.map(([x, y]) => [x - r.left, y - r.top]) });
      redrawStrokes();
    }
    showBar('configure');
    startScrollTracking();
    maybePrefetchPage();
    maybeWarnConditionalAncestor(target);
    updateGlobalBarState();
  }

  function topPageElementAt(x, y) {
    const hit = document.elementsFromPoint(x, y).find((n) => !own(n));
    return hit && pickable(hit) ? hit : null;
  }

  // The element whose box best matches the drawing. Candidates are whatever
  // sits inside the drawing plus all their ancestors; score is
  // intersection-over-union with the drawing's bounding box, so a loop drawn
  // around a phone mockup picks the mockup, not the whole hero it lives in.
  function elementForDrawing(box) {
    const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
    const boxR = { left: box.minX, top: box.minY, right: box.maxX, bottom: box.maxY };
    const candidates = new Set();
    for (const fx of [0.25, 0.5, 0.75]) {
      for (const fy of [0.25, 0.5, 0.75]) {
        let n = topPageElementAt(box.minX + (box.maxX - box.minX) * fx, box.minY + (box.maxY - box.minY) * fy);
        for (; n && n !== document.body && n !== document.documentElement; n = n.parentElement) candidates.add(n);
      }
    }
    let best = null;
    let bestScore = 0;
    for (const n of candidates) {
      if (!pickable(n)) continue;
      const r = n.getBoundingClientRect();
      const inter = area({
        left: Math.max(r.left, boxR.left), top: Math.max(r.top, boxR.top),
        right: Math.min(r.right, boxR.right), bottom: Math.min(r.bottom, boxR.bottom),
      });
      const score = inter / (area(r) + area(boxR) - inter || 1);
      if (score > bestScore) { best = n; bestScore = score; }
    }
    return best;
  }


  /** Full teardown: remove all UI, disconnect SSE, clean up. */
  function teardown() {
    cleanup();
    stopOpenSync();
    hideBar();
    if (globalBarEl) {
      globalBarEl.style.transform = 'translateY(100%)';
      setTimeout(() => { if (globalBarEl) globalBarEl.remove(); globalBarEl = null; }, 300);
    }
    if (highlightEl) { highlightEl.remove(); highlightEl = null; }
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    if (barEl) { barEl.remove(); barEl = null; }
    if (pickerEl) { pickerEl.remove(); pickerEl = null; }
    if (paramsPanelEl) { paramsPanelEl.remove(); paramsPanelEl = null; paramsPanelInner = null; paramsPanelBody = null; }
    if (evtSource) { evtSource.close(); evtSource = null; }
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('pointerdown', onPopOutside, true);
    document.removeEventListener('keydown', onPopEscape, true);
    document.removeEventListener('pointerdown', onDrawDown, true);
    document.documentElement.classList.remove(PREFIX + '-drawing');
    state = 'IDLE';
    window.__TTUI_LIVE_INIT__ = false;
    console.log('[ttui] Live mode exited.');
  }

  // ---------------------------------------------------------------------------
  // Design System Panel — visualizes the project's .talk-to-ui/design.json sidecar
  // ---------------------------------------------------------------------------

  const DESIGN_PREFS_KEY = 'ttui-live-design-panel';
  const DESIGN_PANEL_WIDTH = 440;

  let designHost = null;
  let designShadow = null;
  let designState = {
    open: false,
    tab: 'visual',          // 'visual' | 'raw'
    parsed: null,           // parseDesignMd output (frontmatter + body sections)
    sidecar: null,          // .talk-to-ui/design.json v2 payload (extensions + components + narrative)
    hasMd: false,
    hasSidecar: false,
    present: null,          // true/false once fetch resolves
    raw: null,              // raw DESIGN.md for the raw tab
    mdNewerThanJson: false, // stale-hint flag
    loading: false,
    error: null,
    collapsed: {            // narrative-section accordion state
      rules: true, dosdonts: true, overview: true,
    },
  };

  function loadDesignPrefs() {
    // `open` is intentionally NOT persisted — the panel always starts closed
    // so live mode doesn't auto-slide a big panel over the page on startup.
    try {
      const raw = localStorage.getItem(DESIGN_PREFS_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (prefs.tab === 'visual' || prefs.tab === 'raw') designState.tab = prefs.tab;
      if (prefs.collapsed && typeof prefs.collapsed === 'object') {
        Object.assign(designState.collapsed, prefs.collapsed);
      }
    } catch { /* ignore */ }
  }

  function saveDesignPrefs() {
    try {
      localStorage.setItem(DESIGN_PREFS_KEY, JSON.stringify({
        tab: designState.tab,
        collapsed: designState.collapsed,
      }));
    } catch { /* ignore */ }
  }

  function initDesignPanel() {
    designHost = document.createElement('div');
    designHost.id = PREFIX + '-design-host';
    Object.assign(designHost.style, {
      position: 'fixed', top: '0', left: '0',
      width: '0', height: '0',
      zIndex: String(Z.bar + 10),
      pointerEvents: 'none',
    });
    designShadow = designHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    // Theme-match the bar: dark chrome on light pages, light chrome on dark pages.
    const theme = detectPageTheme();
    style.textContent = designPanelCss(barPaletteForTheme(theme));
    designShadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'root';
    designShadow.appendChild(root);

    document.body.appendChild(designHost);
    // The host is pointer-events: none; the panel inside the shadow DOM
    // manages its own auto/none. Events bubble through the shadow boundary,
    // so attaching here silences host-page outside-interaction handlers
    // without touching the host's click-through behavior.
    defangOutsideHandlers(designHost, { setPointerEvents: false });

    loadDesignPrefs();
    renderDesignChrome();
    if (designState.open) {
      fetchDesignSystem();
    }
  }

  // Neutral panel palette — deliberately NOT Talk-to-UI-branded. The panel is
  // a viewer of the project's design system, not an Talk-to-UI surface.
  const DP = {
    canvas:   'oklch(94% 0 0)',            // panel background
    tile:     'oklch(98.5% 0 0)',          // card-on-canvas
    tileAlt:  'oklch(96% 0 0)',            // subtler tile for inner surfaces
    ink:      'oklch(15% 0 0)',
    ink2:     'oklch(35% 0 0)',
    meta:     'oklch(55% 0 0)',
    hairline: 'oklch(88% 0 0)',
    hairlineSoft: 'oklch(92% 0 0)',
    amber:    'oklch(70% 0.13 65)',         // stale-hint accent
    amberBg:  'oklch(95% 0.05 80)',
  };

  function designPanelCss(BP) {
    // BP = bar palette (theme-aware, matches the global bar).
    // DP = internal content palette (neutral, so tiles render colors true).
    return `
      :host, .root { all: initial; }
      .root {
        font-family: ${FONT};
        color: ${DP.ink};
        pointer-events: none;
      }
      .root * { box-sizing: border-box; }
      button { font: inherit; color: inherit; }

      /* --- Panel shell: chrome matches the bar; body canvas stays neutral --- */
      .panel {
        position: fixed; top: 12px; bottom: 72px; right: 12px;
        width: ${DESIGN_PANEL_WIDTH}px; max-width: calc(100vw - 24px);
        background: ${BP.surface};
        border: 1px solid ${BP.hairline};
        border-radius: 14px;
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        box-shadow: 0 20px 60px oklch(0% 0 0 / 0.18), 0 4px 12px oklch(0% 0 0 / 0.08);
        display: flex; flex-direction: column;
        transform: translateX(calc(100% + 24px));
        opacity: 0;
        transition: transform 0.35s ${EASE}, opacity 0.25s ${EASE};
        pointer-events: none;
        overflow: hidden;
      }
      .panel[data-open="true"] { transform: translateX(0); opacity: 1; pointer-events: auto; }

      .panel-header {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 10px 10px 14px;
        background: transparent;
        border-bottom: 1px solid ${BP.hairline};
      }
      .panel-title {
        flex: 1; min-width: 0;
        font-family: ${MONO};
        font-size: 11.5px; font-weight: 600;
        letter-spacing: 0.02em;
        color: ${BP.text};
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .panel-close {
        border: none; background: transparent; color: ${BP.textDim};
        width: 26px; height: 26px; border-radius: 7px;
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
      }
      .panel-close:hover { background: ${BP.hairline}; color: ${BP.text}; }

      .tabs {
        display: inline-flex; padding: 2px;
        background: ${BP.hairline};
        border-radius: 7px;
        gap: 2px;
      }
      .tab {
        border: none; background: transparent;
        padding: 4px 10px; border-radius: 5px;
        font-family: ${MONO};
        font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
        text-transform: uppercase;
        color: ${BP.textDim}; cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .tab[data-active="true"] { background: ${BP.surface}; color: ${BP.text}; }

      .panel-body {
        flex: 1; overflow-y: auto;
        padding: 12px 12px 20px;
        background: ${DP.canvas};
        scrollbar-width: thin;
        scrollbar-color: ${DP.hairline} transparent;
      }
      .panel-body::-webkit-scrollbar { width: 8px; }
      .panel-body::-webkit-scrollbar-thumb { background: ${DP.hairline}; border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }

      /* --- States --- */
      .empty, .loading, .error {
        margin: 16px 4px;
        padding: 28px 20px; text-align: center;
        background: ${DP.tile}; border-radius: 14px;
        color: ${DP.ink2}; font-size: 13px; line-height: 1.55;
      }
      .empty strong { color: ${DP.ink}; display: block; margin-bottom: 6px; font-size: 14px; }
      .empty code { font-family: ${MONO}; background: ${DP.canvas}; padding: 1px 6px; border-radius: 4px; font-size: 12px; color: ${DP.ink}; }
      .error { color: oklch(45% 0.15 25); }

      /* --- Stale hint --- */
      .stale {
        display: flex; align-items: center; gap: 8px;
        margin: 8px 4px 12px;
        padding: 8px 12px;
        background: ${DP.amberBg};
        border-radius: 10px;
        font-size: 11.5px; color: ${DP.ink2};
      }
      .stale-dot { width: 8px; height: 8px; border-radius: 50%; background: ${DP.amber}; flex-shrink: 0; }
      .stale-text { flex: 1; min-width: 0; }
      .stale-text strong { color: ${DP.ink}; font-weight: 600; }

      /* --- Parsed-md fallback banner --- */
      .parsed-md-cta {
        margin: 8px 4px 14px;
        padding: 14px 16px;
        background: ${DP.tile};
        border: 1px dashed ${DP.hairline};
        border-radius: 12px;
        font-size: 12px; color: ${DP.ink2}; line-height: 1.55;
      }
      .parsed-md-cta strong { color: ${DP.ink}; display: block; margin-bottom: 4px; font-size: 13px; font-weight: 600; }
      .parsed-md-cta code { font-family: ${MONO}; background: ${DP.canvas}; padding: 1px 5px; border-radius: 4px; font-size: 11.5px; color: ${DP.ink}; }

      /* --- Tile primitives --- */
      .tile {
        position: relative;
        background: ${DP.tile};
        border-radius: 16px;
        padding: 16px;
        margin: 0 4px 10px;
      }
      .tile-row { margin: 0 4px 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .tile-row .tile { margin: 0; }
      .tile-meta {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 10px;
        font-family: ${MONO};
        font-size: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase;
        color: ${DP.meta};
      }
      .tile-meta .name { color: ${DP.ink}; font-weight: 600; letter-spacing: 0.05em; text-transform: none; font-family: ${FONT}; font-size: 12.5px; }

      /* --- Color tile --- */
      .c-tile { cursor: pointer; transition: transform 0.2s ${EASE}; }
      .c-tile:hover { transform: translateY(-1px); }
      .c-hero {
        height: 72px; border-radius: 10px; margin-top: 10px;
        box-shadow: inset 0 0 0 1px oklch(0% 0 0 / 0.05);
      }
      .c-ramp {
        display: flex; gap: 0; height: 14px; border-radius: 4px; overflow: hidden;
        margin-top: 8px;
        box-shadow: inset 0 0 0 1px oklch(0% 0 0 / 0.04);
      }
      .c-ramp > span { flex: 1; }
      .c-desc { margin-top: 8px; font-size: 11.5px; line-height: 1.45; color: ${DP.ink2}; }

      /* --- Type tile --- */
      .t-tile { }
      .t-specimen {
        margin: 4px 0 6px;
        color: ${DP.ink};
        line-height: 0.9;
      }
      .t-family { margin-top: 4px; font-size: 12px; font-weight: 600; color: ${DP.ink}; }
      .t-purpose { margin-top: 4px; font-size: 11px; line-height: 1.45; color: ${DP.ink2}; }

      /* --- Shadow tile --- */
      .s-tile { }
      .s-surface {
        height: 60px; margin: 8px 2px 10px;
        background: ${DP.tile};
        border-radius: 10px;
      }
      .s-value { font-family: ${MONO}; font-size: 10px; color: ${DP.meta}; word-break: break-all; line-height: 1.4; }
      .s-purpose { margin-top: 4px; font-size: 11px; color: ${DP.ink2}; line-height: 1.45; }

      /* --- Radii strip --- */
      .r-strip { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
      .r-item { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; min-width: 60px; }
      .r-sample { width: 44px; height: 44px; background: ${DP.canvas}; box-shadow: inset 0 0 0 1px oklch(0% 0 0 / 0.08); }
      .r-label { font-family: ${MONO}; font-size: 10px; color: ${DP.meta}; letter-spacing: 0.05em; text-transform: uppercase; }
      .r-val { font-family: ${MONO}; font-size: 10px; color: ${DP.ink}; }

      /* --- Component tile (hosts live primitives) --- */
      .cmp-tile { }
      .cmp-stage {
        margin: 12px -4px 0;
        padding: 18px 16px 10px;
        border-top: 1px solid ${DP.hairlineSoft};
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px;
        min-height: 68px;
      }
      .cmp-stage + .cmp-stage { border-top: 1px dashed ${DP.hairlineSoft}; }
      .cmp-sublabel { font-family: ${MONO}; font-size: 10px; color: ${DP.meta}; letter-spacing: 0.06em; }
      .cmp-kind { font-family: ${MONO}; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: ${DP.meta}; }

      /* --- Collapsible --- */
      .coll {
        margin: 0 4px 8px;
        background: ${DP.tile};
        border-radius: 12px;
        overflow: hidden;
      }
      .coll-head {
        display: flex; align-items: center; gap: 10px;
        width: 100%;
        padding: 12px 14px;
        background: transparent; border: none;
        cursor: pointer; text-align: left;
        font-family: ${FONT}; font-size: 12.5px; font-weight: 600; color: ${DP.ink};
        transition: background 0.12s ease;
      }
      .coll-head:hover { background: ${DP.tileAlt}; }
      .coll-chev {
        width: 12px; height: 12px; flex-shrink: 0;
        color: ${DP.meta};
        transition: transform 0.2s ${EASE};
      }
      .coll[data-open="true"] .coll-chev { transform: rotate(90deg); }
      .coll-count { margin-left: auto; font-family: ${MONO}; font-size: 10px; color: ${DP.meta}; letter-spacing: 0.05em; }
      .coll-body { padding: 0 14px 14px; display: none; }
      .coll[data-open="true"] .coll-body { display: block; }

      .rule-card {
        padding: 10px 0;
        border-top: 1px solid ${DP.hairlineSoft};
      }
      .rule-card:first-child { border-top: none; padding-top: 2px; }
      .rule-card .name { font-size: 11.5px; font-weight: 700; color: ${DP.ink}; margin-bottom: 3px; }
      .rule-card .name .section { font-family: ${MONO}; font-size: 9px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: ${DP.meta}; margin-left: 8px; }
      .rule-card .body { font-size: 11.5px; color: ${DP.ink2}; line-height: 1.5; }

      .coll .dos { display: grid; gap: 0; margin-top: 2px; }
      .coll .do, .coll .dont {
        position: relative;
        padding: 8px 0 8px 22px;
        font-size: 11.5px; line-height: 1.5; color: ${DP.ink2};
        border-top: 1px solid ${DP.hairlineSoft};
      }
      .coll .do:first-child, .coll .dont:first-child,
      .coll .do:first-of-type { border-top: none; }
      .coll .do + .dont { border-top: 1px solid ${DP.hairlineSoft}; }
      .coll .do::before, .coll .dont::before {
        content: ''; position: absolute; left: 4px; top: 13px;
        width: 8px; height: 8px; border-radius: 50%;
      }
      .coll .do::before { background: oklch(62% 0.16 145); }
      .coll .dont::before { background: oklch(58% 0.22 25); }

      .coll .overview-body {
        font-size: 12px; line-height: 1.55; color: ${DP.ink2};
      }
      .coll .overview-body .north-star {
        display: block; font-family: ${FONT}; font-style: italic;
        font-size: 15px; line-height: 1.3; color: ${DP.ink};
        margin-bottom: 8px;
      }
      .coll .overview-body p { margin: 0 0 8px; }
      .coll .overview-body ul { margin: 6px 0 0; padding-left: 16px; font-size: 11.5px; }
      .coll .overview-body li { margin-bottom: 3px; }

      /* --- raw tab markdown (unchanged layout, neutralized palette) --- */
      .md { padding: 4px 10px 20px; font-size: 13px; line-height: 1.6; color: ${DP.ink}; }
      .md h1, .md h2, .md h3, .md h4 { margin: 20px 0 8px; color: ${DP.ink}; font-weight: 600; }
      .md h1 { font-size: 18px; }
      .md h2 { font-size: 15px; padding-bottom: 4px; border-bottom: 1px solid ${DP.hairlineSoft}; }
      .md h3 { font-size: 13px; }
      .md h4 { font-size: 12px; color: ${DP.meta}; }
      .md p { margin: 0 0 10px; }
      .md ul, .md ol { margin: 0 0 10px; padding-left: 20px; }
      .md li { margin-bottom: 4px; }
      .md code { font-family: ${MONO}; font-size: 12px; background: ${DP.canvas}; padding: 1px 5px; border-radius: 4px; }
      .md pre { font-family: ${MONO}; font-size: 12px; background: ${DP.canvas}; padding: 10px 12px; border-radius: 8px; overflow-x: auto; margin: 0 0 10px; }
      .md pre code { background: none; padding: 0; }
      .md strong { font-weight: 700; }
      .md em { font-style: italic; }
      .md a { color: ${DP.ink}; text-decoration: underline; }
      .md hr { border: none; border-top: 1px solid ${DP.hairlineSoft}; margin: 16px 0; }
    `;
  }

  function renderDesignChrome() {
    const root = designShadow.querySelector('.root');
    root.innerHTML = '';

    // (Panel toggle lives in the global bar — no floating FAB.)
    // Panel
    const panel = document.createElement('aside');
    panel.className = 'panel';
    panel.setAttribute('data-open', designState.open ? 'true' : 'false');
    panel.appendChild(buildDesignHeader());
    const body = document.createElement('div');
    body.className = 'panel-body';
    body.id = 'panel-body';
    panel.appendChild(body);
    root.appendChild(panel);

    renderDesignBody();
  }

  function buildDesignHeader() {
    const header = document.createElement('div');
    header.className = 'panel-header';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'DESIGN.md';
    header.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    for (const t of [['visual', 'Visual'], ['raw', 'Raw']]) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.textContent = t[1];
      btn.setAttribute('data-active', designState.tab === t[0] ? 'true' : 'false');
      btn.addEventListener('click', () => {
        if (designState.tab === t[0]) return;
        designState.tab = t[0];
        saveDesignPrefs();
        renderDesignChrome();
        if (t[0] === 'raw' && designState.raw === null && !designState.loading) {
          fetchDesignSystem(); // raw is part of the same fetch pair
        }
      });
      tabs.appendChild(btn);
    }
    header.appendChild(tabs);

    const close = document.createElement('button');
    close.className = 'panel-close';
    close.innerHTML = '&#x2715;';
    close.setAttribute('aria-label', 'Close panel');
    close.addEventListener('click', toggleDesignPanel);
    header.appendChild(close);

    return header;
  }

  function toggleDesignPanel() {
    designState.open = !designState.open;
    renderDesignChrome();
    updateGlobalBarState();
    if (designState.open && designState.present === null && !designState.loading) {
      fetchDesignSystem();
    }
  }

  async function fetchDesignSystem() {
    designState.loading = true;
    designState.error = null;
    renderDesignBody();
    try {
      const [jsonRes, rawRes] = await Promise.all([
        fetch(`http://localhost:${PORT}/design-system.json?token=${TOKEN}`, { cache: 'no-store' }),
        fetch(`http://localhost:${PORT}/design-system/raw?token=${TOKEN}`, { cache: 'no-store' }),
      ]);
      const jsonData = await jsonRes.json();
      designState.present = jsonData.present === true;
      designState.parsed = jsonData.parsed || null;
      designState.sidecar = jsonData.sidecar || null;
      designState.hasMd = !!jsonData.hasMd;
      designState.hasSidecar = !!jsonData.hasSidecar;
      designState.mdNewerThanJson = !!jsonData.mdNewerThanJson;
      designState.raw = designState.present && rawRes.ok ? await rawRes.text() : null;
      designState.error = jsonData.parseError || jsonData.sidecarError || null;
    } catch (err) {
      designState.error = err?.message || 'Failed to load design system.';
    } finally {
      designState.loading = false;
      renderDesignChrome(); // refresh title from data
    }
  }

  function renderDesignBody() {
    const body = designShadow.querySelector('#panel-body');
    if (!body) return;
    body.innerHTML = '';

    if (designState.loading) {
      body.appendChild(msgDiv('loading', 'Loading design system…'));
      return;
    }
    if (designState.error) {
      body.appendChild(msgDiv('error', designState.error));
      return;
    }
    if (designState.present === false) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = `<strong>No DESIGN.md yet</strong>Create one by running <code>/ttui document</code> in your terminal, then re-open this panel.`;
      body.appendChild(empty);
      return;
    }

    if (designState.tab === 'raw') {
      renderRawTab(body, designState.raw || '');
      return;
    }

    // Visual tab — single unified render path.
    if (designState.mdNewerThanJson) body.appendChild(renderStaleHint());
    if (designState.hasMd && !designState.hasSidecar) {
      body.appendChild(renderParsedMdCta());
    }
    renderDesignVisual(body, designState.parsed, designState.sidecar);
  }

  function msgDiv(cls, text) {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  }

  function renderStaleHint() {
    const box = document.createElement('div');
    box.className = 'stale';
    box.innerHTML = `
      <span class="stale-dot"></span>
      <span class="stale-text"><strong>DESIGN.md is newer than .talk-to-ui/design.json.</strong> Run <code>/ttui document</code> to refresh the sidecar.</span>
    `;
    return box;
  }

  function renderParsedMdCta() {
    const box = document.createElement('div');
    box.className = 'parsed-md-cta';
    box.innerHTML = `<strong>Basic view</strong>This panel reads the tokens in your <code>DESIGN.md</code> frontmatter. Running <code>/ttui document</code> also generates a <code>.talk-to-ui/design.json</code> sidecar with your project's actual component snippets (button, input, nav) and tonal ramps, rendered live below the tokens.`;
    return box;
  }

  // --- Unified render: merge parsed DESIGN.md frontmatter with sidecar v2 ---

  function renderDesignVisual(body, parsed, sidecar) {
    const frontmatter = parsed?.frontmatter || {};
    const extensions = sidecar?.extensions || {};
    const proseColors = parsed?.colors || null;

    const colors = buildColorModels(frontmatter.colors, extensions.colorMeta, proseColors);
    if (colors.length) renderColorTiles(body, colors);

    const types = buildTypographyModels(frontmatter.typography, extensions.typographyMeta);
    if (types.length) renderTypeTiles(body, types);

    const radii = buildRadiiModels(frontmatter.rounded);
    if (radii.length) renderRadiiTile(body, radii);

    if (extensions.shadows?.length) renderShadowTiles(body, extensions.shadows);

    const components = sidecar?.components || [];
    if (components.length) renderComponentTiles(body, components);

    // Narrative: sidecar wins if present (richer, agent-curated). Otherwise
    // synthesize from prose sections.
    const narrative = sidecar?.narrative || synthesizeNarrative(parsed);
    if (narrative.rules?.length) body.appendChild(renderRulesCollapsible(narrative.rules));
    if ((narrative.dos?.length || narrative.donts?.length)) body.appendChild(renderDosDontsCollapsible(narrative));
    if (narrative.overview || narrative.northStar || narrative.keyCharacteristics?.length) {
      body.appendChild(renderOverviewCollapsible(narrative));
    }

    if (body.childElementCount === 0) {
      body.appendChild(msgDiv('empty', 'No design system data available.'));
    }
  }

  // Frontmatter primitives + sidecar colorMeta → tile-ready color models.
  // A matching prose bullet (when the slug sits in the bullet text) supplies
  // description as a last-resort fallback.
  function buildColorModels(fmColors, colorMeta, proseColors) {
    if (!fmColors) return [];
    const meta = colorMeta || {};
    return Object.entries(fmColors).map(([key, value]) => {
      const m = meta[key] || {};
      return {
        role: m.role || humanizeKey(key),
        name: m.displayName || humanizeKey(key),
        value: value,
        canonical: m.canonical || null,
        description: m.description || findProseDescription(proseColors, key, m.displayName),
        tonalRamp: m.tonalRamp || null,
      };
    });
  }

  function buildTypographyModels(fmTypography, typographyMeta) {
    if (!fmTypography) return [];
    const meta = typographyMeta || {};
    return Object.entries(fmTypography).map(([key, spec]) => {
      const m = meta[key] || {};
      const { family, fallback } = splitFontFamily(spec?.fontFamily);
      return {
        role: key,
        name: m.displayName || humanizeKey(key),
        family,
        fallback,
        weight: spec?.fontWeight ?? 400,
        // fontStyle isn't in Stitch's frontmatter schema; the sidecar carries
        // it when a role is rendered in italic (e.g. display italic).
        style: m.style || 'normal',
        sampleSize: spec?.fontSize || '1rem',
        lineHeight: spec?.lineHeight != null ? String(spec.lineHeight) : '',
        letterSpacing: spec?.letterSpacing,
        purpose: m.purpose,
      };
    });
  }

  function buildRadiiModels(fmRounded) {
    if (!fmRounded) return [];
    return Object.entries(fmRounded).map(([name, value]) => ({ name, value }));
  }

  function splitFontFamily(stack) {
    if (!stack || typeof stack !== 'string') return { family: '', fallback: '' };
    const parts = stack.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    return { family: parts[0] || '', fallback: parts.slice(1).join(', ') };
  }

  function humanizeKey(k) {
    return String(k || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function findProseDescription(proseColors, key, displayName) {
    if (!proseColors || !proseColors.groups) return null;
    const needles = [key, displayName].filter(Boolean).map((s) => s.toLowerCase());
    for (const g of proseColors.groups) {
      for (const c of g.colors || []) {
        const hay = String(c.name || '').toLowerCase();
        if (hay && needles.some((n) => hay.includes(n) || n.includes(hay))) {
          return c.description || null;
        }
      }
    }
    return null;
  }

  function synthesizeNarrative(parsed) {
    if (!parsed) return {};
    const md = parsed;
    return {
      northStar: md.overview?.creativeNorthStar,
      overview: (md.overview?.philosophy || []).join(' '),
      keyCharacteristics: md.overview?.keyCharacteristics || [],
      rules: [
        ...(md.colors?.rules || []).map((r) => ({ ...r, section: 'colors' })),
        ...(md.typography?.rules || []).map((r) => ({ ...r, section: 'typography' })),
        ...(md.elevation?.rules || []).map((r) => ({ ...r, section: 'elevation' })),
      ],
      dos: md.dosDonts?.dos || [],
      donts: md.dosDonts?.donts || [],
    };
  }

  function renderColorTiles(body, colors) {
    for (const c of colors) {
      const tile = document.createElement('div');
      tile.className = 'tile c-tile';
      tile.title = 'Click to copy';
      tile.addEventListener('click', () => copyToClipboard(c.value));

      const meta = document.createElement('div');
      meta.className = 'tile-meta';
      meta.innerHTML = `<span class="name">${escapeHtml(c.name || c.role || 'Color')}</span><span>${escapeHtml(c.value || '')}</span>`;
      tile.appendChild(meta);

      const hero = document.createElement('div');
      hero.className = 'c-hero';
      hero.style.background = c.value;
      tile.appendChild(hero);

      const ramp = synthesizeRamp(c);
      if (ramp.length) {
        const r = document.createElement('div');
        r.className = 'c-ramp';
        r.innerHTML = ramp.map((v) => `<span style="background:${cssSafe(v)}"></span>`).join('');
        tile.appendChild(r);
      }

      if (c.description) {
        const d = document.createElement('div');
        d.className = 'c-desc';
        d.textContent = c.description;
        tile.appendChild(d);
      }
      body.appendChild(tile);
    }
  }

  function synthesizeRamp(c) {
    if (c.tonalRamp?.length) return c.tonalRamp;
    // If base value is OKLCH, synthesize an 8-step ramp across lightness.
    const m = typeof c.value === 'string' && c.value.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/i);
    if (!m) return [];
    const [, , chroma, hue] = m;
    const steps = [20, 32, 44, 56, 68, 80, 90, 96];
    return steps.map((l) => `oklch(${l}% ${chroma} ${hue})`);
  }

  function renderTypeTiles(body, types) {
    for (const t of types) {
      const tile = document.createElement('div');
      tile.className = 'tile t-tile';

      const meta = document.createElement('div');
      meta.className = 'tile-meta';
      meta.innerHTML = `<span>${escapeHtml(t.role || '')}</span><span>${escapeHtml(t.weight || '')} ${escapeHtml(t.style === 'italic' ? 'italic' : '')}</span>`;
      tile.appendChild(meta);

      const specimen = document.createElement('div');
      specimen.className = 't-specimen';
      specimen.textContent = 'Aa';
      specimen.style.fontFamily = fontStack(t);
      specimen.style.fontWeight = String(t.weight || 400);
      specimen.style.fontStyle = t.style || 'normal';
      specimen.style.fontSize = '56px';  // Fixed specimen size — compare faces, not scales.
      specimen.style.letterSpacing = 'normal';
      specimen.style.textTransform = 'none';
      tile.appendChild(specimen);

      // The system's actual sample size for this role, shown as small mono meta below.
      if (t.sampleSize) {
        const scale = document.createElement('div');
        scale.style.cssText = 'font-family:' + MONO + '; font-size: 10px; color:' + DP.meta + '; margin-top: 2px;';
        scale.textContent = t.sampleSize;
        tile.appendChild(scale);
      }

      const family = document.createElement('div');
      family.className = 't-family';
      family.textContent = t.family || t.name || '';
      tile.appendChild(family);

      if (t.purpose) {
        const p = document.createElement('div');
        p.className = 't-purpose';
        p.textContent = t.purpose;
        tile.appendChild(p);
      }
      body.appendChild(tile);
    }
  }

  function fontStack(t) {
    const fam = t.family || '';
    const fb = t.fallback || '';
    if (fam && /[,\s]/.test(fam) && !fam.includes("'") && !fam.includes('"')) {
      return `"${fam}", ${fb}`;
    }
    return fam && fb ? `"${fam}", ${fb}` : (fam || fb);
  }

  function renderRadiiTile(body, radii) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const meta = document.createElement('div');
    meta.className = 'tile-meta';
    meta.innerHTML = `<span class="name">Corner Radii</span><span>${radii.length}</span>`;
    tile.appendChild(meta);

    const strip = document.createElement('div');
    strip.className = 'r-strip';
    for (const r of radii) {
      const item = document.createElement('div');
      item.className = 'r-item';
      const s = document.createElement('div');
      s.className = 'r-sample';
      s.style.borderRadius = r.value || '0';
      item.appendChild(s);
      const lbl = document.createElement('div');
      lbl.className = 'r-label';
      lbl.textContent = r.name || '';
      item.appendChild(lbl);
      const val = document.createElement('div');
      val.className = 'r-val';
      val.textContent = r.value || '';
      item.appendChild(val);
      strip.appendChild(item);
    }
    tile.appendChild(strip);
    body.appendChild(tile);
  }

  function renderShadowTiles(body, shadows) {
    for (const sh of shadows) {
      const tile = document.createElement('div');
      tile.className = 'tile s-tile';

      const meta = document.createElement('div');
      meta.className = 'tile-meta';
      meta.innerHTML = `<span class="name">${escapeHtml(sh.name || 'Shadow')}</span><span>Elevation</span>`;
      tile.appendChild(meta);

      const surface = document.createElement('div');
      surface.className = 's-surface';
      surface.style.boxShadow = sh.value || 'none';
      tile.appendChild(surface);

      const val = document.createElement('div');
      val.className = 's-value';
      val.textContent = sh.value || '';
      tile.appendChild(val);

      if (sh.purpose) {
        const p = document.createElement('div');
        p.className = 's-purpose';
        p.textContent = sh.purpose;
        tile.appendChild(p);
      }
      body.appendChild(tile);
    }
  }

  function renderComponentTiles(body, components) {
    // Group consecutive components that share a kind into one tile. This avoids
    // a pile of one-component tiles (e.g., three button variants = three tiles)
    // and reads more like a proper category.
    const groups = groupByKind(components);

    for (const group of groups) {
      const tile = document.createElement('div');
      tile.className = 'tile cmp-tile';

      const meta = document.createElement('div');
      meta.className = 'tile-meta';
      const groupTitle = group.length === 1
        ? (group[0].name || group[0].kind || 'Component')
        : titleForKind(group[0].kind, group.length);
      meta.innerHTML = `<span class="name">${escapeHtml(groupTitle)}</span><span class="cmp-kind">${escapeHtml(group[0].kind || '')}</span>`;
      tile.appendChild(meta);

      for (const c of group) {
        const stage = document.createElement('div');
        stage.className = 'cmp-stage';

        // Render the component in its own shadow root so its CSS can't bleed.
        const host = document.createElement('div');
        const sub = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = c.css || '';
        sub.appendChild(style);
        const container = document.createElement('div');
        container.innerHTML = c.html || '';
        sub.appendChild(container);
        stage.appendChild(host);

        // Show component name as a sublabel only when the tile groups >1 item,
        // or when the component's display name differs from its kind.
        const showSublabel = group.length > 1;
        if (showSublabel) {
          const lbl = document.createElement('div');
          lbl.className = 'cmp-sublabel';
          lbl.textContent = c.name || '';
          stage.appendChild(lbl);
        }
        tile.appendChild(stage);
      }

      // Single shared description if all items carry the same one; otherwise
      // skip — per-item descriptions clutter a grouped tile.
      if (group.length === 1 && group[0].description) {
        const d = document.createElement('div');
        d.className = 'c-desc';
        d.textContent = group[0].description;
        tile.appendChild(d);
      }
      body.appendChild(tile);
    }
  }

  function groupByKind(components) {
    const groups = [];
    for (const c of components) {
      const last = groups[groups.length - 1];
      if (last && last[0].kind && c.kind === last[0].kind) {
        last.push(c);
      } else {
        groups.push([c]);
      }
    }
    return groups;
  }

  function titleForKind(kind, count) {
    const labels = {
      button: 'Buttons',
      input: 'Inputs',
      nav: 'Navigation',
      chip: 'Chips',
      card: 'Cards',
      custom: 'Components',
    };
    return labels[kind] || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) + 's' : 'Components');
  }

  // --- Collapsibles ---------------------------------------------------------

  function buildCollapsible(key, label, count) {
    const wrap = document.createElement('div');
    wrap.className = 'coll';
    wrap.setAttribute('data-open', designState.collapsed[key] ? 'false' : 'true');

    const head = document.createElement('button');
    head.className = 'coll-head';
    head.innerHTML = `
      <svg class="coll-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5L8 6 4 9.5"/></svg>
      <span>${escapeHtml(label)}</span>
      ${count != null ? `<span class="coll-count">${escapeHtml(String(count))}</span>` : ''}
    `;
    head.addEventListener('click', () => {
      designState.collapsed[key] = !designState.collapsed[key];
      saveDesignPrefs();
      renderDesignBody();
    });
    wrap.appendChild(head);

    const body = document.createElement('div');
    body.className = 'coll-body';
    wrap.appendChild(body);
    return { wrap, body };
  }

  function renderRulesCollapsible(rules) {
    const { wrap, body } = buildCollapsible('rules', 'Named Rules', rules.length);
    for (const r of rules) {
      const card = document.createElement('div');
      card.className = 'rule-card';
      const name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = `${escapeHtml(r.name)}${r.section ? `<span class="section">${escapeHtml(r.section)}</span>` : ''}`;
      card.appendChild(name);
      const b = document.createElement('div');
      b.className = 'body';
      b.textContent = r.body || '';
      card.appendChild(b);
      body.appendChild(card);
    }
    return wrap;
  }

  function renderDosDontsCollapsible(n) {
    const total = (n.dos?.length || 0) + (n.donts?.length || 0);
    const { wrap, body } = buildCollapsible('dosdonts', "Do's and Don'ts", total);
    const grid = document.createElement('div');
    grid.className = 'dos';
    for (const d of n.dos || []) {
      const el = document.createElement('div');
      el.className = 'do';
      el.innerHTML = inlineMd(d);
      grid.appendChild(el);
    }
    for (const d of n.donts || []) {
      const el = document.createElement('div');
      el.className = 'dont';
      el.innerHTML = inlineMd(d);
      grid.appendChild(el);
    }
    body.appendChild(grid);
    return wrap;
  }

  function renderOverviewCollapsible(n) {
    const { wrap, body } = buildCollapsible('overview', 'Overview', null);
    const ov = document.createElement('div');
    ov.className = 'overview-body';
    if (n.northStar) {
      const star = document.createElement('span');
      star.className = 'north-star';
      star.textContent = '“' + n.northStar + '”';
      ov.appendChild(star);
    }
    if (n.overview) {
      const p = document.createElement('p');
      p.innerHTML = inlineMd(n.overview);
      ov.appendChild(p);
    }
    if (n.keyCharacteristics?.length) {
      const ul = document.createElement('ul');
      ul.innerHTML = n.keyCharacteristics.map((k) => `<li>${inlineMd(k)}</li>`).join('');
      ov.appendChild(ul);
    }
    body.appendChild(ov);
    return wrap;
  }

  function cssSafe(v) {
    // Strip anything outside valid CSS value chars to prevent injection via
    // .talk-to-ui/design.json values rendered into inline style strings.
    return String(v).replace(/[<>"'`\n]/g, '');
  }

  // --- Raw tab: minimal markdown renderer (subset) --------------------------

  function renderRawTab(body, md) {
    const wrap = document.createElement('div');
    wrap.className = 'md';
    wrap.innerHTML = renderMarkdown(md);
    body.appendChild(wrap);
  }

  function renderMarkdown(md) {
    const lines = md.split(/\r?\n/);
    const out = [];
    let i = 0;
    let inCode = false;
    let codeBuf = [];
    let paraBuf = [];
    let listBuf = [];  // array of { indent, html }
    let listType = null; // 'ul' | 'ol'

    const flushPara = () => {
      if (paraBuf.length) {
        out.push(`<p>${inlineMd(paraBuf.join(' '))}</p>`);
        paraBuf = [];
      }
    };
    const flushList = () => {
      if (listBuf.length) {
        out.push(buildListHtml(listBuf, listType));
        listBuf = [];
        listType = null;
      }
    };
    const flushAll = () => { flushPara(); flushList(); };

    for (; i < lines.length; i++) {
      const line = lines[i];

      // Code fence
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        if (!inCode) { flushAll(); inCode = true; codeBuf = []; }
        else {
          out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
          inCode = false;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      if (line.trim() === '') { flushAll(); continue; }

      const hr = line.match(/^\s*(?:---+|\*\*\*+)\s*$/);
      if (hr) { flushAll(); out.push('<hr />'); continue; }

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushAll();
        const lvl = heading[1].length;
        out.push(`<h${lvl}>${inlineMd(heading[2])}</h${lvl}>`);
        continue;
      }

      const bullet = line.match(/^(\s*)([-*])\s+(.+)$/);
      const ordered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
      if (bullet || ordered) {
        flushPara();
        const m = bullet || ordered;
        const indent = Math.floor(m[1].length / 2);
        const t = bullet ? 'ul' : 'ol';
        if (listType && listType !== t) flushList();
        listType = t;
        listBuf.push({ indent, html: inlineMd(m[3]) });
        continue;
      }

      paraBuf.push(line);
    }
    flushAll();
    if (inCode && codeBuf.length) {
      out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
    }
    return out.join('\n');
  }

  function buildListHtml(items, type) {
    // Nest by indent (one level deep is plenty for DESIGN.md).
    let html = `<${type}>`;
    let lastIndent = 0;
    for (const it of items) {
      if (it.indent > lastIndent) html += `<${type}>`;
      else if (it.indent < lastIndent) html += `</${type}>`.repeat(lastIndent - it.indent);
      html += `<li>${it.html}</li>`;
      lastIndent = it.indent;
    }
    html += `</${type}>`.repeat(lastIndent + 1);
    return html;
  }

  function inlineMd(text) {
    // Order matters: escape first, then re-inject tags.
    let s = escapeHtml(text);
    // Code spans
    s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
    // Bold
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic (only single *…*, skip if inside bold already handled)
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return s;
  }

  function highlightBold(text) {
    return inlineMd(text);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function copyToClipboard(text) {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      showToast('Copied: ' + text);
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init() {
    try { history.scrollRestoration = 'manual'; } catch {}
    initHighlight();
    initAnnotOverlay();
    initBar();
    initActionPicker();
    initParamsPanel();
    initGlobalBar();
    initDesignPanel();
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    connectSSE();

    // Check for an active session to resume (variant wrapper already in DOM after HMR)
    if (!resumeSession()) {
      console.log('[ttui] Live variant mode ready. Hover over elements to pick one.');
      // SvelteKit (and any framework that hydrates after HTML parse) may add
      // the variant wrapper AFTER init runs. Watch for it and retry resume
      // once it appears. Disconnect on first hit.
      const scout = new MutationObserver(() => {
        const wrapper = document.querySelector('[data-ttui-variants]');
        if (!wrapper) return;
        scout.disconnect();
        if (resumeSession()) {
          console.log('[ttui] Resumed deferred session ' + currentSessionId + ' (post-hydration).');
        }
      });
      scout.observe(document.body, { childList: true, subtree: true });
      // Only for hydration right after load. Versions that show up later belong
      // to whichever tab asked for them; this tab just tags them.
      setTimeout(() => scout.disconnect(), SCOUT_WINDOW_MS);
    } else {
      console.log('[ttui] Resumed active variant session ' + currentSessionId + ' (' + arrivedVariants + '/' + expectedVariants + ' variants).');
    }
    startOpenSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
