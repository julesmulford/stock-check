# Price drop monitor

Once a day, a GitHub Actions workflow visits each product page in [src/targets.ts](src/targets.ts). It reads the price and stock status, compares them with the last recorded price in [data/prices.json](data/prices.json), and sends an email when a price has dropped. It also sends an email if a target fails three runs in a row, because that usually means a page or selector has changed.

- Runs every day at 06:00 UTC, which is 07:00 UK time in summer and 06:00 in winter, and on demand from the Actions tab.
- Visits pages one at a time with a pause between them, using an ordinary desktop Chromium. It doesn't work around bot protection: blocked sites are flagged in the run summary.
- Sends one combined email per run, and only when something dropped or broke. Price rises are recorded in the history without an alert.
- Every run writes a results table to the job summary.

## How prices are read

For each page the monitor dismisses any cookie banner, runs the target's variant steps if it has any (for example, choosing Indigo in a colour selector), and then takes the price from the first source that works:

1. **JSON-LD** `Product` / `Offer` data (including `@graph`, `ProductGroup` → `hasVariant` and `priceSpecification`).
2. **`itemprop="price"`** microdata, then **`og:price:amount` / `product:price:amount`** meta tags.
3. The target's **CSS selectors**, tried in order. The first visible match wins.

On pages that cover several variants, the JSON-LD and meta tags usually describe the page as a whole rather than the selected colour. For targets with variant steps, the monitor therefore uses JSON-LD only when `variant.offerMatch` identifies the variant's own offer, for example by GTIN. Otherwise it reads the displayed price with the CSS selectors after the selection.

The currency is recorded with every price, and prices are only compared within the same currency. If a target's currency changes, the new price becomes the baseline.

## Setup

1. Push this repo to GitHub.
2. Add the secrets below under **Settings → Secrets and variables → Actions**.
3. Under **Settings → Actions → General → Workflow permissions**, allow **Read and write**, so the workflow can commit `data/prices.json`.
4. Run the workflow once from the **Actions** tab (**Price monitor → Run workflow**), with **Dry run** ticked, to check the results table.

### Secrets

| Secret | Required | Example |
|---|---|---|
| `SMTP_HOST` | yes | `smtp.gmail.com` |
| `SMTP_PORT` | no (default `465`) | `465` (SSL) or `587` (STARTTLS) |
| `SMTP_USER` | usually | your Gmail address |
| `SMTP_PASS` | usually | a Gmail [app password](https://myaccount.google.com/apppasswords) (needs 2-step verification), not your normal password |
| `SMTP_FROM` | no (defaults to `SMTP_USER`) | `Price monitor <you@gmail.com>` |
| `ALERT_EMAIL_TO` | yes | the address that should receive alerts |
| `TELEGRAM_BOT_TOKEN` | optional | from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | optional | your chat ID (send the bot a message, then open `https://api.telegram.org/bot<token>/getUpdates`) |

Telegram is only used when both Telegram secrets are set. If a run has something to report but no channel is configured, or the email fails to send, the job fails and doesn't save state, so the next run reports the same drop again.

## Running locally

```sh
npm ci
npx playwright install chromium
npm test
npm run dry-run                                     # all targets; nothing saved or sent
npx tsx src/main.ts --dry-run --only=kef-uk-s3-indigo,unilet-kef-s3-indigo
```

The dry run prints each target's price, stock, source and diagnostic notes. It also compares against the saved state and shows the email it would have sent. To send for real locally, set the same variables as the secrets and run `npm run monitor`.

## Adding or removing a target

Edit [src/targets.ts](src/targets.ts).

- **Add**: append an entry with a unique `id`, a `name`, `retailer`, `url` and `group`. Run `npx tsx src/main.ts --dry-run --only=<id>` and check the price and source.
  - If the page covers several variants, add `variant.steps`. These can be `select` (a `<select>` value), `click` (a swatch or label) or `expectValue` (confirms that a selection took effect). If the page's JSON-LD lists each variant separately, set `variant.offerMatch` to a regex matching that variant's SKU or GTIN. If it doesn't, add `selectors` for the displayed price.
  - If the structured data is missing or wrong, add `selectors` (and optionally a `stockSelector`).
  - If a cookie banner isn't dismissed automatically, set `cookieSelector` to the button that closes it.
- **Pause**: set `enabled: false`.
- **Remove**: delete the entry. Its history is removed from `data/prices.json` on the next run.

Keep a target's `id` unchanged once it has history. The `id` is the key in `data/prices.json`.

## State file

`data/prices.json` stores the following for each target:
- the latest price, currency and stock status
- when it was last checked and last succeeded
- its failure streak
- up to 30 history entries, one each time the price, currency or stock status changes

The workflow commits this file after each run. That also keeps the repo active, so GitHub doesn't pause the schedule after 60 days of inactivity.

## Notes on the current targets

- **Switched off (`enabled: false`) and tracked with Visualping instead**:
  - **Made.com** returns HTTP 403 "Access Denied" from its bot protection (Akamai), from home connections as well as GitHub.
  - **Unilet** and **Hi-Fi Corner** load normally from a home connection, but Cloudflare shows GitHub's servers a "Just a moment..." challenge.

  The Visualping URLs (the WooCommerce ones open with Indigo already selected):
  - https://www.made.com/style/sv045562/h01099
  - https://unilet.net/product/kef-s3-floor-stands/?attribute_pa_colour=indigo-matte-special-edition
  - https://www.hificorner.co.uk/product/kef-s3-floor-stand/?attribute_pa_standard_colour_options=indigo-matte-special-edition
- **Peter Tyson**: the generic URL is a single-colour product, "KEF S3 Floor Stands - Indigo Blue" (SKU `KEFS3STDBLUE`). No selection is needed.
- **HBH Woolacotts** redirects to its clearance section.
- **Audio Lounge** has one price for all colours. Its colour `<select>` is hidden behind swatch buttons, so the monitor clicks the Indigo swatch and checks that it registered.
- **Apollon Audio** prices exclude EU VAT. Cover colour doesn't change the price. Op-amp options do: Sonic Imagery 994 adds €200 and Sparkos Labs SS2590 PRO adds €400. Mains voltage and binding posts are free choices. The monitor tracks the base price.
- **Audiophonics**: tracks the LPA-S450ET (Purifi 1ET6525SA), which replaced the discontinued LPA-S400ET (1ET400A). Prices include VAT, and the page has no options that change the price.
- **Nord Acoustics**: the monitor tracks the base price with the default options. Paid add-ons:
  - SE case +£150
  - dual SMPS1200A400 PSUs +£175
  - 12V trigger +£50
  - switchable XLR & RCA inputs +£75
  - WBT 0703Cu binding posts +£80
  - Neotech UP-OCC output wire +£30
  - 5-year warranty +15%

  A rackmount front (standard case only) is also offered, with no surcharge shown.
