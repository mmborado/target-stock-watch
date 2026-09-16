// ==UserScript==
// @name         Target Stock Watch + Page Auto-Add
// @namespace    local.target.stockwatch
// @version      0.4
// @description  Watches selected Target product pages and clicks Target's own Add to cart / Preorder button when it appears.
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

  // Full-page refresh cadence for worker tabs. This uses Target's normal page flow
  // instead of manufacturing cart API requests.
  const REFRESH_MS = 3000;
  const BUTTON_SCAN_MS = 200;
  const POST_CLICK_CONFIRM_MS = 2500;

  const KEY_ENABLED = 'tsw.enabled';
  const KEY_HIT = 'tsw.hit';
  const KEY_STATUS_PREFIX = 'tsw.status.';

  let audioCtx = null;
  let controllerTimer = null;
  let workerReloadTimer = null;
  let workerScanTimer = null;
  let clickedThisLoad = false;

  const params = new URLSearchParams(location.search);
  const workerFromQuery = params.get('tsw_worker') === '1';
  const workerFromName = /^tsw-\d+$/.test(window.name);
  const isWorker = workerFromQuery || workerFromName;
  const currentTcin = getCurrentTcin();
  const currentItem = ITEMS.find(item => item.tcin === currentTcin) || null;

  function getCurrentTcin() {
    const match = location.pathname.match(/A-(\d+)/i);
    return match ? match[1] : null;
  }

  function itemUrl(item) {
    return `https://www.target.com/p/A-${item.tcin}?tsw_worker=1`;
  }

  function enabled() {
    return localStorage.getItem(KEY_ENABLED) === '1';
  }

  function setStatus(tcin, text) {
    const value = JSON.stringify({ text, at: Date.now() });
    localStorage.setItem(`${KEY_STATUS_PREFIX}${tcin}`, value);
  }

  function readStatus(tcin) {
    try {
      const raw = localStorage.getItem(`${KEY_STATUS_PREFIX}${tcin}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function emitHit(item, confirmed) {
    const hit = {
      tcin: item.tcin,
      label: item.label,
      confirmed,
      at: Date.now()
    };
    localStorage.setItem(KEY_HIT, JSON.stringify(hit));
    localStorage.setItem(KEY_ENABLED, '0');
  }

  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function findPurchaseButton() {
    const buttons = [...document.querySelectorAll('button')];

    // Prefer Target's first visible primary product action. The main PDP controls
    // occur before recommendation carousels in the DOM in normal Target pages.
    return buttons.find(button => {
      if (button.disabled || !visible(button)) return false;
      const text = normalizeText(button.innerText || button.textContent);
      return /^(add to cart|preorder now)$/i.test(text);
    }) || null;
  }

  function cartConfirmationVisible() {
    const buttons = [...document.querySelectorAll('button')];
    if (buttons.some(button => /^(in cart|added)$/i.test(normalizeText(button.innerText)))) {
      return true;
    }

    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
    return dialogs.some(dialog => /added to cart|added/i.test(normalizeText(dialog.innerText)));
  }

  function stopWorkerTimers() {
    if (workerReloadTimer) clearTimeout(workerReloadTimer);
    if (workerScanTimer) clearInterval(workerScanTimer);
    workerReloadTimer = null;
    workerScanTimer = null;
  }

  async function handlePurchaseButton(button) {
    if (clickedThisLoad || !enabled() || !currentItem) return;
    clickedThisLoad = true;
    stopWorkerTimers();

    const buttonText = normalizeText(button.innerText || button.textContent);
    setStatus(currentItem.tcin, `${buttonText} found — clicking`);

    try {
      button.click();
    } catch (err) {
      clickedThisLoad = false;
      setStatus(currentItem.tcin, `Click failed: ${err?.message || err}`);
      scheduleWorkerReload();
      return;
    }

    const started = Date.now();
    let confirmed = false;

    while (Date.now() - started < POST_CLICK_CONFIRM_MS) {
      await new Promise(resolve => setTimeout(resolve, 150));
      if (cartConfirmationVisible()) {
        confirmed = true;
        break;
      }
    }

    setStatus(
      currentItem.tcin,
      confirmed ? '✅ Target confirmed item added' : '🟡 Purchase button clicked — verify cart'
    );
    emitHit(currentItem, confirmed);

    // Existing worker tab can navigate without popup permission.
    setTimeout(() => {
      location.assign('https://www.target.com/cart');
    }, 500);
  }

  function scheduleWorkerReload() {
    if (!enabled() || !currentItem) return;
    workerReloadTimer = setTimeout(() => location.reload(), REFRESH_MS);
  }

  function startWorker() {
    if (!currentItem) return;

    if (!enabled()) {
      renderWorkerBadge('Paused');
      return;
    }

    setStatus(currentItem.tcin, `Watching @ ${new Date().toLocaleTimeString()}`);
    renderWorkerBadge(`Watching ${currentItem.tcin}`);

    const scan = () => {
      if (!enabled()) {
        stopWorkerTimers();
        renderWorkerBadge('Stopped');
        return;
      }

      const button = findPurchaseButton();
      if (button) handlePurchaseButton(button);
    };

    scan();
    workerScanTimer = setInterval(scan, BUTTON_SCAN_MS);
    scheduleWorkerReload();
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

  function clearOldStatuses() {
    for (const item of ITEMS) {
      localStorage.removeItem(`${KEY_STATUS_PREFIX}${item.tcin}`);
    }
  }

  async function startController() {
    ensureAudio();

    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) {}
    }

    clearOldStatuses();
    localStorage.removeItem(KEY_HIT);
    localStorage.setItem(KEY_ENABLED, '1');

    let opened = 0;
    for (const item of ITEMS) {
      const child = window.open(itemUrl(item), `tsw-${item.tcin}`);
      if (child) opened += 1;
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    globalStatus.textContent = opened === ITEMS.length
      ? `Running • ${opened} watch tabs opened`
      : `Running • opened ${opened}/${ITEMS.length}; allow Target pop-ups if needed`;

    refreshControllerRows();
  }

  function stopController() {
    localStorage.setItem(KEY_ENABLED, '0');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    globalStatus.textContent = 'Stopped';
    refreshControllerRows();
  }

  function handleHit(hit) {
    if (!hit || !hit.tcin) return;
    beep();
    setTimeout(beep, 180);
    document.title = `🟢 TARGET: ${hit.tcin}`;

    const message = hit.confirmed
      ? `${hit.tcin} was confirmed added to the Target cart.`
      : `${hit.tcin} became purchasable and Target's button was clicked. Verify the cart.`;

    globalStatus.textContent = message;
    startBtn.disabled = false;
    stopBtn.disabled = true;

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Target stock alert', {
          body: message,
          requireInteraction: true
        });
      } catch (_) {}
    }
  }

  function refreshControllerRows() {
    if (!rows) return;
    rows.innerHTML = '';

    for (const item of ITEMS) {
      const status = readStatus(item.tcin);
      const row = document.createElement('div');
      row.style.cssText = 'padding:5px 0;border-top:1px solid #ddd;font:12px/1.35 system-ui,sans-serif;';
      const statusText = status?.text || (enabled() ? 'Opening / waiting…' : 'Idle');
      row.innerHTML = `<b>${item.tcin}</b><br><span>${escapeHtml(statusText)}</span>`;
      rows.appendChild(row);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    }[c]));
  }

  function renderController() {
    const panel = document.createElement('div');
    panel.id = 'target-stockwatch-panel';
    panel.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:2147483647',
      'width:310px',
      'background:#fff',
      'color:#111',
      'border:2px solid #cc0000',
      'border-radius:10px',
      'box-shadow:0 4px 18px rgba(0,0,0,.25)',
      'padding:10px',
      'font:13px/1.4 system-ui,sans-serif'
    ].join(';');

    panel.innerHTML = `
      <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Target Stock Watch v0.4</div>
      <div id="tsw-global" style="margin-bottom:7px;">${enabled() ? 'Running' : 'Idle'}</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="tsw-start" style="cursor:pointer;padding:5px 9px;">Start</button>
        <button id="tsw-stop" style="cursor:pointer;padding:5px 9px;">Stop</button>
        <a href="https://www.target.com/cart" style="margin-left:auto;align-self:center;" target="_blank">Cart</a>
      </div>
      <div id="tsw-rows"></div>
      <div style="margin-top:7px;font-size:11px;color:#555;">
        Worker tabs refresh about every ${REFRESH_MS / 1000}s and use Target's own purchase button.
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

  let globalStatus = null;
  let startBtn = null;
  let stopBtn = null;
  let rows = null;

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

    // Handle a hit that may have happened while the controller tab was backgrounded.
    try {
      const existingHit = localStorage.getItem(KEY_HIT);
      if (existingHit) handleHit(JSON.parse(existingHit));
    } catch (_) {}
  }
})();
