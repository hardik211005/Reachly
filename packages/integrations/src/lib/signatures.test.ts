import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signHmacSha256,
  verifyHmacSha256,
  verifyMetaSignature,
  verifySendGridSignature,
  verifySvixSignature,
  verifyTwilioSignature,
} from "./signatures";

describe("webhook signatures", () => {
  it("verifies Svix (Resend) signatures and rejects stale timestamps", () => {
    const secret = `whsec_${Buffer.from("super-secret-key").toString("base64")}`;
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.delivered"}';
    const signature = createHmac("sha256", Buffer.from("super-secret-key")).update(`${id}.${timestamp}.${body}`).digest("base64");
    expect(verifySvixSignature({ secret, id, timestamp, signatureHeader: `v1,${signature}`, body })).toBe(true);
    expect(verifySvixSignature({ secret, id, timestamp, signatureHeader: `v1,${signature}`, body: `${body} ` })).toBe(false);
    expect(verifySvixSignature({ secret, id, timestamp: "1000", signatureHeader: `v1,${signature}`, body })).toBe(false);
  });

  it("verifies Meta signatures", () => {
    const body = '{"entry":[]}';
    const header = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(verifyMetaSignature("app-secret", header, body)).toBe(true);
    expect(verifyMetaSignature("wrong", header, body)).toBe(false);
    expect(verifyMetaSignature("app-secret", null, body)).toBe(false);
  });

  it("verifies Twilio signatures", () => {
    const url = "https://app.example/api/webhooks/voice/twilio";
    const params = { CallSid: "CA1", CallStatus: "completed" };
    const header = createHmac("sha1", "auth-token").update(`${url}CallSidCA1CallStatuscompleted`).digest("base64");
    expect(verifyTwilioSignature("auth-token", header, url, params)).toBe(true);
    expect(verifyTwilioSignature("auth-token", header, url, { ...params, CallStatus: "failed" })).toBe(false);
  });

  it("verifies SendGrid ECDSA signatures", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const timestamp = "1700000000";
    const body = '[{"event":"delivered"}]';
    const signature = sign("sha256", Buffer.from(timestamp + body), privateKey).toString("base64");
    const der = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(verifySendGridSignature(der, signature, timestamp, body)).toBe(true);
    expect(verifySendGridSignature(der, signature, timestamp, `${body}x`)).toBe(false);
  });

  it("round-trips our own HMAC header", () => {
    const body = '{"status":"completed"}';
    const header = signHmacSha256("shared", body, Math.floor(Date.now() / 1000));
    expect(verifyHmacSha256("shared", header, body)).toBe(true);
    expect(verifyHmacSha256("other", header, body)).toBe(false);
  });
});
