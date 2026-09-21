export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  language: string;
  /** Positional body parameters for {{1}}, {{2}} … */
  parameters: string[];
}

export interface WhatsAppTextMessage {
  to: string;
  body: string;
  /** Replying to a specific inbound message (context). */
  replyToProviderMessageId?: string;
}

export interface WhatsAppSendResult {
  providerMessageId: string;
}

export type WhatsAppEvent =
  | {
      type: "status";
      externalEventId: string;
      providerMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      occurredAt: Date;
      error?: string;
    }
  | {
      type: "inbound";
      externalEventId: string;
      providerMessageId: string;
      from: string;
      profileName: string | null;
      text: string;
      occurredAt: Date;
      contextProviderMessageId?: string;
    };

export interface WhatsAppTemplateInfo {
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  providerTemplateId: string;
  /** Labels for {{1}}, {{2}} … when the provider knows them (demo templates). */
  variables?: string[];
}

export interface WhatsAppProvider {
  readonly name: string;
  readonly isMock: boolean;
  sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult>;
  sendText(message: WhatsAppTextMessage): Promise<WhatsAppSendResult>;
  listTemplates?(): Promise<WhatsAppTemplateInfo[]>;
}
