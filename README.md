# Target Stock Watch

Tampermonkey userscript for watching specific Target product pages and alerting when one becomes purchasable.

## Watched TCINs

- `1010892076`
- `1010892067`
- `1010892068`
- `1010892065`
- `1010892069`
- `1010892070`

Edit the `ITEMS` array in `target_tcin_stockwatch.user.js` to add or remove products.

## Current behavior (v0.6)

The watcher is **page-based and alert-only**.

It does not call Target's cart API, does not call the old RedSky stock endpoint, does not add anything to your cart, and does not attempt checkout.

When you click **Start**, the controller opens one Target product-page worker tab for each watched TCIN. Each worker:

- reloads its own product page about every 3 seconds;
- scans the rendered product page for an enabled purchase control such as **Preorder now**, **Ship it**, **Add to cart**, or **Pick it up**;
- uses Target-specific `data-test` hooks first, with a text fallback near the main product area;
- never clicks the purchase control.

When the first watched product becomes purchasable, the script:

1. Stops all watchers.
2. Plays three alert beeps.
3. Sends a persistent desktop notification if browser notifications are allowed.
4. Changes the controller tab title to identify the TCIN.
5. Opens/focuses the matching product worker tab so the Target product page is ready for you.

## Why this version changed approach

Previous versions tried Target frontend APIs directly. The cart endpoint required dynamic runtime headers and the RedSky fulfillment endpoint later returned HTTP `410 Gone`.

v0.6 avoids those unstable API dependencies and watches the same rendered product page you would use manually.

## Install

1. Install Tampermonkey in Chrome or another supported browser.
2. Open `target_tcin_stockwatch.user.js` in this repo.
3. Copy the full file contents into a new Tampermonkey userscript and save it.
4. Log into Target in the same browser.
5. Open any normal page on `https://www.target.com/`.
6. A **Target Stock Watch v0.6** panel should appear in the bottom-right corner.
7. Click **Start**.
8. Allow browser notifications when prompted.
9. If Chrome blocks some of the six worker tabs, allow pop-ups for `target.com` and click **Start** again.

## What you should see

The controller panel will show each TCIN with a status such as:

- `Opening / waiting…`
- `Watching page @ 12:34:56 AM`
- `🟢 Preorder now found @ 12:35:02 AM`

When an item hits, its product page is brought forward automatically.

## Notes

- Full product-page refreshes are heavier than lightweight API polling, so the refresh cadence is about 3 seconds rather than 1 second.
- Target can change product-page markup at any time. If purchase-button text or `data-test` attributes change, detection logic may need an update.
- The script never performs a cart or checkout action.
