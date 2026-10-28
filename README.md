# Glanceshot for Node.js

[Website](https://glanceshot.com) · [API docs](https://glanceshot.com/docs) · [Pricing](https://glanceshot.com/pricing) · [Use cases](https://glanceshot.com/use-cases) · [Try it online](https://glanceshot.com/#try) · [Get a free API key](https://glanceshot.com/register)

Official SDK for the [Glanceshot](https://glanceshot.com) website screenshot API: turn any URL or HTML into a PNG, JPEG or WebP screenshot or a PDF. Chinese, Japanese and Korean text renders correctly, ads, cookie banners and pop-ups are removed by default, and you only pay for successful renders.

- Zero dependencies, about 8 KB
- Node.js 18+, plus edge runtimes with `fetch` and Web Crypto (Cloudflare Workers, Vercel Edge, Deno, Bun)
- ESM and CommonJS, with TypeScript types

```bash
npm install glanceshot
```

Get a free API key (100 screenshots a month) at [glanceshot.com](https://glanceshot.com/register), or [try a screenshot in your browser](https://glanceshot.com/#try) first, no sign-up needed.

## Quick start

```js
import { Glanceshot } from "glanceshot";
import { writeFile } from "node:fs/promises";

const glanceshot = new Glanceshot({ apiKey: process.env.GLANCESHOT_KEY });

const shot = await glanceshot.screenshot({
  url: "https://example.com",
  fullPage: true,
  format: "webp",
});
await writeFile("example.webp", shot.data);
```

CommonJS works too: `const { Glanceshot } = require("glanceshot");`

## Screenshots

```js
// Image bytes
const { data, contentType, cacheHit } = await glanceshot.screenshot({
  url: "https://example.com",
  viewportWidth: 1280,
  viewportHeight: 800,
  deviceScaleFactor: 2,   // retina
  darkMode: true,
  hideSelectors: ".chat-widget",
});

// Thumbnail: scale the output down to 400 px wide, cropped to 300 px tall
await glanceshot.screenshot({ url: "https://example.com", imageWidth: 400, imageHeight: 300 });

// A single element
await glanceshot.screenshot({ url: "https://example.com", selector: "#pricing" });

// Raw HTML
await glanceshot.screenshot({ html: "<h1>Hello 世界</h1>", format: "png" });

// Store the file and get its URL plus metadata instead of the bytes
const file = await glanceshot.screenshotUrl({ url: "https://example.com" });
console.log(file.url, file.width, file.height, file.cacheHit);
```

Options use the same names as the [HTTP API](https://glanceshot.com/docs#screenshot) in camelCase (`full_page` → `fullPage`, `wait_for_selector` → `waitForSelector`, …).

## PDFs

```js
const pdf = await glanceshot.pdf({ url: "https://example.com", paper: "a4", printBackground: true });
await writeFile("example.pdf", pdf.data);

const stored = await glanceshot.pdfUrl({ url: "https://example.com" });
```

A PDF counts as 2 requests.

## Signed URLs for `<img src>`

Generate the URL on your server and put it straight into a page. It contains only your public key ID and a signature: your API key and secret are never exposed, and changing any parameter invalidates it. Repeated views are served from the cache and are not billed.

```js
const glanceshot = new Glanceshot({
  keyId: process.env.GLANCESHOT_KEY_ID,   // glk_…
  secret: process.env.GLANCESHOT_SECRET,  // glss_…
});

const src = await glanceshot.signedUrl({
  url: "https://example.com",
  imageWidth: 600,
  expires: new Date(Date.now() + 7 * 24 * 3600 * 1000), // optional
});
// <img src={src} alt="Preview of example.com">
```

Use `type: "pdf"` for a PDF link. See [signed URLs](https://glanceshot.com/docs#signed-url) in the API docs.

## Pages behind a login

Screenshot dashboards, admin panels, reports and other pages that need you to be signed in, using a **login profile**:

1. Sign in to the [Glanceshot console](https://glanceshot.com/dashboard), open [Login profiles](https://glanceshot.com/dashboard/profiles), install the Glanceshot browser extension (Chrome or Edge) and click **Connect extension**.
2. Open the website you want to capture in the same browser and sign in as usual.
3. Click the Glanceshot icon in the toolbar and choose **Save login profile**. The profile appears in the console with its ID (`lp_…`).
4. Pass the ID with your calls:

```js
await glanceshot.screenshot({ url: "https://app.example.com/dashboard", loginProfile: "lp_8f2c…" });

// Works in batches too, e.g. a nightly snapshot of every report page
await glanceshot.batches.create({
  urls: ["https://app.example.com/reports/sales", "https://app.example.com/reports/traffic"],
  options: { loginProfile: "lp_8f2c…", fullPage: true },
});
```

- Login profiles are stored encrypted, can't be read back, and are only sent to the site they belong to.
- Turn on auto-sync in the extension to keep a profile fresh while you stay signed in.
- If the login no longer works the call fails with `login_expired` and is not billed. Sign in again and save the profile again.
- Some sites only accept a login on your own computer. For those, open the page and use **Capture and upload** in the extension instead.
- Login profiles can't be used in signed URLs.

Details: [Pages behind a login](https://glanceshot.com/docs#login) in the API docs.

## Your own proxy

To see a page as visitors from a specific country do, route the render through a proxy you own (SOCKS5 or HTTP, with or without a password). Server-side calls only:

```js
await glanceshot.screenshot({ url: "https://shop.example.com", proxy: "socks5://user:pass@203.0.113.10:1080" });
```

Proxies can't be used in signed URLs or batches. See [using a proxy](https://glanceshot.com/docs#proxy).

## Batches and webhooks

```js
const batch = await glanceshot.batches.create({
  urls: ["https://example.com", "https://example.org"],
  options: { fullPage: true, format: "webp" },
  webhookUrl: "https://your.app/glanceshot-webhook", // optional
});

const done = await glanceshot.batches.wait(batch.id); // or poll batches.get(batch.id)
for (const item of done.items) console.log(item.url, item.result?.url ?? item.error?.code);
```

Verify webhook requests with the **raw** request body:

```js
import { verifyWebhook } from "glanceshot";

// Express: app.post("/glanceshot-webhook", express.raw({ type: "application/json" }), handler)
const ok = await verifyWebhook(req.body, req.headers["x-glanceshot-signature"], process.env.GLANCESHOT_SECRET);
if (!ok) return res.sendStatus(401);
const event = JSON.parse(req.body); // { event: "batch.completed", batch: {...} }
```

Webhooks may be delivered more than once; de-duplicate by `batch.id`. See [batches](https://glanceshot.com/docs#batch) and [webhooks](https://glanceshot.com/docs#webhook) in the API docs.

## Usage

```js
const usage = await glanceshot.usage();
console.log(`${usage.used} / ${usage.limit} this month`);
```

Plans and limits: [pricing](https://glanceshot.com/pricing) and [rate limits](https://glanceshot.com/docs#limits).

## Errors

Failed calls throw a `GlanceshotError` with a stable `code` (see the [error list](https://glanceshot.com/docs#errors)):

```js
import { GlanceshotError } from "glanceshot";

try {
  await glanceshot.screenshot({ url: "https://example.com" });
} catch (e) {
  if (e instanceof GlanceshotError) {
    console.log(e.code, e.status, e.message, e.requestId);
    if (e.code === "rate_limited") await new Promise((r) => setTimeout(r, (e.retryAfter ?? 1) * 1000));
  }
}
```

Failed renders (timeouts, sites returning errors, bot-check pages) are never billed.

## Options

| Client option | Default | |
|---|---|---|
| `apiKey` | — | For screenshots, PDFs, batches, usage. Server-side only. |
| `keyId`, `secret` | — | For `signedUrl()` and `verifyWebhook()`. Keep `secret` server-side. |
| `baseUrl` | `https://glanceshot.com` | |
| `timeoutMs` | `60000` | Per request. |
| `fetch` | global `fetch` | Custom implementation. |

## Links

- [Glanceshot](https://glanceshot.com): website screenshot API
- [API documentation](https://glanceshot.com/docs)
- [Use cases](https://glanceshot.com/use-cases): link previews, archiving, monitoring, reports and more
- [Pricing](https://glanceshot.com/pricing)
- Support: [support@glanceshot.com](mailto:support@glanceshot.com)

## License

MIT
