import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

/** Webhook signature verification helpers for the providers we integrate with. */

export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const right = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hmac(algorithm: "sha1" | "sha256", secret: string | Buffer, payload: string | Buffer): Buffer {
  return createHmac(algorithm, secret).update(payload).digest();
}

/** Rejects timestamps outside a tolerance window to prevent replay. */
export function withinTolerance(timestampSeconds: number, toleranceSeconds = 300, now = Date.now()): boolean {
  return Number.isFinite(timestampSeconds) && Math.abs(now / 1000 - timestampSeconds) <= toleranceSeconds;
}

/**
 * Svix-style signatures (used by Resend): HMAC-SHA256 over `${id}.${timestamp}.${body}`
 * with the base64 secret after the `whsec_` prefix; header holds space-separated `v1,<sig>`.
 */
export function verifySvixSignature(params: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  body: string;
  toleranceSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signatureHeader, body } = params;
  if (!id || !timestamp || !signatureHeader) return false;
  if (!withinTolerance(Number(timestamp), params.toleranceSeconds)) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = hmac("sha256", key, `${id}.${timestamp}.${body}`).toString("base64");
  return signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1])
    .some((signature) => signature !== undefined && safeEqual(signature, expected));
}

/** Meta (WhatsApp Cloud API) `X-Hub-Signature-256: sha256=<hex>` over the raw body with the app secret. */
export function verifyMetaSignature(appSecret: string, signatureHeader: string | null, body: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = hmac("sha256", appSecret, body).toString("hex");
  return safeEqual(signatureHeader.slice(7), expected);
}

/**
 * Twilio `X-Twilio-Signature`: base64 HMAC-SHA1 of the full URL followed by the POST
 * params sorted by key and concatenated as key+value.
 */
export function verifyTwilioSignature(authToken: string, signatureHeader: string | null, url: string, params: Record<string, string>): boolean {
  if (!signatureHeader) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ""), url);
  const expected = hmac("sha1", authToken, data).toString("base64");
  return safeEqual(signatureHeader, expected);
}

/** SendGrid Event Webhook: ECDSA P-256 signature over timestamp + raw body. */
export function verifySendGridSignature(publicKeyBase64: string, signature: string | null, timestamp: string | null, body: string): boolean {
  if (!signature || !timestamp) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(timestamp + body), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Generic `sha256=<hex>` HMAC header (used for n8n callbacks and outbound webhooks). */
export function signHmacSha256(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmac("sha256", secret, `${timestamp}.${body}`).toString("hex")}`;
}

export function verifyHmacSha256(secret: string, header: string | null, body: string, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  if (!parts.v1 || !withinTolerance(timestamp, toleranceSeconds)) return false;
  const expected = hmac("sha256", secret, `${timestamp}.${body}`).toString("hex");
  return safeEqual(parts.v1, expected);
}
