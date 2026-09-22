import type { Metadata } from "next";
import { brand } from "@repo/config";
import { LegalView, type LegalSection } from "@/components/marketing/company-views";

export const metadata: Metadata = {
  title: "Terms of service",
  description: `The rules for using ${brand.name}.`,
};

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "The agreement",
    paragraphs: [`These terms are an agreement between you (or the organisation you represent) and ${brand.legalName} for the use of ${brand.name}. By creating an account or using the service you accept them.`],
  },
  {
    id: "accounts",
    title: "Accounts and workspaces",
    paragraphs: ["Keep your sign-in details secure and tell us about any unauthorised use. Workspace owners decide who can join and which role each member has, and are responsible for their members' activity."],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    paragraphs: ["You agree not to use the service to:"],
    bullets: [
      "send spam or contact people who have opted out;",
      "break email, messaging, calling, telemarketing or data-protection laws that apply to you, or WhatsApp's business policies;",
      "place calls without the consent and disclosures your jurisdiction requires;",
      "upload unlawful content or data you have no right to use;",
      "probe, disrupt or overload the service, or get around its limits.",
    ],
  },
  {
    id: "your-content",
    title: "Your content",
    paragraphs: ["You own the content you put into the service, including leads you import and messages you write. You give us permission to host and process it only to provide the service to you."],
  },
  {
    id: "ai-output",
    title: "AI-generated output",
    paragraphs: ["AI features draft messages, quotes, analyses and insights. Review output before relying on it. If you turn on automated sending for a campaign, you are responsible for the messages it sends within the limits you set."],
  },
  {
    id: "plans",
    title: "Plans, limits and payment",
    paragraphs: ["Plans and their limits are described on the pricing page. Usage allowances reset each billing period. Paid plans are billed in advance through our payment provider, and you can change or cancel your plan at any time; changes take effect as described in the product."],
  },
  {
    id: "third-parties",
    title: "Connected services",
    paragraphs: ["When you connect services such as an email provider, WhatsApp, a voice provider or n8n, their own terms also apply to your use of them, and any fees they charge are between you and them."],
  },
  {
    id: "availability",
    title: "Availability and changes",
    paragraphs: ["We work to keep the service available and secure, but it is provided “as is”. We may improve or change features; if a change significantly reduces what you pay for, we'll tell you in advance."],
  },
  {
    id: "termination",
    title: "Ending the agreement",
    paragraphs: ["You can stop using the service and close your account at any time. We may suspend accounts that break these terms or put the service or others at risk. You can export your data before closing your account."],
  },
  {
    id: "liability",
    title: "Liability",
    paragraphs: ["To the extent the law allows, we aren't liable for indirect or consequential losses, and our total liability is limited to the amount you paid us in the twelve months before the claim."],
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: [`Questions about these terms? Email ${brand.supportEmail}.`],
  },
];

export default function TermsPage() {
  return <LegalView title="Terms of service" updated="22 September 2026" intro={`The rules for using ${brand.name}, written to be read.`} sections={SECTIONS} />;
}
