import { getEnv } from "@repo/config/env";
import { addSuppression } from "../compliance/suppression";
import { systemContext } from "../context";
import { signToken, verifyToken, type SignedTokenPayload } from "../crypto";
import { recordEvent } from "../events";

interface UnsubscribePayload extends SignedTokenPayload {
  p: "unsubscribe";
  o: string;
  l: string;
  e: string;
  m?: string;
  c?: string | null;
}

export function unsubscribeToken(input: { organizationId: string; leadId: string; email: string; messageId?: string; campaignId?: string | null }): string {
  return signToken({ p: "unsubscribe", o: input.organizationId, l: input.leadId, e: input.email, m: input.messageId, c: input.campaignId ?? null });
}

export function unsubscribeUrl(token: string): string {
  return `${getEnv().APP_URL}/u/${token}`;
}

export function readUnsubscribeToken(token: string): UnsubscribePayload | null {
  return verifyToken<UnsubscribePayload>(token, "unsubscribe");
}

/** Processes an unsubscribe (link click or RFC 8058 one-click POST). Idempotent. */
export async function processUnsubscribe(token: string): Promise<{ ok: boolean; email?: string }> {
  const payload = readUnsubscribeToken(token);
  if (!payload) return { ok: false };
  const ctx = systemContext(payload.o, { type: "PROVIDER", id: "unsubscribe" });
  await addSuppression(ctx, { leadId: payload.l, email: payload.e }, { reason: "UNSUBSCRIBE", sourceType: "unsubscribe_link", sourceId: payload.m ?? payload.l });
  await recordEvent(ctx, {
    type: "email_unsubscribed",
    leadId: payload.l,
    campaignId: payload.c ?? null,
    messageId: payload.m ?? null,
    channel: "EMAIL",
    idempotencyKey: `unsubscribed:${payload.l}:${payload.e}`,
  });
  return { ok: true, email: payload.e };
}
