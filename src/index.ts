/**
 * Official Node.js SDK for the Glanceshot website screenshot API.
 * https://glanceshot.com/docs
 *
 * No dependencies. Works on Node.js 18+ and edge runtimes that provide
 * `fetch` and Web Crypto (Cloudflare Workers, Vercel Edge, Deno, Bun).
 */

export const DEFAULT_BASE_URL = "https://glanceshot.com";
const VERSION = "0.1.0";

// ---------------------------------------------------------------- options

/** Options shared by screenshots and PDFs. Names follow the HTTP API in camelCase. */
export interface CommonOptions {
  /** Page to capture (http/https). Pass either `url` or `html`. */
  url?: string;
  /** Raw HTML to render instead of a URL (up to 2 MB). */
  html?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  /** Wait until this CSS selector is visible before capturing. */
  waitForSelector?: string;
  /** Extra delay in milliseconds after the page is ready (up to 10000). */
  delay?: number;
  blockAds?: boolean;
  blockCookieBanners?: boolean;
  /** Hide the site's own pop-ups (announcements, newsletter and promo modals). On by default. */
  blockPopups?: boolean;
  darkMode?: boolean;
  /** CSS selectors to hide, e.g. ".ad, #popup". */
  hideSelectors?: string;
  /** Set to false to skip the cache (the result is still cached). */
  cache?: boolean;
  /** Cache lifetime in seconds (60 – 2592000). */
  cacheTtl?: number;
  /** Login profile ID (lp_…) saved with the Glanceshot browser extension. */
  loginProfile?: string;
  /** Your own proxy, e.g. "socks5://user:pass@host:1080". Server-side calls only. */
  proxy?: string;
}

export interface ScreenshotOptions extends CommonOptions {
  format?: "png" | "jpeg" | "webp";
  deviceScaleFactor?: number;
  /** JPEG / WebP quality, 1 – 100. */
  quality?: number;
  fullPage?: boolean;
  /** Capture a single element. */
  selector?: string;
  /** Scale the output down to this width in pixels (thumbnails). */
  imageWidth?: number;
  /** Crop the output to this height in pixels, from the top. */
  imageHeight?: number;
}

export interface PdfOptions extends CommonOptions {
  paper?: "a4" | "letter";
  printBackground?: boolean;
  pdfMedia?: "print" | "screen";
}

export interface SignedUrlOptions extends ScreenshotOptions, PdfOptions {
  /** Which endpoint the URL points to. Default "screenshot". */
  type?: "screenshot" | "pdf";
  /** Link expiry: a Date or Unix seconds. The URL is rejected after this time. */
  expires?: Date | number;
}

export interface ClientOptions {
  /** API key (gls_…). Needed for screenshot(), pdf(), batches and usage(). Keep it server-side. */
  apiKey?: string;
  /** Public key ID (glk_…). Needed for signedUrl(). */
  keyId?: string;
  /** Signing secret (glss_…). Needed for signedUrl() and verifyWebhook(). Keep it server-side. */
  secret?: string;
  /** Defaults to https://glanceshot.com */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default 60000. */
  timeoutMs?: number;
  /** Custom fetch implementation (defaults to the global fetch). */
  fetch?: typeof fetch;
}

// ---------------------------------------------------------------- results

export interface BinaryResult {
  /** The image or PDF bytes. */
  data: Uint8Array;
  /** MIME type, e.g. "image/png" or "application/pdf". */
  contentType: string;
  /** True when the result came from the cache (not billed). */
  cacheHit: boolean;
  /** True when a full-page screenshot hit the height limit. Only known on cache misses. */
  truncated: boolean;
  /** Set when a large PNG was converted automatically, e.g. "webp". Only known on cache misses. */
  formatChanged?: string;
  requestId?: string;
}

export interface FileResult {
  /** Public URL of the stored file. */
  url: string;
  cacheHit: boolean;
  durationMs: number;
  format: string;
  mime: string;
  width: number;
  height: number;
  truncated: boolean;
  formatChanged: boolean;
  /** ISO time when the cached file expires. */
  expiresAt: string;
  requestId: string;
}

export interface Usage {
  plan: Record<string, unknown>;
  month: string;
  used: number;
  limit: number;
  remaining: number;
  overage: number;
  resetsAt: string;
}

export interface BatchItem {
  index: number;
  url: string;
  status: "pending" | "running" | "succeeded" | "failed";
  result: { url: string; mime: string; width: number; height: number; cacheHit: boolean } | null;
  error: { code: string; message: string } | null;
  durationMs?: number;
}

export interface Batch {
  id: string;
  type: "screenshot" | "pdf";
  status: "queued" | "running" | "completed";
  total: number;
  succeeded: number;
  failed: number;
  createdAt: string;
  completedAt: string | null;
  items: BatchItem[];
  webhook?: { url: string; status: string; attempts: number };
}

export interface CreateBatchOptions {
  type?: "screenshot" | "pdf";
  /** 1 – 100 URLs. */
  urls: string[];
  /** Options applied to every URL. `url`, `html`, and `proxy` are not allowed here. */
  options?: Omit<ScreenshotOptions & PdfOptions, "url" | "html" | "proxy">;
  /** Called with a signed POST when the batch completes. */
  webhookUrl?: string;
}

/** Payload of the `batch.completed` webhook. */
export interface BatchWebhookEvent {
  event: "batch.completed";
  batch: Batch;
}

// ---------------------------------------------------------------- errors

/** Error returned by the API: `code` is stable (see /docs#errors), `message` is human-readable. */
export class GlanceshotError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  /** Seconds to wait before retrying (429 responses). */
  readonly retryAfter?: number;
  /** Extra fields from the error body, e.g. `upstream_status`. */
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    extra: { requestId?: string; retryAfter?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "GlanceshotError";
    this.code = code;
    this.status = status;
    this.requestId = extra.requestId;
    this.retryAfter = extra.retryAfter;
    this.details = extra.details ?? {};
  }
}

// ---------------------------------------------------------------- helpers

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

/** Turns SDK options into API parameters: snake_case names, string values, undefined dropped. */
export function toParams(opts: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (v === undefined || v === null) continue;
    out[camelToSnake(k)] = v instanceof Date ? String(Math.floor(v.getTime() / 1000)) : String(v);
  }
  return out;
}

/** RFC 3986 encoding, identical to the server: also escapes ! ' ( ) * and encodes spaces as %20. */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Canonical query used for signing: all params except `signature`, sorted by name. */
export function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${rfc3986(params[k])}`)
    .join("&");
}

async function subtle(): Promise<SubtleCrypto> {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle;
  // Node 18 without the global: fall back to node:crypto's Web Crypto.
  // The specifier is a variable so edge bundlers and type checking don't try to resolve it.
  const mod = "node:crypto";
  const nodeCrypto = (await import(/* @vite-ignore */ /* webpackIgnore: true */ mod)) as {
    webcrypto: Crypto;
  };
  return nodeCrypto.webcrypto.subtle;
}

/** hex(HMAC-SHA256(secret, message)) */
export async function hmacHex(
  secret: string,
  message: string | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const enc = new TextEncoder();
  const s = await subtle();
  const key = await s.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const data = typeof message === "string" ? enc.encode(message) : message;
  const sig = new Uint8Array(await s.sign("HMAC", key, data));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// snake_case JSON → camelCase objects (results only)
function camelize<T>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => camelize(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] =
        k === "plan" ? val : camelize(val);
    }
    return out as T;
  }
  return v as T;
}

// ---------------------------------------------------------------- webhook

/**
 * Verifies the `X-Glanceshot-Signature` header of a batch webhook.
 * Pass the raw request body exactly as received (not re-serialized JSON).
 * Returns false for a wrong signature or a timestamp older than `toleranceSec` (replay protection).
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
  { toleranceSec = 300, now = Date.now() }: { toleranceSec?: number; now?: number } = {},
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts: Record<string, string> = {};
  for (const p of signatureHeader.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t) || t <= 0 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const body = typeof rawBody === "string" ? new TextEncoder().encode(rawBody) : rawBody;
  const prefix = new TextEncoder().encode(`${t}.`);
  const msg = new Uint8Array(prefix.length + body.length);
  msg.set(prefix);
  msg.set(body, prefix.length);
  const expected = await hmacHex(secret, msg);
  return timingSafeEqual(expected, (parts.v1 ?? "").toLowerCase());
}

// ---------------------------------------------------------------- client

export class Glanceshot {
  private readonly apiKey?: string;
  private readonly keyId?: string;
  private readonly secret?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  /** Batch jobs: create, get, wait. */
  readonly batches: {
    create: (o: CreateBatchOptions) => Promise<Batch>;
    get: (id: string) => Promise<Batch>;
    wait: (id: string, o?: { intervalMs?: number; timeoutMs?: number }) => Promise<Batch>;
  };

  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.keyId = options.keyId;
    this.secret = options.secret;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("glanceshot: no fetch available; pass options.fetch");
    this.fetchImpl = f.bind(globalThis);
    this.batches = {
      create: (o) => this.createBatch(o),
      get: (id) => this.getBatch(id),
      wait: (id, o) => this.waitBatch(id, o),
    };
  }

  /** Takes a screenshot and returns the image bytes. */
  screenshot(options: ScreenshotOptions): Promise<BinaryResult> {
    return this.renderBinary("screenshot", options);
  }

  /** Takes a screenshot, stores it, and returns its URL and metadata instead of the bytes. */
  screenshotUrl(options: ScreenshotOptions): Promise<FileResult> {
    return this.renderJson("screenshot", options);
  }

  /** Renders a PDF and returns its bytes. Costs 2 requests. */
  pdf(options: PdfOptions): Promise<BinaryResult> {
    return this.renderBinary("pdf", options);
  }

  /** Renders a PDF, stores it, and returns its URL and metadata. Costs 2 requests. */
  pdfUrl(options: PdfOptions): Promise<FileResult> {
    return this.renderJson("pdf", options);
  }

  /** Current month's usage for this account. */
  async usage(): Promise<Usage> {
    return camelize<Usage>(await this.request("GET", "/v1/usage"));
  }

  /**
   * Builds a signed URL you can put straight into `<img src>` or a link.
   * It contains only the public key ID and a signature; changing any parameter invalidates it.
   * Login profiles and proxies cannot be used in signed URLs.
   */
  async signedUrl(options: SignedUrlOptions): Promise<string> {
    if (!this.keyId || !this.secret) {
      throw new Error("glanceshot: signedUrl() needs keyId and secret");
    }
    const { type = "screenshot", ...rest } = options;
    if (rest.loginProfile || rest.proxy) {
      throw new Error("glanceshot: loginProfile and proxy cannot be used in signed URLs");
    }
    if (rest.html) throw new Error("glanceshot: signed URLs need url, not html");
    const params = { ...toParams(rest), key_id: this.keyId };
    const canonical = canonicalQuery(params);
    const signature = await hmacHex(this.secret, canonical);
    return `${this.baseUrl}/v1/${type}?${canonical}&signature=${signature}`;
  }

  /** Same as the standalone verifyWebhook(), using this client's secret. */
  verifyWebhook(
    rawBody: string | Uint8Array,
    signatureHeader: string | null | undefined,
    options?: { toleranceSec?: number; now?: number },
  ): Promise<boolean> {
    if (!this.secret) throw new Error("glanceshot: verifyWebhook() needs the secret");
    return verifyWebhook(rawBody, signatureHeader, this.secret, options);
  }

  // ------------------------------------------------------------ internals

  private async renderBinary(endpoint: "screenshot" | "pdf", options: object): Promise<BinaryResult> {
    const res = await this.send("POST", `/v1/${endpoint}`, toParams(options));
    const data = new Uint8Array(await res.arrayBuffer());
    const h = res.headers;
    return {
      data,
      contentType: h.get("content-type") ?? "",
      // Cache hits answer with a 302 to the stored file; fetch follows it.
      cacheHit: res.redirected || h.get("x-glanceshot-cache") === "HIT",
      truncated: h.get("x-glanceshot-truncated") === "true",
      formatChanged: h.get("x-glanceshot-format-changed") ?? undefined,
      requestId: h.get("x-request-id") ?? undefined,
    };
  }

  private async renderJson(endpoint: "screenshot" | "pdf", options: object): Promise<FileResult> {
    const body = { ...toParams(options), response_type: "json" };
    const res = await this.send("POST", `/v1/${endpoint}`, body);
    return camelize<FileResult>(await res.json());
  }

  private async createBatch(o: CreateBatchOptions): Promise<Batch> {
    const body: Record<string, unknown> = {
      type: o.type ?? "screenshot",
      urls: o.urls,
      options: o.options ? toParams(o.options) : undefined,
      webhook_url: o.webhookUrl,
    };
    return camelize<Batch>(await this.request("POST", "/v1/batch", body));
  }

  private async getBatch(id: string): Promise<Batch> {
    return camelize<Batch>(await this.request("GET", `/v1/batch/${encodeURIComponent(id)}`));
  }

  private async waitBatch(
    id: string,
    { intervalMs = 2000, timeoutMs = 10 * 60_000 }: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<Batch> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const b = await this.getBatch(id);
      if (b.status === "completed") return b;
      if (Date.now() + intervalMs > deadline) {
        throw new GlanceshotError("timeout", `batch ${id} did not complete in time`, 0);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.send(method, path, body);
    return res.json();
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    if (!this.apiKey) throw new Error("glanceshot: this call needs an apiKey");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: {
          "X-Access-Key": this.apiKey,
          "User-Agent": `glanceshot-node/${VERSION}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) {
        throw new GlanceshotError("timeout", `request timed out after ${this.timeoutMs} ms`, 0);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw await toError(res);
    return res;
  }
}

async function toError(res: Response): Promise<GlanceshotError> {
  let body: { error?: Record<string, unknown> } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // non-JSON error (e.g. a proxy in front of the API)
  }
  const { code, message, request_id, ...details } = body.error ?? {};
  const ra = Number(res.headers.get("retry-after"));
  return new GlanceshotError(
    typeof code === "string" ? code : "http_" + res.status,
    typeof message === "string" ? message : res.statusText || `HTTP ${res.status}`,
    res.status,
    {
      requestId: typeof request_id === "string" ? request_id : (res.headers.get("x-request-id") ?? undefined),
      retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined,
      details,
    },
  );
}

export default Glanceshot;
