import type { Metadata } from "next";
import { brand } from "@repo/config";
import { LegalView, type LegalSection } from "@/components/marketing/company-views";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `What ${brand.name} collects, why, and the choices you have.`,
};

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    paragraphs: [`${brand.name} is operated by ${brand.legalName} (“we”, “us”). This policy explains what personal information we process when you visit ${brand.websiteUrl}, create an account or use the product, and what you can do about it.`],
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    paragraphs: ["We collect only what we need to run the service:"],
    bullets: [
      "Account details — your name, email address, password (stored only as a secure hash by our authentication system) and workspace settings.",
      "Workspace content — leads, contacts, messages, call transcripts, deals, quotes and other records you create, import or discover.",
      "Usage records — events such as messages sent or leads discovered, used for analytics, plan limits and billing.",
      "Technical logs — request identifiers, timestamps and errors, used to keep the service reliable and secure.",
      "Contact form messages — your name, email, company, topic and message, plus a one-way hash of your IP address for abuse prevention.",
    ],
  },
  {
    id: "lead-data",
    title: "Business and lead data",
    paragraphs: [
      "Leads come from public business sources (such as mapping providers and a business's own website) and from files you import. Each lead shows where its information came from.",
      "When you contact leads, you are responsible for having a lawful basis to do so. The product helps: it adds unsubscribe links, honours opt-outs across channels, enforces WhatsApp opt-in rules and checks calling consent, DND and quiet hours.",
    ],
  },
  {
    id: "how-we-use",
    title: "How we use information",
    paragraphs: ["We use information to provide and secure the service, measure usage against your plan, respond to support requests and improve the product. We do not sell personal information."],
  },
  {
    id: "ai",
    title: "AI processing",
    paragraphs: [
      "Features such as qualification, message drafting, call analysis and insights send the relevant content to the AI provider configured for the service (for example Anthropic, OpenAI or Google). We send only what a task needs.",
      "We do not use your workspace content to train our own models.",
    ],
  },
  {
    id: "providers",
    title: "Service providers",
    paragraphs: ["We rely on providers to deliver parts of the service. Depending on what you connect, these can include:"],
    bullets: ["Email delivery (Resend, SendGrid or your SMTP server)", "WhatsApp messaging (Meta's WhatsApp Cloud API)", "Voice calls (Twilio or Vapi)", "Payments (Stripe)", "AI models (Anthropic, OpenAI, Google)", "Hosting and databases"],
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    paragraphs: ["We use an essential cookie to keep you signed in. Your browser also stores preferences such as the colour theme. We don't use advertising or cross-site tracking cookies."],
  },
  {
    id: "retention",
    title: "Retention and deletion",
    paragraphs: [`We keep workspace data while your account is active. You can export records as CSV and delete records at any time. To delete your account and its data, email ${brand.supportEmail}.`],
  },
  {
    id: "security",
    title: "Security",
    paragraphs: ["Workspaces are isolated from each other, connected provider credentials are encrypted at rest, API keys are stored only as hashes and sensitive actions are audited. See the Security page for details."],
  },
  {
    id: "rights",
    title: "Your rights",
    paragraphs: [`Depending on where you live, you may have the right to access, correct, export or delete your personal information, or to object to certain processing. Email ${brand.supportEmail} and we'll help.`],
  },
  {
    id: "changes",
    title: "Changes to this policy",
    paragraphs: ["If we make material changes, we'll update the date above and, where appropriate, tell you in the product or by email."],
  },
];

export default function PrivacyPage() {
  return <LegalView title="Privacy policy" updated="22 September 2026" intro={`How ${brand.name} handles personal information — in plain language.`} sections={SECTIONS} />;
}
