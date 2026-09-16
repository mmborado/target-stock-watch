// ==UserScript==
// @name         Target TCIN Stock Watch + Auto Add to Cart
// @namespace    local.target.stockwatch
// @version      0.2
// @description  Poll selected Target TCINs by attempting Add to Cart. Stops and opens cart on first success.
// @match        https://www.target.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ---- CONFIG ----
  const ITEMS = [
    { tcin: '1010892076', label: 'Target item 1010892076' },
    { tcin: '1010892067', label: 'Target item 1010892067' },
    { tcin: '1010892068', label: 'Target item 1010892068' },
    { tcin: '1010892065', label: 'Target item 1010892065' },
    { tcin: '1010892069', label: 'Target item 1010892069' },
    { tcin: '1010892070', label: 'Target item 1010892070' },
  ];

  // Current frontend key observed in Target's RedSky/cart API documentation.
  // Target can rotate this; if every request suddenly starts failing, this is one thing to re-check.
  const API_KEY = '9f36aeafbe60771e321a7cc95a78140772ab3e96';

  // One cycle attempts all pending TCINs. 7.5s is intentionally not ultra-aggressive.
  const POLL_MS = 7500;
  const BETWEEN_ITEMS_MS = 250;

  // Stop everything after the first successful cart add, then open Target cart.
  const OPEN_CART_ON_SUCCESS = true;
  // ----------------

  const CART_ENDPOINT =
    `https://carts.target.com/web_checkouts/v1/cart_items` +
    `?field_groups=CART%2CCART_ITEMS%2CSUMMARY&key=${encodeURIComponent(API_KEY)}`;

  let running = false;
  let timer = null;
  let cycleCount = 0;
  let audioCtx = null;
  let backoffUntil = 0;
  const state = new Map(ITEMS.map(i => [i.tcin, { status: 'Idle', attempts: 0 }]));

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function nowTime() {
    return new Date().toLocaleTimeString();
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
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.55);
    } catch (_) {}
  }

  async function notifySuccess(item) {
    beep();
    beep();
    document.title = `🟢 IN CART: ${item.tcin}`;

    if ('Notification' in window) {
      try {
        if (Notification.permission === 'granted') {
          new Notification('Target item added to cart', {
            body: `${item.label} (${item.tcin}) was accepted into your cart.`,
            requireInteraction: true
          });
        }
      } catch (_) {}
    }
  }

  function setStatus(tcin, status) {
    const s = state.get(tcin);
    if (!s) return;
    s.status = status;
    renderRows();
  }

  async function tryAddToCart(item) {
    const s = state.get(item.tcin);
    s.attempts += 1;
    setStatus(item.tcin, `Checking… #${s.attempts}`);

    const payload = {
      cart_type: 'REGULAR',
      channel_id: '10',
      shopping_context: 'DIGITAL',
      cart_item: {
        item_channel_id: '10',
        tcin: item.tcin,
        quantity: 1
      }
    };

    let res;
    let text = '';
    let data = null;

    try {
      res = await fetch(CART_ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'x-application-name': 'web'
        },
        body: JSON.stringify(payload)
      });

      text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch (_) {}

      const success =
        res.ok &&
        (
          res.status === 201 ||
          data?.cart_id ||
          data?.cart_item_id ||
          data?.tcin === item.tcin
        );

      if (success) {
        setStatus(item.tcin, `✅ ADDED @ ${nowTime()}`);
        running = false;
        if (timer) clearTimeout(timer);
        await notifySuccess(item);

        console.log('[Target Watch] SUCCESS', { item, status: res.status, data });

        if (OPEN_CART_ON_SUCCESS) {
          setTimeout(() => {
            window.location.assign('https://www.target.com/cart');
          }, 1200);
        }
        return true;
      }

      if (res.status === 429) {
        backoffUntil = Date.now() + 30000;
        setStatus(item.tcin, `Rate limited — backing off 30s`);
      } else if (res.status === 401 || res.status === 403) {
        setStatus(item.tcin, `${res.status}: session/API rejected`);
      } else {
        setStatus(item.tcin, `Waiting (${res.status}) @ ${nowTime()}`);
      }

      console.debug('[Target Watch] Not cartable', {
        tcin: item.tcin,
        status: res.status,
        response: data || text
      });

      return false;
    } catch (err) {
      setStatus(item.tcin, `Network/CORS error @ ${nowTime()}`);
      console.warn('[Target Watch] Request failed', item.tcin, err);
      return false;
    }
  }

  async function cycle() {
    if (!running) return;

    if (Date.now() < backoffUntil) {
      const secs = Math.ceil((backoffUntil - Date.now()) / 1000);
      globalStatus.textContent = `Backoff: ${secs}s`;
      timer = setTimeout(cycle, 1000);
      return;
    }

    cycleCount += 1;
    globalStatus.textContent = `Running • cycle ${cycleCount} • ${nowTime()}`;

    for (const item of ITEMS) {
      if (!running) return;
      const hit = await tryAddToCart(item);
      if (hit) return;
      await sleep(BETWEEN_ITEMS_MS);
    }

    if (running) {
      const jitter = Math.floor(Math.random() * 1000) - 500;
      timer = setTimeout(cycle, Math.max(3000, POLL_MS + jitter));
    }
  }

  async function start() {
    if (running) return;
    ensureAudio();

    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) {}
    }

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    globalStatus.textContent = 'Starting…';
    cycle();
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    globalStatus.textContent = `Stopped • ${nowTime()}`;
  }

  function renderRows() {
    if (!rows) return;
    rows.innerHTML = '';
    for (const item of ITEMS) {
      const s = state.get(item.tcin);
      const row = document.createElement('div');
      row.style.cssText = 'padding:5px 0;border-top:1px solid #ddd;font:12px/1.35 system-ui,sans-serif;';
      row.innerHTML = `<b>${item.tcin}</b><br><span>${escapeHtml(s.status)}</span>`;
      rows.appendChild(row);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    }[c]));
  }

  const panel = document.createElement('div');
  panel.id = 'target-stockwatch-panel';
  panel.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:14px',
    'z-index:2147483647',
    'width:280px',
    'background:#fff',
    'color:#111',
    'border:2px solid #cc0000',
    'border-radius:10px',
    'box-shadow:0 4px 18px rgba(0,0,0,.25)',
    'padding:10px',
    'font:13px/1.4 system-ui,sans-serif'
  ].join(';');

  panel.innerHTML = `
    <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Target Stock Watch</div>
    <div id="tsw-global" style="margin-bottom:7px;">Idle</div>
    <div style="display:flex;gap:6px;margin-bottom:8px;">
      <button id="tsw-start" style="cursor:pointer;padding:5px 9px;">Start</button>
      <button id="tsw-stop" disabled style="cursor:pointer;padding:5px 9px;">Stop</button>
      <a href="https://www.target.com/cart" style="margin-left:auto;align-self:center;" target="_blank">Cart</a>
    </div>
    <div id="tsw-rows"></div>
    <div style="margin-top:7px;font-size:11px;color:#555;">
      Poll: ${POLL_MS / 1000}s • Stops on first successful add.
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

  console.log('[Target Watch] Loaded for TCINs:', ITEMS.map(i => i.tcin));
})();
