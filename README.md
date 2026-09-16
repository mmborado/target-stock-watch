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

## Current behavior (v0.9)

The watcher is **page-based and alert-only**.

It does not call Target's cart API, does not call the old RedSky stock endpoint, does not add anything to your cart, and does not attempt checkout.

### Two rotating workers

v0.9 uses only **two worker tabs** instead of trying to open six tabs at once. This avoids Chrome blocking the later pop-ups.

The six watched products are split between the two workers:

- Worker 1 rotates through 3 products.
- Worker 2 rotates through the other 3 products.

Each product moves through visible statuses such as `Queued`, `Checking`, `Out of Stock`, or `No actionable purchase control`, so every TCIN should eventually show that it has been checked.

Each worker spends a few seconds on a product page, evaluates it, then navigates to the next assigned TCIN. A given product is therefore checked roughly once per worker rotation rather than having its own permanent tab.

## Availability checks

An alert can fire only when all of the following are true:

1. The actual interactive purchase control is enabled/actionable.
2. The page does **not** visibly show **Out of Stock** or **Sold Out** in the main product area.
3. The page has had a short settle period so Target's availability UI can finish rendering.
4. The purchase control remains actionable across multiple consecutive scans.

If a visible **Out of Stock** state is present, it overrides any apparent purchase button and the watcher reports `Out of Stock` instead of alerting.

When a product passes those checks, the script:

1. Stops both workers.
2. Plays three alert beeps.
3. Sends a persistent desktop notification if browser notifications are allowed.
4. Changes the controller tab title to identify the TCIN.
5. Opens/focuses the worker tab on the matching Target product page.

## Install

1. Install Tampermonkey in Chrome or another supported browser.
2. Open `target_tcin_stockwatch.user.js` in this repo.
3. Copy the full file contents into a new Tampermonkey userscript and save it.
4. Log into Target in the same browser.
5. Open any normal page on `https://www.target.com/`.
6. A **Target Stock Watch v0.9** panel should appear in the bottom-right corner.
7. Click **Start**.
8. Allow browser notifications when prompted.
9. The script should open two worker tabs. If fewer than two open, allow pop-ups for `target.com` and click **Start** again.

## Notes

- Full product-page checks are heavier than lightweight API polling, so each TCIN is checked on a rotating cadence rather than every second.
- Target can change product-page markup at any time. If availability text or purchase-button structure changes, detection logic may need another update.
- The script never performs a cart or checkout action.
