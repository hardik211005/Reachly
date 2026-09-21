export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutboundEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  /** Extra headers, e.g. List-Unsubscribe, In-Reply-To, References. */
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  /** Provider tags used to correlate webhooks back to our records. */
  tags?: Record<string, string>;
}

export interface EmailSendResult {
  providerMessageId: string;
  /** RFC 5322 Message-ID when the provider exposes it (for threading). */
  internetMessageId?: string;
}

export type EmailEventType =
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed"
  | "unsubscribed"
  | "inbound";

export interface EmailEvent {
  type: EmailEventType;
  /** Unique id from the provider, used for webhook idempotency. */
  externalEventId: string;
  providerMessageId: string | null;
  occurredAt: Date;
  recipient?: string;
  reason?: string;
  inbound?: {
    from: string;
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string;
    internetMessageId?: string;
  };
}

export interface WebhookRequest {
  headers: Headers;
  rawBody: string;
  url: string;
}

export interface EmailProvider {
  readonly name: string;
  /** Mock providers are labelled as such in the UI. */
  readonly isMock: boolean;
  send(email: OutboundEmail): Promise<EmailSendResult>;
  verifyWebhook?(request: WebhookRequest): boolean;
  parseWebhook?(request: WebhookRequest): EmailEvent[];
}
