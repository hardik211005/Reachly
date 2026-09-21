import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, fingerprint, hashToken, signToken, stableStringify, verifyToken } from "./crypto";

describe("secret encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("sk_live_123");
    const b = encryptSecret("sk_live_123");
    expect(a).not.toEqual(b);
    expect(decryptSecret(a)).toBe("sk_live_123");
  });

  it("detects tampering", () => {
    const payload = encryptSecret("secret");
    const parts = payload.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("xxxxxxxx").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("signed tokens", () => {
  it("verifies purpose and signature", () => {
    const token = signToken({ p: "unsubscribe", leadId: "l1" });
    expect(verifyToken(token, "unsubscribe")?.leadId).toBe("l1");
    expect(verifyToken(token, "other")).toBeNull();
    expect(verifyToken(`${token}x`, "unsubscribe")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = signToken({ p: "unsubscribe", exp: Math.floor(Date.now() / 1000) - 10 });
    expect(verifyToken(token, "unsubscribe")).toBeNull();
  });
});

describe("hashing", () => {
  it("hashes deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("fingerprints objects independent of key order", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(fingerprint({ x: 1, y: 2 })).toBe(fingerprint({ y: 2, x: 1 }));
  });
});
