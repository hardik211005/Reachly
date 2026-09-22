import type { Metadata } from "next";
import { ContactPageView } from "@/components/marketing/contact-view";

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about plans, setup or your account — send us a message.",
};

const TOPICS = { sales: "SALES", support: "SUPPORT", partnership: "PARTNERSHIP", press: "PRESS", other: "OTHER" } as const;

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const initialTopic = TOPICS[(topic ?? "").toLowerCase() as keyof typeof TOPICS] ?? "SALES";
  return <ContactPageView initialTopic={initialTopic} />;
}
