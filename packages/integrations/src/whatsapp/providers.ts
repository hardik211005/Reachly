import { randomUUID } from "node:crypto";
import { IntegrationError, providerFetch } from "../lib/errors";
import { verifyMetaSignature } from "../lib/signatures";
import type {
  WhatsAppEvent,
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppTemplateInfo,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from "./types";

/** Meta expects international numbers without "+" or punctuation. */
export function toWhatsAppNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ----------------------------------------------------------------------------- Meta Cloud API

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
}

/**
 * Official WhatsApp Business Cloud API (Meta Graph API). Business-initiated messages use
 * approved templates; free-form text is only allowed inside the 24-hour customer service
 * window (the caller enforces the window — see core/outreach/whatsapp-policy.ts).
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";
  readonly isMock = false;

  constructor(
    private readonly options: { accessToken: string; phoneNumberId: string; businessAccountId?: string; apiVersion?: string },
  ) {}

  private get base(): string {
    return `https://graph.facebook.com/${this.options.apiVersion ?? "v21.0"}`;
  }

  private async post(body: Record<string, unknown>): Promise<WhatsAppSendResult> {
    const response = await providerFetch("meta_whatsapp", `${this.base}/${this.options.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
    });
    const data = (await response.json()) as MetaSendResponse;
    const id = data.messages?.[0]?.id;
    if (!id) throw new IntegrationError("meta_whatsapp", "Response did not include a message id", response.status, false);
    return { providerMessageId: id };
  }

  sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    return this.post({
      to: toWhatsAppNumber(message.to),
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.language },
        components: message.parameters.length
          ? [{ type: "body", parameters: message.parameters.map((text) => ({ type: "text", text })) }]
          : [],
      },
    });
  }

  sendText(message: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    return this.post({
      to: toWhatsAppNumber(message.to),
      type: "text",
      text: { preview_url: false, body: message.body },
      ...(message.replyToProviderMessageId ? { context: { message_id: message.replyToProviderMessageId } } : {}),
    });
  }

  async listTemplates(): Promise<WhatsAppTemplateInfo[]> {
    if (!this.options.businessAccountId) return [];
    const response = await providerFetch("meta_whatsapp", `${this.base}/${this.options.businessAccountId}/message_templates?limit=100`, {
      headers: { authorization: `Bearer ${this.options.accessToken}` },
    });
    const data = (await response.json()) as {
      data?: Array<{ id: string; name: string; language: string; category: string; status: string; components?: Array<{ type: string; text?: string }> }>;
    };
    return (data.data ?? []).map((template) => ({
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      body: template.components?.find((component) => component.type === "BODY")?.text ?? "",
      providerTemplateId: template.id,
    }));
  }
}

interface MetaWebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{ id: string; from: string; timestamp: string; type: string; text?: { body?: string }; context?: { id?: string }; button?: { text?: string } }>;
        statuses?: Array<{ id: string; status: string; timestamp: string; errors?: Array<{ title?: string; message?: string }> }>;
      };
    }>;
  }>;
}

export function verifyMetaWebhook(appSecret: string, signatureHeader: string | null, rawBody: string): boolean {
  return verifyMetaSignature(appSecret, signatureHeader, rawBody);
}

/** Parses a Meta webhook delivery into message and status events. */
export function parseMetaWebhook(rawBody: string): { phoneNumberIds: string[]; events: WhatsAppEvent[] } {
  const payload = JSON.parse(rawBody) as MetaWebhookPayload;
  const events: WhatsAppEvent[] = [];
  const phoneNumberIds = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      if (value.metadata?.phone_number_id) phoneNumberIds.add(value.metadata.phone_number_id);
      for (const message of value.messages ?? []) {
        const contact = value.contacts?.find((item) => item.wa_id === message.from);
        events.push({
          type: "inbound",
          externalEventId: message.id,
          providerMessageId: message.id,
          from: `+${message.from}`,
          profileName: contact?.profile?.name ?? null,
          text: message.text?.body ?? message.button?.text ?? `[${message.type} message]`,
          occurredAt: new Date(Number(message.timestamp) * 1000),
          contextProviderMessageId: message.context?.id,
        });
      }
      for (const status of value.statuses ?? []) {
        if (!["sent", "delivered", "read", "failed"].includes(status.status)) continue;
        events.push({
          type: "status",
          externalEventId: `${status.id}:${status.status}`,
          providerMessageId: status.id,
          status: status.status as "sent" | "delivered" | "read" | "failed",
          occurredAt: new Date(Number(status.timestamp) * 1000),
          error: status.errors?.[0]?.message ?? status.errors?.[0]?.title,
        });
      }
    }
  }
  return { phoneNumberIds: [...phoneNumberIds], events };
}

// ----------------------------------------------------------------------------- Mock

/** Accepts messages without sending them; delivery/read/replies come only from the demo simulator. */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly isMock = true;

  async sendTemplate(): Promise<WhatsAppSendResult> {
    return { providerMessageId: `mock_wa_${randomUUID()}` };
  }

  async sendText(): Promise<WhatsAppSendResult> {
    return { providerMessageId: `mock_wa_${randomUUID()}` };
  }

  /** Demo templates so campaigns can be built end to end without a WhatsApp Business Account. */
  async listTemplates(): Promise<WhatsAppTemplateInfo[]> {
    return [
      {
        name: "intro_offer",
        language: "en",
        category: "MARKETING",
        status: "APPROVED",
        body: "Hi {{1}}, this is {{2}} from {{3}}. We help businesses like {{4}} with {{5}}. Would you be open to a quick chat this week? Reply STOP to opt out.",
        providerTemplateId: "mock_tpl_intro_offer",
        variables: ["first_name", "sender_name", "sender_company", "business_name", "offer_short"],
      },
      {
        name: "gentle_follow_up",
        language: "en",
        category: "MARKETING",
        status: "APPROVED",
        body: "Hi {{1}}, just following up on my note about {{2}}. Happy to share details whenever it suits you. Reply STOP to opt out.",
        providerTemplateId: "mock_tpl_gentle_follow_up",
        variables: ["first_name", "offer_short"],
      },
      {
        name: "meeting_confirmation",
        language: "en",
        category: "UTILITY",
        status: "PENDING",
        body: "Hi {{1}}, confirming our call on {{2}}. Reply here if you need to reschedule.",
        providerTemplateId: "mock_tpl_meeting_confirmation",
        variables: ["first_name", "meeting_time"],
      },
    ];
  }
}
