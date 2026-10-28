# Glanceshot for Node.js

Official SDK for the [Glanceshot](https://glanceshot.com) website screenshot API: turn any URL or HTML into a PNG, JPEG or WebP screenshot or a PDF. Chinese, Japanese and Korean text renders correctly, ads, cookie banners and pop-ups are removed by default, and you only pay for successful renders.

- Zero dependencies, about 8 KB
- Node.js 18+, plus edge runtimes with `fetch` and Web Crypto (Cloudflare Workers, Vercel Edge, Deno, Bun)
- ESM and CommonJS, with TypeScript types

```bash
npm install glanceshot
```

Get a free API key (100 screenshots a month) at [glanceshot.com](https://glanceshot.com/register).

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

Options use the same names as the [HTTP API](https://glanceshot.com/docs) in camelCase (`full_page` → `fullPage`, `wait_for_selector` → `waitForSelector`, …).

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

Use `type: "pdf"` for a PDF link.

## Pages behind a login

Install the Glanceshot browser extension, save your login on the site as a login profile with one click, then pass its ID:

```js
await glanceshot.screenshot({ url: "https://app.example.com/dashboard", loginProfile: "lp_8f2c…" });
```

If the login no longer works the call fails with `login_expired` and is not billed. Login profiles can't be used in signed URLs.

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

Webhooks may be delivered more than once; de-duplicate by `batch.id`.

## Usage

```js
const usage = await glanceshot.usage();
console.log(`${usage.used} / ${usage.limit} this month`);
```

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

## License

MIT
