// ==UserScript==
// @name         Target Stock Watch (Page Alert Only)
// @namespace    local.target.stockwatch
// @version      0.6
// @description  Watches Target product pages for a purchasable button, then alerts and opens/focuses the matching product page. No cart/API actions.
// @match        https://www.target.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const ITEMS = [
    { tcin: '1010892076', label: 'Target item 1010892076' },
    { tcin: '1010892067', label: 'Target item 1010892067' },
    { tcin: '1010892068', label: 'Target item 1010892068' },
    { tcin: '1010892065', label: 'Target item 1010892065' },
    { tcin: '1010892069', label: 'Target item 1010892069' },
    { tcin: '1010892070', label: 'Target item 1010892070' },
  ];

  // Page-based checking is heavier than an API request, so keep this around 3s.
  const REFRESH_MS = 3000;
  const BUTTON_SCAN_MS = 200;

  const KEY_ENABLED = 'tsw.enabled';
  const KEY_HIT = 'tsw.hit';
  const KEY_STATUS_PREFIX = 'tsw.status.';

  let audioCtx = null;
  let controllerTimer = null;
  let workerReloadTimer = null;
  let workerScanTimer = null;
  let hitThisLoad = false;

  let globalStatus = null;
  let startBtn = null;
  let stopBtn = null;
  let rows = null;

  const params = new URLSearchParams(location.search);
  const isWorker = params.get('tsw_worker') === '1' || /^tsw-\d+$/.test(window.name);
  const currentTcin = getCurrentTcin();
  const currentItem = ITEMS.find(item => item.tcin === currentTcin) || null;

  function getCurrentTcin() {
    const match = location.pathname.match(/A-(\d+)/i);
    return match ? match[1] : null;
  }

  function productUrl(itemOrTcin) {
    const tcin = typeof itemOrTcin === 'string' ? itemOrTcin : itemOrTcin.tcin;
    return `https://www.target.com/p/A-${tcin}`;
  }

  function workerUrl(item) {
    return `${productUrl(item)}?tsw_worker=1`;
  }

  function enabled() {
    return localStorage.getItem(KEY_ENABLED) === '1';
  }

  function nowTime() {
    return new Date().toLocaleTimeString();
  }

  function setStatus(tcin, text) {
    localStorage.setItem(
      `${KEY_STATUS_PREFIX}${tcin}`,
      JSON.stringify({ text, at: Date.now() })
    );
  }

  function readStatus(tcin) {
    try {
      const raw = localStorage.getItem(`${KEY_STATUS_PREFIX}${tcin}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearStatuses() {
    for (const item of ITEMS) {
      localStorage.removeItem(`${KEY_STATUS_PREFIX}${item.tcin}`);
    }
  }

  function ensureAudio() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
  }

  function beep() {
    try {
      ensureAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.45);
    } catch (_) {}
  }

  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 && rect.height > 0;
  }

  function enabledButton(el) {
    return !!el &&
      visible(el) &&
      !el.disabled &&
      el.getAttribute('aria-disabled') !== 'true';
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function findPurchaseControl() {
    // Prefer Target-specific PDP hooks. These are much less likely to match
    // recommendation-card buttons elsewhere on the page.
    const selectors = [
      '[data-test="preorderButton"]',
      '[data-test="shipItButton"]',
      '[data-test="orderPickupButton"]',
      '[data-test="addToCartButton"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (enabledButton(el)) {
        return {
          el,
          text: normalizeText(el.innerText || el.textContent || selector),
          selector
        };
      }
    }

    // Fallback if Target changes data-test names. Limit to buttons near the
    // top/main PDP area to avoid recommendation carousels lower on the page.
    const buttons = [...document.querySelectorAll('button')];
    const match = buttons.find(button => {
      if (!enabledButton(button)) return false;
      const rect = button.getBoundingClientRect();
      if (rect.top > 1800) return false;
      const text = normalizeText(button.innerText || button.textContent);
      return /^(preorder now|preorder|ship it|add to cart|pick it up)$/i.test(text);
    });

    return match ? {
      el: match,
      text: normalizeText(match.innerText || match.textContent),
      selector: 'text-fallback'
    } : null;
  }

  function emitHit(item, control) {
    if (hitThisLoad || !enabled()) return;
    hitThisLoad = true;

    const hit = {
      tcin: item.tcin,
      label: item.label,
      buttonText: control.text || 'Purchasable',
      selector: control.selector,
      at: Date.now()
    };

    setStatus(item.tcin, `🟢 ${hit.buttonText} found @ ${nowTime()}`);
    localStorage.setItem(KEY_HIT, JSON.stringify(hit));
    localStorage.setItem(KEY_ENABLED, '0');

    stopWorkerTimers();
    renderWorkerBadge(`FOUND — ${hit.buttonText}`);

    // This worker is already the matching product page. Bring it forward.
    try { window.focus(); } catch (_) {}
  }

  function stopWorkerTimers() {
    if (workerReloadTimer) clearTimeout(workerReloadTimer);
    if (workerScanTimer) clearInterval(workerScanTimer);
    workerReloadTimer = null;
    workerScanTimer = null;
  }

  function renderWorkerBadge(text) {
    let badge = document.getElementById('tsw-worker-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'tsw-worker-badge';
      badge.style.cssText = [
        'position:fixed',
        'right:12px',
        'bottom:12px',
        'z-index:2147483647',
        'background:#fff',
        'color:#111',
        'border:2px solid #cc0000',
        'border-radius:8px',
        'padding:7px 10px',
        'font:12px/1.3 system-ui,sans-serif',
        'box-shadow:0 3px 12px rgba(0,0,0,.2)'
      ].join(';');
      document.body.appendChild(badge);
    }
    badge.textContent = `Target Watch: ${text}`;
  }

  function startWorker() {
    if (!currentItem) return;

    if (!enabled()) {
      renderWorkerBadge('Paused');
      return;
    }

    setStatus(currentItem.tcin, `Watching page @ ${nowTime()}`);
    renderWorkerBadge(`Watching ${currentItem.tcin}`);

    const scan = () => {
      if (!enabled()) {
        stopWorkerTimers();
        renderWorkerBadge('Stopped');
        return;
      }

      const control = findPurchaseControl();
      if (control) emitHit(currentItem, control);
    };

    scan();
    workerScanTimer = setInterval(scan, BUTTON_SCAN_MS);
    workerReloadTimer = setTimeout(() => location.reload(), REFRESH_MS);
  }

  async function startController() {
    ensureAudio();

    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) {}
    }

    clearStatuses();
    localStorage.removeItem(KEY_HIT);
    localStorage.setItem(KEY_ENABLED, '1');

    let opened = 0;
    for (const item of ITEMS) {
      const child = window.open(workerUrl(item), `tsw-${item.tcin}`);
      if (child) opened += 1;
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    globalStatus.textContent = opened === ITEMS.length
      ? `Running • ${opened} product watch tabs open`
      : `Running • ${opened}/${ITEMS.length} tabs opened; allow pop-ups for target.com`;

    refreshControllerRows();
  }

  function stopController() {
    localStorage.setItem(KEY_ENABLED, '0');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    globalStatus.textContent = `Stopped • ${nowTime()}`;
    refreshControllerRows();
  }

  function handleHit(hit) {
    if (!hit || !hit.tcin) return;

    beep();
    setTimeout(beep, 220);
    setTimeout(beep, 440);

    document.title = `🟢 TARGET IN STOCK: ${hit.tcin}`;
    const message = `${hit.tcin}: ${hit.buttonText || 'Purchasable'} is available`;
    globalStatus.textContent = `FOUND: ${message}`;
    startBtn.disabled = false;
    stopBtn.disabled = true;

    // Reuse/focus the already-open worker tab for this product. This avoids
    // relying on a new popup at alert time.
    try {
      const productWindow = window.open(productUrl(hit.tcin), `tsw-${hit.tcin}`);
      if (productWindow) productWindow.focus();
    } catch (_) {}

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notification = new Notification('Target stock alert', {
          body: message,
          requireInteraction: true
        });
        notification.onclick = () => {
          try {
            const productWindow = window.open(productUrl(hit.tcin), `tsw-${hit.tcin}`);
            if (productWindow) productWindow.focus();
          } catch (_) {}
          notification.close();
        };
      } catch (_) {}
    }

    refreshControllerRows();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function refreshControllerRows() {
    if (!rows) return;
    rows.innerHTML = '';

    for (const item of ITEMS) {
      const status = readStatus(item.tcin);
      const row = document.createElement('div');
      row.style.cssText = 'padding:5px 0;border-top:1px solid #ddd;font:12px/1.35 system-ui,sans-serif;';
      const statusText = status?.text || (enabled() ? 'Opening / waiting…' : 'Idle');
      row.innerHTML = `
        <a href="${productUrl(item)}" target="_blank"><b>${item.tcin}</b></a><br>
        <span>${escapeHtml(statusText)}</span>
      `;
      rows.appendChild(row);
    }
  }

  function renderController() {
    const panel = document.createElement('div');
    panel.id = 'target-stockwatch-panel';
    panel.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:2147483647',
      'width:320px',
      'background:#fff',
      'color:#111',
      'border:2px solid #cc0000',
      'border-radius:10px',
      'box-shadow:0 4px 18px rgba(0,0,0,.25)',
      'padding:10px',
      'font:13px/1.4 system-ui,sans-serif'
    ].join(';');

    panel.innerHTML = `
      <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Target Stock Watch v0.6</div>
      <div id="tsw-global" style="margin-bottom:7px;">${enabled() ? 'Running' : 'Idle'}</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="tsw-start" style="cursor:pointer;padding:5px 9px;">Start</button>
        <button id="tsw-stop" style="cursor:pointer;padding:5px 9px;">Stop</button>
      </div>
      <div id="tsw-rows"></div>
      <div style="margin-top:7px;font-size:11px;color:#555;">
        Page-based • refresh ~${REFRESH_MS / 1000}s • alert only • no API/cart actions
      </div>
    `;

    document.body.appendChild(panel);

    globalStatus = panel.querySelector('#tsw-global');
    startBtn = panel.querySelector('#tsw-start');
    stopBtn = panel.querySelector('#tsw-stop');
    rows = panel.querySelector('#tsw-rows');

    startBtn.addEventListener('click', startController);
    stopBtn.addEventListener('click', stopController);

    startBtn.disabled = enabled();
    stopBtn.disabled = !enabled();
    refreshControllerRows();
    controllerTimer = setInterval(refreshControllerRows, 500);
  }

  window.addEventListener('storage', event => {
    if (event.key === KEY_ENABLED && event.newValue !== '1' && isWorker) {
      stopWorkerTimers();
      renderWorkerBadge('Stopped');
    }

    if (event.key === KEY_HIT && event.newValue && !isWorker) {
      try { handleHit(JSON.parse(event.newValue)); } catch (_) {}
    }
  });

  if (isWorker && currentItem) {
    startWorker();
  } else {
    renderController();

    // Recover a hit if the controller tab was backgrounded when it happened.
    try {
      const existingHit = localStorage.getItem(KEY_HIT);
      if (existingHit) handleHit(JSON.parse(existingHit));
    } catch (_) {}
  }
})();
