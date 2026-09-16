# Target Stock Watch

Tampermonkey userscript for watching specific Target TCINs and alerting when one becomes purchasable.

## Watched TCINs

- `1010892076`
- `1010892067`
- `1010892068`
- `1010892065`
- `1010892069`
- `1010892070`

Edit the `ITEMS` array in `target_tcin_stockwatch.user.js` to add or remove products.

## Current behavior (v0.5)

The watcher is now **read-only**. It does not add anything to your cart and does not attempt checkout.

It polls Target's RedSky fulfillment data for each TCIN and treats these shipping statuses as purchasable:

- `IN_STOCK`
- `LIMITED_STOCK`
- `PRE_ORDER_SELLABLE`

When the first watched item becomes purchasable, the script:

1. Stops polling.
2. Plays three alert beeps.
3. Sends a persistent desktop notification (if browser notifications are allowed).
4. Changes the Target tab title to identify the TCIN.
5. Automatically opens the matching Target product page in a standby tab/window.

## Auto-open window

When you click **Start**, the script opens a small blank standby tab/window immediately. This happens as part of your click, which makes Chrome less likely to block it as a popup.

That standby window stays open while the watcher runs. When stock is detected, it automatically navigates to the matching Target product page.

If Chrome blocks the standby window, allow pop-ups for `target.com` and click **Start** again. The product links shown in the watcher panel remain available as a fallback.

## Polling

- About 2 seconds between completed watch cycles.
- About 100 ms between individual TCIN checks.
- If Target responds with `429`, `403`, or a server error, the watcher backs off for 30 seconds instead of continuing to hammer the endpoint.

Target's RedSky API is an undocumented frontend backend and can change without notice. The availability field currently used is:

`data.product.fulfillment.shipping_options.availability_status`

## Install

1. Install Tampermonkey in Chrome or another supported browser.
2. Open `target_tcin_stockwatch.user.js` in this repo.
3. Copy the full file contents into a new Tampermonkey userscript and save it.
4. Log into Target in the same browser.
5. Open any normal page on `https://www.target.com/`.
6. A **Target Stock Watch v0.5** panel should appear in the bottom-right corner.
7. Click **Start**.
8. Allow browser notifications and pop-ups for Target if prompted.

## Status messages

- `OUT_OF_STOCK` — not currently purchasable for shipping.
- `IN_STOCK` — online stock detected.
- `LIMITED_STOCK` — limited stock detected.
- `PRE_ORDER_SELLABLE` — preorder is currently purchasable.
- `API 429` / `API 403` — Target rejected or throttled the request; the watcher pauses before retrying.
- `Network error` — the browser could not complete the stock request.

No cart or checkout actions are performed by this version.
