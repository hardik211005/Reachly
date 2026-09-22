import { z } from "zod";
import { brand } from "@repo/config";
import { prisma } from "@repo/db";
import { hashToken } from "../crypto";
import { sendTransactionalEmail, simpleEmailHtml } from "../email/platform";
import { logger } from "../logger";

/**
 * The public contact form. Messages are stored (so nothing is lost if email isn't
 * configured), the team is notified at the support address, and the sender gets a
 * confirmation. Abuse controls: a honeypot field, per-IP rate limits at the route, and
 * duplicate suppression here. Only a hash of the IP is kept.
 */

export const CONTACT_TOPICS = ["SALES", "SUPPORT", "PARTNERSHIP", "PRESS", "OTHER"] as const;
export const CONTACT_TOPIC_LABELS: Record<(typeof CONTACT_TOPICS)[number], string> = {
  SALES: "Sales and pricing",
  SUPPORT: "Help with my account",
  PARTNERSHIP: "Partnerships and integrations",
  PRESS: "Press",
  OTHER: "Something else",
};

export const contactRequestSchema = z.object({
  name: z.string().trim().min(2, "Tell us your name").max(120),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid email address")),
  company: z.string().trim().max(160).optional().transform((value) => value || undefined),
  topic: z.enum(CONTACT_TOPICS),
  message: z.string().trim().min(10, "Add a little more detail (10+ characters)").max(5000, "Keep it under 5,000 characters"),
  source: z.string().trim().max(200).regex(/^\/[\w\-/]*$/).optional().catch(undefined),
  /** Honeypot: hidden from people, filled in by bots. */
  website: z.string().max(200).optional(),
});
export type ContactRequestInput = z.input<typeof contactRequestSchema>;

const DUPLICATE_WINDOW_MS = 10 * 60_000;

export async function submitContactRequest(input: ContactRequestInput, meta: { ip?: string | null } = {}): Promise<{ id: string | null }> {
  const data = contactRequestSchema.parse(input);
  const ipHash = meta.ip ? hashToken(`contact:${meta.ip}`) : null;

  // Bots fill the hidden field. Answer as if it worked so they learn nothing.
  if (data.website) {
    logger.info({ ipHash }, "contact form honeypot triggered");
    return { id: null };
  }

  const duplicate = await prisma.contactRequest.findFirst({
    where: { email: data.email, message: data.message, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
    select: { id: true },
  });
  if (duplicate) return { id: duplicate.id };

  const request = await prisma.contactRequest.create({
    data: { name: data.name, email: data.email, company: data.company ?? null, topic: data.topic, message: data.message, source: data.source ?? null, ipHash },
  });

  const topic = CONTACT_TOPIC_LABELS[data.topic];
  const summary = [`From: ${data.name} <${data.email}>`, data.company ? `Company: ${data.company}` : null, `Topic: ${topic}`, data.source ? `Page: ${data.source}` : null, "", data.message].filter((line) => line !== null).join("\n");
  const results = await Promise.allSettled([
    sendTransactionalEmail({ to: brand.supportEmail, subject: `[Contact] ${topic} — ${data.name}`, text: summary }),
    sendTransactionalEmail({
      to: data.email,
      subject: `We got your message — ${brand.name}`,
      text: `Hi ${data.name},\n\nThanks for writing to ${brand.name}. We've received your message about "${topic}" and will reply to this address.\n\nYour message:\n${data.message}\n\n— The ${brand.name} team`,
      html: simpleEmailHtml("We got your message", `Hi ${data.name}, thanks for writing to ${brand.name}. We've received your message about "${topic}" and will reply to this address.`),
    }),
  ]);
  for (const result of results) {
    if (result.status === "rejected") logger.error({ err: result.reason, contactRequestId: request.id }, "contact notification email failed");
  }
  return { id: request.id };
}
