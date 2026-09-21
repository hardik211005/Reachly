import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Secrets & signing utilities.
 *  - encryptSecret/decryptSecret: AES-256-GCM for provider credentials at rest.
 *  - signToken/verifyToken: compact HMAC tokens for unsubscribe links and callbacks.
 *  - hashToken: SHA-256 for API keys and invitation tokens (store hash, never the token).
 */

const VERSION = "v1";

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const decoded = Buffer.from(raw, "base64");
  // Accept a 32-byte base64 key directly; otherwise derive one deterministically.
  return decoded.length === 32 ? decoded : createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hmacSha256(secret: string, payload: string | Buffer, encoding: "hex" | "base64" | "base64url" = "hex") {
  return createHmac("sha256", secret).update(payload).digest(encoding);
}

function signingSecret(): string {
  const secret = process.env.SIGNING_SECRET;
  if (!secret) throw new Error("SIGNING_SECRET is not set");
  return secret;
}

export interface SignedTokenPayload {
  /** Purpose, e.g. "unsubscribe". Verified so tokens can't be replayed across features. */
  p: string;
  /** Expiry, unix seconds. */
  exp?: number;
  [key: string]: unknown;
}

export function signToken(payload: SignedTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmacSha256(signingSecret(), body, "base64url")}`;
}

export function verifyToken<T extends SignedTokenPayload>(token: string, purpose: string): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  if (!safeEqual(signature, hmacSha256(signingSecret(), body, "base64url"))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (payload.p !== purpose) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Stable short hash for cache keys and fingerprints. */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 40);
}

/** JSON.stringify with sorted keys so equal objects hash identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
