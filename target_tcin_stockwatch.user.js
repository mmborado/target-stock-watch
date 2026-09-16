// ==UserScript==
// @name         Target Stock Watch (Alert Only)
// @namespace    local.target.stockwatch
// @version      0.5
// @description  Read-only Target stock watcher. Alerts and opens the product page when a watched TCIN becomes purchasable.
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

  // Target frontend key observed in the current web client.
  const API_KEY = '9f36aeafbe60771e321a7cc95a78140772ab3e96';

  // Read-only RedSky fulfillment polling.
  const POLL_MS = 2000;
  const BETWEEN_ITEMS_MS = 100;
  const PRICING_STORE_ID = '2421';
  const BACKOFF_MS = 30000;

  const PURCHASABLE = new Set([
    'IN_STOCK',
    'LIMITED_STOCK',
    'PRE_ORDER_SELLABLE'
  ]);

  let running = false;
  let timer = null;
  let cycleCount = 0;
  let audioCtx = null;
  let alertWindow = null;
  let backoffUntil = 0;
  let stoppedByHit = false;

  const state = new Map(
    ITEMS.map(item => [item.tcin, { status: 'Idle', checks: 0 }])
  );

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nowTime = () => new Date().toLocaleTimeString();
  const productUrl = tcin => `https://www.target.com/p/A-${tcin}`;

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

  function openStandbyWindow() {
    try {
      if (alertWindow && !alertWindow.closed) return true;

      // Opened directly from the Start button click so Chrome is less likely
      // to block the eventual product-page navigation as a popup.
      alertWindow = window.open('about:blank', 'target-stock-hit');

      if (alertWindow) {
        try {
          alertWindow.document.title = 'Target Stock Watch — Standby';
          alertWindow.document.body.innerHTML = `
            <div style="font:16px system-ui,sans-serif;padding:24px;">
              Target Stock Watch is running.<br><br>
              This tab will open the product automatically when stock is detected.
            </div>
          `;
        } catch (_) {}
        return true;
      }
    } catch (_) {}

    return false;
  }

  function setStatus(tcin, status) {
    const entry = state.get(tcin);
    if (!entry) return;
    entry.status = status;
    renderRows();
  }

  function buildFulfillmentUrl(item) {
    const url = new URL(
      'https://redsky.target.com/redsky_aggregations/v1/web/pdp_fulfillment_v1'
    );
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('tcin', item.tcin);
    url.searchParams.set('is_bot', 'false');
    url.searchParams.set('pricing_store_id', PRICING_STORE_ID);
    return url.toString();
  }

  async function alertHit(item, availability, quantity) {
    stoppedByHit = true;
    running = false;
    if (timer) clearTimeout(timer);

    const qtyText = Number.isFinite(quantity) ? ` • qty ${quantity}` : '';
    const message = `${item.tcin} is ${availability}${qtyText}`;

    setStatus(item.tcin, `🟢 ${availability}${qtyText} @ ${nowTime()}`);
    globalStatus.textContent = `FOUND: ${message}`;
    document.title = `🟢 TARGET IN STOCK: ${item.tcin}`;

    beep();
    setTimeout(beep, 220);
    setTimeout(beep, 440);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notification = new Notification('Target item is in stock', {
          body: message,
          requireInteraction: true
        });
        notification.onclick = () => {
          window.focus();
          window.open(productUrl(item.tcin), '_blank');
          notification.close();
        };
      } catch (_) {}
    }

    try {
      if (alertWindow && !alertWindow.closed) {
        alertWindow.location.href = productUrl(item.tcin);
        alertWindow.focus();
      } else {
        window.open(productUrl(item.tcin), '_blank');
      }
    } catch (_) {
      // The product link in the panel remains available as a fallback.
    }

    startBtn.disabled = false;
    stopBtn.disabled = true;
  }

  async function checkItem(item) {
    const entry = state.get(item.tcin);
    entry.checks += 1;
    setStatus(item.tcin, `Checking… #${entry.checks}`);

    try {
      const res = await fetch(buildFulfillmentUrl(item), {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'accept': 'application/json'
        }
      });

      if (!res.ok) {
        setStatus(item.tcin, `API ${res.status} @ ${nowTime()}`);

        if (res.status === 429 || res.status === 403 || res.status >= 500) {
          backoffUntil = Date.now() + BACKOFF_MS;
        }
        return false;
      }

      const data = await res.json();
      const shipping = data?.data?.product?.fulfillment?.shipping_options;
      const availability = shipping?.availability_status || 'UNKNOWN';
      const quantity = shipping?.available_to_promise_quantity;
      const qtyText = Number.isFinite(quantity) ? ` • qty ${quantity}` : '';

      if (PURCHASABLE.has(availability)) {
        await alertHit(item, availability, quantity);
        return true;
      }

      setStatus(item.tcin, `${availability}${qtyText} @ ${nowTime()}`);
      return false;
    } catch (err) {
      setStatus(item.tcin, `Network error @ ${nowTime()}`);
      console.warn('[Target Watch] Check failed', item.tcin, err);
      return false;
    }
  }

  async function cycle() {
    if (!running) return;

    if (Date.now() < backoffUntil) {
      const seconds = Math.ceil((backoffUntil - Date.now()) / 1000);
      globalStatus.textContent = `Backoff: ${seconds}s`;
      timer = setTimeout(cycle, 1000);
      return;
    }

    cycleCount += 1;
    globalStatus.textContent = `Running • cycle ${cycleCount} • ${nowTime()}`;

    for (const item of ITEMS) {
      if (!running) return;
      const hit = await checkItem(item);
      if (hit || !running) return;
      await sleep(BETWEEN_ITEMS_MS);
    }

    if (running) {
      timer = setTimeout(cycle, POLL_MS);
    }
  }

  async function start() {
    if (running) return;

    ensureAudio();
    stoppedByHit = false;
    backoffUntil = 0;

    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) {}
    }

    const standbyOpened = openStandbyWindow();

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    globalStatus.textContent = standbyOpened
      ? 'Starting • auto-open window ready'
      : 'Starting • popup blocked; use product link if alerted';

    cycle();
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    globalStatus.textContent = stoppedByHit ? globalStatus.textContent : `Stopped • ${nowTime()}`;
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

  function renderRows() {
    if (!rows) return;
    rows.innerHTML = '';

    for (const item of ITEMS) {
      const entry = state.get(item.tcin);
      const row = document.createElement('div');
      row.style.cssText = 'padding:5px 0;border-top:1px solid #ddd;font:12px/1.35 system-ui,sans-serif;';
      row.innerHTML = `
        <a href="${productUrl(item.tcin)}" target="_blank"><b>${item.tcin}</b></a><br>
        <span>${escapeHtml(entry.status)}</span>
      `;
      rows.appendChild(row);
    }
  }

  const panel = document.createElement('div');
  panel.id = 'target-stockwatch-panel';
  panel.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:14px',
    'z-index:2147483647',
    'width:305px',
    'background:#fff',
    'color:#111',
    'border:2px solid #cc0000',
    'border-radius:10px',
    'box-shadow:0 4px 18px rgba(0,0,0,.25)',
    'padding:10px',
    'font:13px/1.4 system-ui,sans-serif'
  ].join(';');

  panel.innerHTML = `
    <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Target Stock Watch v0.5</div>
    <div id="tsw-global" style="margin-bottom:7px;">Idle</div>
    <div style="display:flex;gap:6px;margin-bottom:8px;">
      <button id="tsw-start" style="cursor:pointer;padding:5px 9px;">Start</button>
      <button id="tsw-stop" disabled style="cursor:pointer;padding:5px 9px;">Stop</button>
    </div>
    <div id="tsw-rows"></div>
    <div style="margin-top:7px;font-size:11px;color:#555;">
      Read-only • ~${POLL_MS / 1000}s between cycles • stops on first hit • no cart actions
    </div>
  `;

  document.body.appendChild(panel);

  const globalStatus = panel.querySelector('#tsw-global');
  const startBtn = panel.querySelector('#tsw-start');
  const stopBtn = panel.querySelector('#tsw-stop');
  const rows = panel.querySelector('#tsw-rows');

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);

  renderRows();
  console.log('[Target Watch] Loaded read-only watcher for:', ITEMS.map(i => i.tcin));
})();
