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

## Current behavior (v0.8)

The watcher is **page-based and alert-only**.

It does not call Target's cart API, does not call the old RedSky stock endpoint, does not add anything to your cart, and does not attempt checkout.

When you click **Start**, the controller opens one Target product-page worker tab for each watched TCIN. Each worker reloads about every 3 seconds and looks for a purchase control such as **Preorder now**, **Ship it**, **Add to cart**, or **Pick it up**.

v0.8 requires all of the following before an alert can fire:

1. The actual interactive purchase control is enabled/actionable.
2. The page does **not** visibly show **Out of Stock** or **Sold Out** in the main product area.
3. The page has had a short settle period so availability UI can finish rendering.
4. The purchase control remains actionable across multiple consecutive scans.

If a visible **Out of Stock** state is present, it overrides any apparent purchase button and the worker reports `Out of Stock` instead of alerting.

When the first watched product passes those checks, the script:

1. Stops all watchers.
2. Plays three alert beeps.
3. Sends a persistent desktop notification if browser notifications are allowed.
4. Changes the controller tab title to identify the TCIN.
5. Opens/focuses the matching product worker tab so the Target product page is ready for you.

## Install

1. Install Tampermonkey in Chrome or another supported browser.
2. Open `target_tcin_stockwatch.user.js` in this repo.
3. Copy the full file contents into a new Tampermonkey userscript and save it.
4. Log into Target in the same browser.
5. Open any normal page on `https://www.target.com/`.
6. A **Target Stock Watch v0.8** panel should appear in the bottom-right corner.
7. Click **Start**.
8. Allow browser notifications when prompted.
9. If Chrome blocks some of the six worker tabs, allow pop-ups for `target.com` and click **Start** again.

## Notes

- Product-page refreshes are heavier than lightweight API polling, so the refresh cadence is about 3 seconds rather than 1 second.
- Target can change product-page markup at any time. If availability text or purchase-button structure changes, detection logic may need another update.
- The script never performs a cart or checkout action.
