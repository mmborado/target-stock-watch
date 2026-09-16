# Target Stock Watch

A small Tampermonkey userscript for watching specific Target TCINs and attempting to add them to the cart as soon as Target's cart service accepts them.

## Watched TCINs

- `1010892076`
- `1010892067`
- `1010892068`
- `1010892065`
- `1010892069`
- `1010892070`

Edit the `ITEMS` array in `target_tcin_stockwatch.user.js` to add or remove products.

## What it does

- Runs on `target.com` while you are logged in.
- Checks the configured TCINs on a fast loop with about a 2-second delay between completed cycles.
- Uses Target's cart endpoint as the practical availability test.
- If a product is accepted into the cart, it stops polling, plays an alert, sends a browser notification, and opens the Target cart.
- If Target returns HTTP `429`, it backs off for 30 seconds before trying again.
- It does **not** submit checkout or place an order.

## Install

1. Install Tampermonkey in Chrome or another supported browser.
2. Open `target_tcin_stockwatch.user.js` in this repo.
3. Copy the full file contents into a new Tampermonkey userscript and save it.
4. Log into Target in the same browser.
5. Open any page on `https://www.target.com/`.
6. A **Target Stock Watch** panel should appear in the bottom-right corner.
7. Click **Start** and allow browser notifications if prompted.

## Status messages

- `Waiting (400)` or another non-2xx response generally means the item was not accepted by the cart during that attempt.
- `429` means Target rate-limited the request; the script automatically pauses for 30 seconds.
- `401` / `403` means the session or API request was rejected and the request format may need to be updated.
- `Network/CORS error` means the browser blocked or failed the request.
- `✅ ADDED` means Target accepted that TCIN into the cart.

For debugging, open Chrome DevTools → **Console**. The script logs responses under `[Target Watch]`.

## Notes

Target's frontend/cart APIs are not a stable public API and can change without notice. If the watcher stops working, the best troubleshooting step is to compare the script's request with a normal Add to Cart request made by Target's current website in Chrome DevTools → Network.

Adding an item to a cart does not reserve inventory. Complete checkout manually if the item becomes available.
