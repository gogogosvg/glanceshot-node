// Real calls against a running Glanceshot server. Skipped unless the env vars are set.
//
//   GLANCESHOT_BASE_URL  e.g. https://glanceshot.com
//   GLANCESHOT_KEY / GLANCESHOT_KEY_ID / GLANCESHOT_SECRET   from a test account
//   WEBHOOK_URL / WEBHOOK_LOG   optional: a public webhook receiver and the JSON Lines file it writes
//
// The free plan allows 2 requests per second, so calls are spaced out.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Glanceshot, GlanceshotError, verifyWebhook } from "../src/index.ts";

const env = process.env;
const skip = !(env.GLANCESHOT_BASE_URL && env.GLANCESHOT_KEY && env.GLANCESHOT_KEY_ID && env.GLANCESHOT_SECRET);
const g = new Glanceshot({
  apiKey: env.GLANCESHOT_KEY,
  keyId: env.GLANCESHOT_KEY_ID,
  secret: env.GLANCESHOT_SECRET,
  baseUrl: env.GLANCESHOT_BASE_URL,
});
const pause = () => new Promise((r) => setTimeout(r, 700));
// A unique page each run, so the first request is always a cache miss
const target = `https://example.com/?sdk=${Date.now()}`;

function pngSize(b: Uint8Array) {
  assert.deepEqual([...b.slice(1, 4)], [0x50, 0x4e, 0x47], "not a PNG");
  const v = new DataView(b.buffer, b.byteOffset);
  return [v.getUint32(16), v.getUint32(20)];
}

test("screenshot, then the same request is a free cache hit", { skip }, async () => {
  const a = await g.screenshot({ url: target, viewportWidth: 1024, viewportHeight: 640 });
  assert.equal(a.contentType, "image/png");
  assert.deepEqual(pngSize(a.data), [1024, 640]);
  assert.equal(a.cacheHit, false);
  assert.match(a.requestId ?? "", /^req_/);
  await pause();
  const b = await g.screenshot({ url: target, viewportWidth: 1024, viewportHeight: 640, format: "png" });
  assert.equal(b.cacheHit, true);
  assert.deepEqual(pngSize(b.data), [1024, 640]);
  await pause();
});

test("screenshotUrl with a thumbnail width", { skip }, async () => {
  const r = await g.screenshotUrl({ url: target, imageWidth: 320, format: "webp" });
  assert.equal(r.width, 320);
  assert.equal(r.height, 200);
  assert.equal(r.format, "webp");
  assert.match(r.url, /^https?:\/\/.+\.webp$/);
  await pause();
});

test("pdf", { skip }, async () => {
  const r = await g.pdf({ url: target, paper: "a4" });
  assert.equal(r.contentType, "application/pdf");
  assert.equal(new TextDecoder().decode(r.data.slice(0, 5)), "%PDF-");
  await pause();
});

test("signed URL works without the API key; a tampered one is rejected", { skip }, async () => {
  const u = await g.signedUrl({ url: target, viewportWidth: 1024, viewportHeight: 640 });
  assert.ok(!u.includes(env.GLANCESHOT_KEY!), "the API key must not appear in a signed URL");
  const ok = await fetch(u);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  await pause();
  const bad = await fetch(u.replace("viewport_width=1024", "viewport_width=1025"));
  assert.equal(bad.status, 401);
  assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "signature_invalid");
  await pause();
});

test("API errors are typed", { skip }, async () => {
  await assert.rejects(
    g.screenshot({ url: target, viewportWidth: 10 }),
    (e: unknown) => e instanceof GlanceshotError && e.code === "invalid_params" && e.status === 400,
  );
  await pause();
  const bad = new Glanceshot({ apiKey: "gls_wrong", baseUrl: env.GLANCESHOT_BASE_URL });
  await assert.rejects(
    bad.usage(),
    (e: unknown) => e instanceof GlanceshotError && e.code === "unauthorized" && e.status === 401,
  );
  await pause();
});

test("usage", { skip }, async () => {
  const u = await g.usage();
  assert.ok(u.used >= 3, `used = ${u.used}`);
  assert.equal(typeof u.resetsAt, "string");
  await pause();
});

test("batch with webhook, verified with the SDK", { skip }, async () => {
  const b = await g.batches.create({
    urls: [`${target}&b=1`, `${target}&b=2`],
    options: { viewportWidth: 800, viewportHeight: 600 },
    webhookUrl: env.WEBHOOK_URL,
  });
  assert.match(b.id, /^bat_/);
  const done = await g.batches.wait(b.id, { intervalMs: 1500, timeoutMs: 120_000 });
  assert.equal(done.succeeded, 2);
  assert.equal(done.items[0].result?.width, 800);
  if (!env.WEBHOOK_URL || !env.WEBHOOK_LOG) return;
  // The webhook is sent right after completion; give it a moment
  let hit: { headers: Record<string, string>; body: string } | undefined;
  for (let i = 0; i < 20 && !hit; i++) {
    await new Promise((r) => setTimeout(r, 500));
    hit = readFileSync(env.WEBHOOK_LOG, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((x) => x.body.includes(b.id));
  }
  assert.ok(hit, "webhook not received");
  const sig = hit.headers["X-Glanceshot-Signature"];
  assert.equal(await verifyWebhook(hit.body, sig, env.GLANCESHOT_SECRET!), true);
  assert.equal(await g.verifyWebhook(hit.body, sig), true);
  assert.equal(await verifyWebhook(hit.body.replace("completed", "Completed"), sig, env.GLANCESHOT_SECRET!), false);
});
