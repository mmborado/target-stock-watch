// ==UserScript==
// @name         Target Stock Watch (Page Alert Only)
// @namespace    local.target.stockwatch
// @version      0.9
// @description  Uses two rotating Target product-page workers to watch six TCINs. Alerts only when a real purchase control is actionable and no Out of Stock state is visible.
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

  const WORKER_COUNT = 2;
  const SCAN_MS = 200;
  const MIN_SETTLE_MS = 1200;
  const REQUIRED_STABLE_SCANS = 3;
  const MAX_DWELL_MS = 3200;
  const ROTATE_DELAY_MS = 250;

  const KEY_ENABLED = 'tsw.enabled';
  const KEY_HIT = 'tsw.hit';
  const KEY_STATUS_PREFIX = 'tsw.status.';

  let audioCtx = null;
  let controllerTimer = null;
  let workerScanTimer = null;
  let rotateTimer = null;
  let hitThisLoad = false;
  let stableActionableScans = 0;
  let rotating = false;
  const workerStartedAt = Date.now();

  let globalStatus = null;
  let startBtn = null;
  let stopBtn = null;
  let rows = null;

  const params = new URLSearchParams(location.search);
  const isWorker = params.get('tsw_worker') === '1';
  const workerSlot = Number(params.get('slot'));
  const workerPos = Number(params.get('pos'));
  const currentTcin = getCurrentTcin();
  const currentItem = ITEMS.find(item => item.tcin === currentTcin) || null;

  function assignmentsForSlot(slot) {
    return ITEMS.filter((_, index) => index % WORKER_COUNT === slot);
  }

  function getCurrentTcin() {
    const match = location.pathname.match(/A-(\d+)/i);
    return match ? match[1] : null;
  }

  function productUrl(itemOrTcin) {
    const tcin = typeof itemOrTcin === 'string' ? itemOrTcin : itemOrTcin.tcin;
    return `https://www.target.com/p/A-${tcin}`;
  }

  function workerUrl(item, slot, pos) {
    return `${productUrl(item)}?tsw_worker=1&slot=${slot}&pos=${pos}`;
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

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 && rect.height > 0;
  }

  function pageShowsOutOfStock() {
    const directSelectors = [
      '[data-test*="outOfStock" i]',
      '[data-test*="out-of-stock" i]',
      '[data-test*="soldOut" i]',
      '[data-test*="sold-out" i]'
    ];

    for (const selector of directSelectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!visible(node)) continue;
        const text = normalizeText(node.innerText || node.textContent);
        if (/\bout of stock\b/i.test(text) || /\bsold out\b/i.test(text)) return true;
      }
    }

    const root = document.querySelector('main') || document.body;
    if (!root) return false;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = normalizeText(textNode.nodeValue);
      if (!/^(out of stock|sold out)[.!]?$/i.test(text)) continue;
      const parent = textNode.parentElement;
      if (!parent || !visible(parent)) continue;
      const rect = parent.getBoundingClientRect();
      if (rect.top > 2000 || rect.bottom < 0) continue;
      return true;
    }

    return false;
  }

  function resolveInteractiveControl(node) {
    if (!node) return null;
    if (node.matches?.('button, a, [role="button"]')) return node;
    return node.querySelector?.('button, a, [role="button"]') ||
      node.closest?.('button, a, [role="button"]') || null;
  }

  function isActuallyActionable(control) {
    if (!control || !visible(control)) return false;
    if (control.matches?.(':disabled')) return false;
    if ('disabled' in control && control.disabled) return false;
    if (control.hasAttribute?.('disabled')) return false;
    if ((control.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true') return false;

    const disabledAncestor = control.closest?.(
      '[aria-disabled="true"], [disabled], [data-disabled="true"]'
    );
    if (disabledAncestor && disabledAncestor !== control) return false;

    const style = getComputedStyle(control);
    if (style.pointerEvents === 'none') return false;

    const classText = `${control.className || ''} ${control.parentElement?.className || ''}`.toLowerCase();
    if (/\bdisabled\b/.test(classText)) return false;

    return true;
  }

  function candidateFromNode(node, selector) {
    const control = resolveInteractiveControl(node);
    if (!isActuallyActionable(control)) return null;
    const text = normalizeText(control.innerText || control.textContent || node.innerText || node.textContent);
    if (!/^(preorder now|preorder|ship it|add to cart|pick it up)$/i.test(text)) return null;
    return { el: control, text, selector };
  }

  function findPurchaseControl() {
    const selectors = [
      '[data-test="preorderButton"]',
      '[data-test="shipItButton"]',
      '[data-test="orderPickupButton"]',
      '[data-test="addToCartButton"]'
    ];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const candidate = candidateFromNode(node, selector);
        if (candidate) return candidate;
      }
    }

    for (const button of document.querySelectorAll('button, [role="button"]')) {
      if (!isActuallyActionable(button)) continue;
      const rect = button.getBoundingClientRect();
      if (rect.top > 1800) continue;
      const text = normalizeText(button.innerText || button.textContent);
      if (/^(preorder now|preorder|ship it|add to cart|pick it up)$/i.test(text)) {
        return { el: button, text, selector: 'text-fallback' };
      }
    }

    return null;
  }

  function stopWorkerTimers() {
    if (workerScanTimer) clearInterval(workerScanTimer);
    if (rotateTimer) clearTimeout(rotateTimer);
    workerScanTimer = null;
    rotateTimer = null;
  }

  function renderWorkerBadge(text) {
    let badge = document.getElementById('tsw-worker-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'tsw-worker-badge';
      badge.style.cssText = [
        'position:fixed','right:12px','bottom:12px','z-index:2147483647',
        'background:#fff','color:#111','border:2px solid #cc0000','border-radius:8px',
        'padding:7px 10px','font:12px/1.3 system-ui,sans-serif',
        'box-shadow:0 3px 12px rgba(0,0,0,.2)'
      ].join(';');
      document.body.appendChild(badge);
    }
    badge.textContent = `Target Watch: ${text}`;
  }

  function rotateToNext() {
    if (rotating || !enabled()) return;
    rotating = true;
    stopWorkerTimers();

    const assigned = assignmentsForSlot(workerSlot);
    if (!assigned.length) return;
    const safePos = Number.isInteger(workerPos) && workerPos >= 0 ? workerPos % assigned.length : 0;
    const nextPos = (safePos + 1) % assigned.length;
    const nextItem = assigned[nextPos];
    setStatus(nextItem.tcin, `Queued on worker ${workerSlot + 1} @ ${nowTime()}`);

    rotateTimer = setTimeout(() => {
      location.replace(workerUrl(nextItem, workerSlot, nextPos));
    }, ROTATE_DELAY_MS);
  }

  function emitHit(item, control) {
    if (hitThisLoad || !enabled() || pageShowsOutOfStock()) return;
    hitThisLoad = true;

    const hit = {
      tcin: item.tcin,
      label: item.label,
      buttonText: control.text || 'Purchasable',
      slot: workerSlot,
      at: Date.now()
    };

    setStatus(item.tcin, `🟢 ${hit.buttonText} actionable; no Out of Stock state @ ${nowTime()}`);
    localStorage.setItem(KEY_HIT, JSON.stringify(hit));
    localStorage.setItem(KEY_ENABLED, '0');
    stopWorkerTimers();
    renderWorkerBadge(`FOUND — ${hit.buttonText}`);
    try { window.focus(); } catch (_) {}
  }

  function startWorker() {
    if (!currentItem || !Number.isInteger(workerSlot) || workerSlot < 0 || workerSlot >= WORKER_COUNT) return;

    const assigned = assignmentsForSlot(workerSlot);
    if (!assigned.some(item => item.tcin === currentItem.tcin)) return;

    if (!enabled()) {
      renderWorkerBadge('Paused');
      return;
    }

    setStatus(currentItem.tcin, `Checking on worker ${workerSlot + 1} @ ${nowTime()}`);
    renderWorkerBadge(`Checking ${currentItem.tcin}`);

    const scan = () => {
      if (!enabled()) {
        stopWorkerTimers();
        renderWorkerBadge('Stopped');
        return;
      }

      const elapsed = Date.now() - workerStartedAt;
      if (elapsed < MIN_SETTLE_MS) return;

      if (pageShowsOutOfStock()) {
        stableActionableScans = 0;
        setStatus(currentItem.tcin, `Out of Stock @ ${nowTime()}`);
        renderWorkerBadge(`${currentItem.tcin}: Out of Stock`);
        rotateToNext();
        return;
      }

      const control = findPurchaseControl();
      if (control) {
        stableActionableScans += 1;
        setStatus(
          currentItem.tcin,
          `${control.text} actionable (${stableActionableScans}/${REQUIRED_STABLE_SCANS}) @ ${nowTime()}`
        );

        if (stableActionableScans >= REQUIRED_STABLE_SCANS && !pageShowsOutOfStock()) {
          emitHit(currentItem, control);
        }
        return;
      }

      stableActionableScans = 0;
      if (elapsed >= MAX_DWELL_MS) {
        setStatus(currentItem.tcin, `No actionable purchase control @ ${nowTime()}`);
        renderWorkerBadge(`${currentItem.tcin}: no stock signal`);
        rotateToNext();
      }
    };

    scan();
    workerScanTimer = setInterval(scan, SCAN_MS);
  }

  async function startController() {
    ensureAudio();

    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) {}
    }

    clearStatuses();
    localStorage.removeItem(KEY_HIT);
    localStorage.setItem(KEY_ENABLED, '1');

    for (let slot = 0; slot < WORKER_COUNT; slot++) {
      for (const item of assignmentsForSlot(slot)) {
        setStatus(item.tcin, `Queued on worker ${slot + 1}`);
      }
    }

    let opened = 0;
    for (let slot = 0; slot < WORKER_COUNT; slot++) {
      const assigned = assignmentsForSlot(slot);
      const child = window.open(workerUrl(assigned[0], slot, 0), `tsw-worker-${slot}`);
      if (child) opened += 1;
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    globalStatus.textContent = opened === WORKER_COUNT
      ? `Running • ${WORKER_COUNT} rotating workers covering all ${ITEMS.length} products`
      : `Running • ${opened}/${WORKER_COUNT} workers opened; allow pop-ups for target.com`;

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

    try {
      const name = Number.isInteger(hit.slot) ? `tsw-worker-${hit.slot}` : '_blank';
      const productWindow = window.open(productUrl(hit.tcin), name);
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
            const name = Number.isInteger(hit.slot) ? `tsw-worker-${hit.slot}` : '_blank';
            const productWindow = window.open(productUrl(hit.tcin), name);
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
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function refreshControllerRows() {
    if (!rows) return;
    rows.innerHTML = '';

    for (const item of ITEMS) {
      const status = readStatus(item.tcin);
      const row = document.createElement('div');
      row.style.cssText = 'padding:5px 0;border-top:1px solid #ddd;font:12px/1.35 system-ui,sans-serif;';
      const statusText = status?.text || (enabled() ? 'Queued' : 'Idle');
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
      'position:fixed','right:14px','bottom:14px','z-index:2147483647','width:330px',
      'background:#fff','color:#111','border:2px solid #cc0000','border-radius:10px',
      'box-shadow:0 4px 18px rgba(0,0,0,.25)','padding:10px','font:13px/1.4 system-ui,sans-serif'
    ].join(';');

    panel.innerHTML = `
      <div style="font-weight:800;font-size:14px;margin-bottom:4px;">Target Stock Watch v0.9</div>
      <div id="tsw-global" style="margin-bottom:7px;">${enabled() ? 'Running' : 'Idle'}</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="tsw-start" style="cursor:pointer;padding:5px 9px;">Start</button>
        <button id="tsw-stop" style="cursor:pointer;padding:5px 9px;">Stop</button>
      </div>
      <div id="tsw-rows"></div>
      <div style="margin-top:7px;font-size:11px;color:#555;">
        2 rotating workers • 3 products each • Out of Stock veto • no cart/API actions
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

  if (isWorker) {
    startWorker();
  } else {
    renderController();
    try {
      const existingHit = localStorage.getItem(KEY_HIT);
      if (existingHit) handleHit(JSON.parse(existingHit));
    } catch (_) {}
  }
})();
