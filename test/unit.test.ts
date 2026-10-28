import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Glanceshot,
  GlanceshotError,
  canonicalQuery,
  hmacHex,
  rfc3986,
  toParams,
  verifyWebhook,
} from "../src/index.ts";

// Vectors generated from the server's own Go code (backend/internal/httpapi/signing.go and SignWebhook),
// so the SDK and the server cannot drift apart on encoding or signing.
const GO_PARAMS = {
  url: "https://example.com/a b?x=1&y=(2)*!'~中文",
  key_id: "glk_0123456789abcdef0123",
  full_page: "true",
  hide_selectors: ".ad, #pop up",
  expires: "1893456000",
};
const GO_CANON =
  "expires=1893456000&full_page=true&hide_selectors=.ad%2C%20%23pop%20up&key_id=glk_0123456789abcdef0123&url=https%3A%2F%2Fexample.com%2Fa%20b%3Fx%3D1%26y%3D%282%29%2A%21%27~%E4%B8%AD%E6%96%87";
const GO_SIG = "01e5815ff51ab1153aed5182e198ef18f0dd7dd00f5d811a93d489e030de8c68";
const GO_WEBHOOK_T = 1761550000;
const GO_WEBHOOK_BODY = `{"event":"batch.completed","batch":{"id":"bat_1"}}`;
const GO_WEBHOOK_SIG = "3f8cd447c3302505a70f289c3f5ed6421b34407c861c528fcc673f52371727c5";
const SECRET = "glss_test_secret";

test("canonical query matches the server byte for byte", () => {
  assert.equal(canonicalQuery(GO_PARAMS), GO_CANON);
  assert.equal(rfc3986("a b!'()*~"), "a%20b%21%27%28%29%2A~");
});

test("signature matches the server", async () => {
  assert.equal(await hmacHex(SECRET, canonicalQuery(GO_PARAMS)), GO_SIG);
});

test("toParams maps camelCase to the API names and drops undefined", () => {
  const p = toParams({
    url: "https://x.com",
    viewportWidth: 1280,
    fullPage: true,
    imageWidth: undefined,
    blockCookieBanners: false,
    expires: new Date(1893456000 * 1000),
  });
  assert.deepEqual(p, {
    url: "https://x.com",
    viewport_width: "1280",
    full_page: "true",
    block_cookie_banners: "false",
    expires: "1893456000",
  });
});

test("signedUrl builds a URL the server will accept", async () => {
  const g = new Glanceshot({ keyId: GO_PARAMS.key_id, secret: SECRET, baseUrl: "https://api.test/" });
  const u = await g.signedUrl({
    url: GO_PARAMS.url,
    fullPage: true,
    hideSelectors: GO_PARAMS.hide_selectors,
    expires: 1893456000,
  });
  assert.equal(u, `https://api.test/v1/screenshot?${GO_CANON}&signature=${GO_SIG}`);
  const pdf = await g.signedUrl({ type: "pdf", url: "https://x.com" });
  assert.match(pdf, /^https:\/\/api\.test\/v1\/pdf\?key_id=glk_.*&url=https%3A%2F%2Fx\.com&signature=[0-9a-f]{64}$/);
});

test("signedUrl refuses secrets it must not expose", async () => {
  const g = new Glanceshot({ keyId: "glk_x", secret: SECRET });
  await assert.rejects(g.signedUrl({ url: "https://x.com", loginProfile: "lp_1" }), /signed URLs/);
  await assert.rejects(g.signedUrl({ url: "https://x.com", proxy: "socks5://u:p@h:1" }), /signed URLs/);
  await assert.rejects(new Glanceshot({}).signedUrl({ url: "https://x.com" }), /keyId and secret/);
});

test("verifyWebhook accepts the server's signature and rejects tampering and replays", async () => {
  const header = `t=${GO_WEBHOOK_T},v1=${GO_WEBHOOK_SIG}`;
  const now = GO_WEBHOOK_T * 1000 + 10_000;
  assert.equal(await verifyWebhook(GO_WEBHOOK_BODY, header, SECRET, { now }), true);
  assert.equal(await verifyWebhook(new TextEncoder().encode(GO_WEBHOOK_BODY), header, SECRET, { now }), true);
  assert.equal(await verifyWebhook(GO_WEBHOOK_BODY + " ", header, SECRET, { now }), false, "body changed");
  assert.equal(await verifyWebhook(GO_WEBHOOK_BODY, header, "glss_other", { now }), false, "wrong secret");
  assert.equal(
    await verifyWebhook(GO_WEBHOOK_BODY, header, SECRET, { now: now + 3600_000 }),
    false,
    "too old",
  );
  assert.equal(await verifyWebhook(GO_WEBHOOK_BODY, "", SECRET, { now }), false);
  assert.equal(await verifyWebhook(GO_WEBHOOK_BODY, "t=abc,v1=00", SECRET, { now }), false);
});

// ---- client behaviour against a fake fetch

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    return handler(c);
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("screenshot posts JSON with the API key and returns bytes and headers", async () => {
  const { f, calls } = fakeFetch(
    () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "x-glanceshot-cache": "MISS",
          "x-glanceshot-truncated": "true",
          "x-request-id": "req_1",
        },
      }),
  );
  const g = new Glanceshot({ apiKey: "gls_k", baseUrl: "https://api.test", fetch: f });
  const r = await g.screenshot({ url: "https://x.com", format: "webp", imageWidth: 400, loginProfile: "lp_1" });
  assert.deepEqual([...r.data], [1, 2, 3]);
  assert.equal(r.contentType, "image/webp");
  assert.equal(r.cacheHit, false);
  assert.equal(r.truncated, true);
  assert.equal(r.requestId, "req_1");
  assert.equal(calls[0].url, "https://api.test/v1/screenshot");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>)["X-Access-Key"], "gls_k");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    url: "https://x.com",
    format: "webp",
    image_width: "400",
    login_profile: "lp_1",
  });
});

test("screenshotUrl asks for JSON and camelizes the result", async () => {
  const { f, calls } = fakeFetch(() =>
    Response.json({
      url: "https://glanceshot.com/i/ab/x.png",
      cache_hit: true,
      duration_ms: 12,
      format: "png",
      mime: "image/png",
      width: 1280,
      height: 800,
      truncated: false,
      format_changed: false,
      expires_at: "2026-01-01T00:00:00Z",
      request_id: "req_2",
    }),
  );
  const g = new Glanceshot({ apiKey: "gls_k", fetch: f });
  const r = await g.screenshotUrl({ url: "https://x.com" });
  assert.equal(JSON.parse(String(calls[0].init.body)).response_type, "json");
  assert.equal(r.cacheHit, true);
  assert.equal(r.durationMs, 12);
  assert.equal(r.expiresAt, "2026-01-01T00:00:00Z");
});

test("API errors become GlanceshotError with code, status, request id and retry-after", async () => {
  const { f } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({ error: { code: "rate_limited", message: "too many", request_id: "req_3", foo: 1 } }),
        { status: 429, headers: { "retry-after": "2", "content-type": "application/json" } },
      ),
  );
  const g = new Glanceshot({ apiKey: "gls_k", fetch: f });
  await assert.rejects(g.usage(), (e: unknown) => {
    assert.ok(e instanceof GlanceshotError);
    assert.equal(e.code, "rate_limited");
    assert.equal(e.status, 429);
    assert.equal(e.requestId, "req_3");
    assert.equal(e.retryAfter, 2);
    assert.deepEqual(e.details, { foo: 1 });
    return true;
  });
});

test("non-JSON errors still produce a GlanceshotError", async () => {
  const { f } = fakeFetch(() => new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }));
  const g = new Glanceshot({ apiKey: "gls_k", fetch: f });
  await assert.rejects(g.screenshot({ url: "https://x.com" }), (e: unknown) => {
    assert.ok(e instanceof GlanceshotError);
    assert.equal(e.code, "http_502");
    return true;
  });
});

test("batches: create sends snake_case, wait polls until completed", async () => {
  let polls = 0;
  const { f, calls } = fakeFetch(({ url, init }) => {
    if (init.method === "POST") return Response.json({ id: "bat_1", status: "queued", items: [] }, { status: 202 });
    polls++;
    return Response.json({
      id: "bat_1",
      status: polls < 2 ? "running" : "completed",
      created_at: "x",
      items: [{ index: 0, url, status: "succeeded", result: { cache_hit: false }, error: null }],
    });
  });
  const g = new Glanceshot({ apiKey: "gls_k", fetch: f });
  const b = await g.batches.create({
    urls: ["https://a.com"],
    options: { fullPage: true, loginProfile: "lp_1" },
    webhookUrl: "https://hook.test/x",
  });
  assert.equal(b.id, "bat_1");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    type: "screenshot",
    urls: ["https://a.com"],
    options: { full_page: "true", login_profile: "lp_1" },
    webhook_url: "https://hook.test/x",
  });
  const done = await g.batches.wait("bat_1", { intervalMs: 10 });
  assert.equal(done.status, "completed");
  assert.equal(done.items[0].result?.cacheHit, false);
  assert.equal(polls, 2);
});

test("timeouts surface as a GlanceshotError", async () => {
  const f = ((_: string, init: RequestInit) =>
    new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch;
  const g = new Glanceshot({ apiKey: "gls_k", fetch: f, timeoutMs: 30 });
  await assert.rejects(g.usage(), (e: unknown) => e instanceof GlanceshotError && e.code === "timeout");
});
