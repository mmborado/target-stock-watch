# Target Stock Watch

Tampermonkey userscript for watching specific Target product pages and using Target's own product-page purchase controls when an item becomes available.

## Watched TCINs

- `1010892076`
- `1010892067`
- `1010892068`
- `1010892065`
- `1010892069`
- `1010892070`

Edit the `ITEMS` array in `target_tcin_stockwatch.user.js` to add or remove products.

## Why v0.4 changed approach

The previous version called Target's cart API directly. A real Add-to-Cart request captured from Target showed additional dynamic `x-gyjwza5z-*` request headers that Target's frontend generates at runtime. Rather than trying to reproduce those headers, v0.4 uses Target's normal product page and clicks Target's own **Add to cart** or **Preorder now** button when it appears.

This means Target's own frontend creates the cart request, including whatever session and runtime headers it currently requires.

## What it does

- Runs on `target.com` while you are logged in.
- Uses one controller tab plus one worker tab for each watched TCIN.
- Worker tabs refresh about every 3 seconds.
- Each worker scans the rendered page for an enabled **Add to cart** or **Preorder now** button.
- When found, the worker clicks Target's own button.
- The script then looks briefly for an on-page cart confirmation.
- All workers stop after the first hit.
- The controller plays an alert sound and sends a desktop notification.
- The worker that found the item navigates to the Target cart.
- It does **not** submit checkout or place an order.

## Install

1. Install Tampermonkey in Chrome or another supported browser.
2. Open `target_tcin_stockwatch.user.js` in this repo.
3. Copy the full file contents into a new Tampermonkey userscript and save it.
4. Log into Target in the same browser.
5. Open any normal page on `https://www.target.com/`.
6. A **Target Stock Watch v0.4** panel should appear in the bottom-right corner.
7. Click **Start** and allow browser notifications if prompted.
8. If Chrome blocks some worker tabs, allow pop-ups for `target.com` and click Start again.

## Notifications

There are two possible alert messages:

- **Confirmed added** — Target displayed an on-page confirmation after the button click.
- **Purchase button clicked — verify cart** — the item became purchasable and Target's button was clicked, but the script did not see a reliable confirmation within the short confirmation window.

The second message is intentionally cautious; it does not claim that the cart addition succeeded when the page did not visibly confirm it.

## Notes

- The watcher uses normal Target pages instead of manually recreating Target's cart API request.
- Full product pages are heavier than a lightweight inventory endpoint, so the worker refresh interval is about 3 seconds rather than 1 second.
- Target can change page markup at any time. If the purchase-button text or structure changes, the button detection logic may need an update.
- Adding an item to a cart does not reserve inventory. Complete checkout manually.
