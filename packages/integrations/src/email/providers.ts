import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { IntegrationError, providerFetch } from "../lib/errors";
import { verifySendGridSignature, verifySvixSignature } from "../lib/signatures";
import type { EmailEvent, EmailEventType, EmailProvider, EmailSendResult, OutboundEmail, WebhookRequest } from "./types";

// ----------------------------------------------------------------------------- Mock

/**
 * Accepts messages without sending them anywhere. Every message it "sends" is marked
 * as simulated; delivery/open/reply events for it come only from the demo simulator.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  readonly isMock = true;
  readonly outbox: Array<OutboundEmail & { id: string; at: Date }> = [];

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const id = `mock_${randomUUID()}`;
    this.outbox.push({ ...email, id, at: new Date() });
    if (this.outbox.length > 200) this.outbox.shift();
    return { providerMessageId: id, internetMessageId: `<${id}@mock.local>` };
  }
}

// ----------------------------------------------------------------------------- Resend

interface ResendWebhookPayload {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    text?: string;
    bounce?: { message?: string };
    headers?: Array<{ name: string; value: string }>;
  };
}

const RESEND_EVENT_MAP: Record<string, EmailEventType> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.received": "inbound",
};

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  readonly isMock = false;

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret?: string,
  ) {}

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const response = await providerFetch("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        reply_to: email.replyTo,
        headers: email.headers,
        attachments: email.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content.toString("base64"),
          content_type: attachment.contentType,
        })),
        tags: email.tags ? Object.entries(email.tags).map(([name, value]) => ({ name, value })) : undefined,
      }),
    });
    const data = (await response.json()) as { id?: string };
    if (!data.id) throw new IntegrationError("resend", "Response did not include a message id", response.status, false);
    return { providerMessageId: data.id };
  }

  verifyWebhook(request: WebhookRequest): boolean {
    if (!this.webhookSecret) return false;
    return verifySvixSignature({
      secret: this.webhookSecret,
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signatureHeader: request.headers.get("svix-signature"),
      body: request.rawBody,
    });
  }

  parseWebhook(request: WebhookRequest): EmailEvent[] {
    const payload = JSON.parse(request.rawBody) as ResendWebhookPayload;
    const type = RESEND_EVENT_MAP[payload.type];
    if (!type) return [];
    const header = (name: string) => payload.data?.headers?.find((h) => h.name.toLowerCase() === name)?.value;
    const to = Array.isArray(payload.data?.to) ? payload.data?.to[0] : payload.data?.to;
    return [
      {
        type,
        externalEventId: request.headers.get("svix-id") ?? `${payload.type}:${payload.data?.email_id}:${payload.created_at}`,
        providerMessageId: payload.data?.email_id ?? null,
        occurredAt: payload.created_at ? new Date(payload.created_at) : new Date(),
        recipient: to,
        reason: payload.data?.bounce?.message,
        inbound:
          type === "inbound"
            ? {
                from: payload.data?.from ?? "",
                to: to ?? "",
                subject: payload.data?.subject ?? "",
                text: payload.data?.text ?? "",
                inReplyTo: header("in-reply-to"),
                internetMessageId: header("message-id"),
              }
            : undefined,
      },
    ];
  }
}

// ----------------------------------------------------------------------------- SendGrid

interface SendGridEvent {
  event: string;
  sg_event_id: string;
  sg_message_id?: string;
  email?: string;
  timestamp: number;
  reason?: string;
}

const SENDGRID_EVENT_MAP: Record<string, EmailEventType> = {
  delivered: "delivered",
  open: "opened",
  click: "clicked",
  bounce: "bounced",
  dropped: "failed",
  spamreport: "complained",
  unsubscribe: "unsubscribed",
  group_unsubscribe: "unsubscribed",
};

function parseAddress(address: string): { email: string; name?: string } {
  const match = /^(.*)<([^>]+)>\s*$/.exec(address);
  if (!match) return { email: address.trim() };
  return { email: match[2]?.trim() ?? address, name: match[1]?.trim().replace(/^"|"$/g, "") || undefined };
}

export class SendGridEmailProvider implements EmailProvider {
  readonly name = "sendgrid";
  readonly isMock = false;

  constructor(
    private readonly apiKey: string,
    private readonly webhookPublicKey?: string,
  ) {}

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const response = await providerFetch("sendgrid", "https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: email.to }], custom_args: email.tags }],
        from: parseAddress(email.from),
        reply_to: email.replyTo ? parseAddress(email.replyTo) : undefined,
        subject: email.subject,
        headers: email.headers,
        content: [
          { type: "text/plain", value: email.text },
          ...(email.html ? [{ type: "text/html", value: email.html }] : []),
        ],
        attachments: email.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content.toString("base64"),
          type: attachment.contentType,
        })),
      }),
    });
    const id = response.headers.get("x-message-id");
    if (!id) throw new IntegrationError("sendgrid", "Missing X-Message-Id header", response.status, false);
    return { providerMessageId: id };
  }

  verifyWebhook(request: WebhookRequest): boolean {
    if (!this.webhookPublicKey) return false;
    return verifySendGridSignature(
      this.webhookPublicKey,
      request.headers.get("x-twilio-email-event-webhook-signature"),
      request.headers.get("x-twilio-email-event-webhook-timestamp"),
      request.rawBody,
    );
  }

  parseWebhook(request: WebhookRequest): EmailEvent[] {
    const events = JSON.parse(request.rawBody) as SendGridEvent[];
    return events.flatMap((event): EmailEvent[] => {
      const type = SENDGRID_EVENT_MAP[event.event];
      if (!type) return [];
      return [
        {
          type,
          externalEventId: event.sg_event_id,
          // sg_message_id is "<X-Message-Id>.filter..." — the prefix matches the send response.
          providerMessageId: event.sg_message_id?.split(".")[0] ?? null,
          occurredAt: new Date(event.timestamp * 1000),
          recipient: event.email,
          reason: event.reason,
        },
      ];
    });
  }
}

// ----------------------------------------------------------------------------- SMTP

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  readonly isMock = false;
  private readonly transporter: Transporter;

  constructor(options: { host: string; port: number; secure: boolean; user?: string; password?: string }) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.user ? { user: options.user, pass: options.password } : undefined,
    });
  }

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: email.from,
        to: email.to,
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        attachments: email.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
        })),
      });
      return { providerMessageId: info.messageId, internetMessageId: info.messageId };
    } catch (error) {
      throw new IntegrationError("smtp", error instanceof Error ? error.message : String(error), null, true);
    }
  }
}
