import {
  BarChart3,
  Briefcase,
  Building2,
  Code2,
  Factory,
  Handshake,
  Info,
  Mail,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  Telescope,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { brand } from "@repo/config";

/**
 * Content for the public site: product pages, use cases, navigation and the site search
 * index. Everything here describes what the product does — no customer names, logos,
 * testimonials or outcome statistics.
 */

export type DemoKey = "discovery" | "outreach" | "calling" | "workflows" | "crm" | "analytics";

export interface Capability {
  id: string;
  title: string;
  body: string;
}

export interface Product {
  slug: string;
  name: string;
  icon: LucideIcon;
  /** One line for menus and cards. */
  summary: string;
  eyebrow: string;
  headline: string;
  /** Part of the headline rendered in the brand gradient. */
  highlight: string;
  intro: string;
  demo: DemoKey;
  capabilities: Capability[];
  /** Deep-dive rows: a title, a paragraph and three points. */
  details: Array<{ title: string; body: string; points: string[] }>;
  faqs: Array<{ q: string; a: string }>;
  keywords: string[];
}

export const PRODUCTS: Product[] = [
  {
    slug: "lead-discovery",
    name: "Lead discovery",
    icon: Telescope,
    summary: "Find and score businesses that match your ideal customer.",
    eyebrow: "Lead engine",
    headline: "Describe your buyer. Get a scored list in minutes.",
    highlight: "scored list",
    intro: "Ask in plain words. Discovery turns your sentence into search criteria, searches providers such as Google Places, enriches every business from public sources, removes duplicates and scores each lead with the reasons shown.",
    demo: "discovery",
    capabilities: [
      { id: "natural-language", title: "Natural-language search", body: "“Cafés in South Delhi with 2+ outlets” becomes category, area and signal filters you can edit before running." },
      { id: "enrichment", title: "Enrichment from public sources", body: "Website, phone, social profiles, ratings and business signals, each with the source it came from." },
      { id: "dedupe", title: "De-duplication", body: "Leads are matched by website, phone and name + city, so the same business never lands twice." },
      { id: "scoring", title: "Transparent scoring", body: "Industry fit, location, signals and AI judgement, factor by factor. No black-box number." },
      { id: "import", title: "CSV import and export", body: "Bring your own lists, map columns, and export any view whenever you like." },
      { id: "saved-searches", title: "Saved searches and views", body: "Re-run a search later and keep filtered views of your lead table for the team." },
    ],
    details: [
      {
        title: "Your ideal customer, written down",
        body: "Onboarding reads your website and description and drafts an ideal customer profile — industries, locations, company size and buying signals. You edit it; discovery and scoring use it.",
        points: ["Edit every field", "Used by scoring and outreach", "Change it any time"],
      },
      {
        title: "A score you can argue with",
        body: "Each lead shows how its score was built. Disagree with a factor? Change the profile and rescore. High-fit leads go to campaigns; the rest stay out of your way.",
        points: ["Factor-by-factor breakdown", "Fit bands: high, medium, low", "Rescore after profile changes"],
      },
    ],
    faqs: [
      { q: "Where does lead data come from?", a: "From discovery providers such as Google Places, the business's own public website and profiles, and your CSV imports. Every field shows its source." },
      { q: "Can I run discovery without an API key?", a: "Yes. Without a Google key, discovery finds real businesses from OpenStreetMap's open map data. Add a Google Places key for ratings and review counts." },
      { q: "How many leads can I find?", a: "It depends on your plan's monthly lead credits and the results allowed per search. See Pricing for the numbers." },
    ],
    keywords: ["leads", "prospecting", "search", "google places", "enrichment", "scoring", "icp", "find", "import", "csv"],
  },
  {
    slug: "ai-outreach",
    name: "AI outreach",
    icon: Mail,
    summary: "Personalised email and WhatsApp sequences you approve.",
    eyebrow: "Email & WhatsApp",
    headline: "Outreach that sounds like you read their website. Because it did.",
    highlight: "read their website",
    intro: "Campaigns write each message from facts about the business and your offer, in your tone, then send them as sequences that stop the moment someone replies. You choose how much runs on its own.",
    demo: "outreach",
    capabilities: [
      { id: "personalisation", title: "Grounded personalisation", body: "Messages cite real details from each lead — never invented ones — and you can see which facts were used." },
      { id: "sequences", title: "Sequences with stop-on-reply", body: "First message and follow-ups with delays; replies, opt-outs and bounces stop the sequence." },
      { id: "autonomy", title: "Manual, assisted or automated", body: "Review every draft, approve in bulk, or let a campaign send by itself within your limits." },
      { id: "whatsapp", title: "Official WhatsApp Cloud API", body: "Approved templates, opt-in and the 24-hour window are enforced for you." },
      { id: "inbox", title: "Unified inbox", body: "Replies from every channel in one place, classified by intent with a suggested response." },
      { id: "compliance", title: "Compliance by default", body: "Unsubscribe links, one-click unsubscribe headers and suppression lists across channels." },
    ],
    details: [
      {
        title: "A review queue that respects your time",
        body: "Assisted campaigns queue drafts for approval. Edit a line, approve, or regenerate — the queue shows the lead's facts beside each message.",
        points: ["Approve one or many", "Edit before sending", "See the facts behind each line"],
      },
      {
        title: "Your own domain and number",
        body: "Connect Resend, SendGrid or SMTP for email and the WhatsApp Cloud API for messages. Provider keys are encrypted and never shown again.",
        points: ["Signed provider webhooks", "Delivery, open and reply tracking", "Per-workspace sending limits"],
      },
    ],
    faqs: [
      { q: "Will it send anything without my approval?", a: "Only in Automated mode, which you turn on per campaign. Manual and Assisted campaigns wait for you." },
      { q: "Can I write my own templates?", a: "Yes. Write steps yourself, let AI draft them, or mix both. Variables such as the lead's name and city are filled in for you." },
      { q: "What happens when someone replies?", a: "Their sequence stops, the reply is classified (interested, meeting request, pricing, not now…) and it appears in the inbox with a suggested answer." },
    ],
    keywords: ["email", "whatsapp", "campaigns", "sequences", "follow-up", "inbox", "personalization", "templates", "outreach"],
  },
  {
    slug: "ai-calling",
    name: "AI calling",
    icon: PhoneCall,
    summary: "A voice agent that briefs, calls, handles objections and books.",
    eyebrow: "Voice agent",
    headline: "Calls that end with a meeting on the calendar.",
    highlight: "meeting on the calendar",
    intro: "Every call starts with a brief built from the lead and the conversation so far. The AI agent says it's an AI, answers objections honestly, and books the time the prospect actually agreed to. You get the transcript and an analysis after each call.",
    demo: "calling",
    capabilities: [
      { id: "briefs", title: "Call briefs", body: "Talking points, likely objections and the goal for each call, from the lead's data and history." },
      { id: "live", title: "Live transcripts", body: "Follow a call as it happens, line by line." },
      { id: "analysis", title: "Post-call analysis", body: "Outcome, interest level, objections and the agreed next step, saved to the lead." },
      { id: "booking", title: "Meetings at the agreed time", body: "When the prospect says “Thursday afternoon”, the meeting lands on Thursday afternoon." },
      { id: "consent", title: "Consent and calling hours", body: "Consent attestation, DND checks, suppression and quiet hours are checked before every call." },
      { id: "providers", title: "Vapi or Twilio", body: "Use a hosted Vapi agent or Twilio with a turn-by-turn AI conversation." },
    ],
    details: [
      {
        title: "Honest by design",
        body: "The agent introduces itself as an AI assistant, stays on the facts in its brief, and never promises prices that aren't in your catalog.",
        points: ["Announces it's an AI", "Grounded in the brief", "Hands off to a person when asked"],
      },
      {
        title: "Nothing dials without you",
        body: "Calls are prepared first and start only when you confirm — or when a campaign step you approved places them within calling hours.",
        points: ["Explicit start confirmation", "Voice minutes metered per plan", "Unanswered calls cost nothing"],
      },
    ],
    faqs: [
      { q: "Does the agent pretend to be human?", a: "No. It announces that it's an AI assistant calling on your behalf." },
      { q: "Can I call manually instead?", a: "Yes. Log manual calls with notes and outcomes; they appear in the same history and analytics." },
      { q: "Which plans include the voice agent?", a: "The AI voice agent is included on plans with voice minutes. See Pricing." },
    ],
    keywords: ["calls", "voice", "phone", "vapi", "twilio", "transcript", "meeting", "booking", "dialer", "cold call"],
  },
  {
    slug: "workflows",
    name: "Workflows & n8n",
    icon: Workflow,
    summary: "Visual automations with test runs and full history.",
    eyebrow: "Automation",
    headline: "Automate the busywork. See every step it took.",
    highlight: "every step it took",
    intro: "Build automations visually: trigger on events, schedules or webhooks, add conditions, waits and actions, test them on a real lead, then switch them on. Every run keeps a step-by-step history and can be retried from the step that failed.",
    demo: "workflows",
    capabilities: [
      { id: "triggers", title: "Event, schedule and webhook triggers", body: "Start on a reply, a score change, a deal stage, a time of day or an inbound webhook." },
      { id: "steps", title: "Conditions, waits and actions", body: "Branch on lead data, wait for days, send email, create tasks, prepare calls, move deals." },
      { id: "tests", title: "Dry runs on real leads", body: "See exactly what a workflow would do before it does anything." },
      { id: "history", title: "Run history and retries", body: "Every step's input, output and timing — retry from the failed step." },
      { id: "n8n", title: "Two-way n8n", body: "Call n8n with signed requests and let n8n resume a waiting run with its result." },
      { id: "webhooks", title: "Outbound webhooks", body: "Send signed events to your own systems, with retries and delivery logs." },
    ],
    details: [
      {
        title: "Templates to start from",
        body: "Follow up on positive replies, alert the team about hot leads, prepare calls for leads who opened twice — start from a template and adjust.",
        points: ["Ready-made templates", "Variables with friendly names", "Inline validation"],
      },
      {
        title: "Built to run unattended",
        body: "Runs are triggered exactly once per event, progress is saved after every step, and interrupted runs resume where they stopped.",
        points: ["Exactly-once triggering", "Persisted progress", "Signed and retried webhooks"],
      },
    ],
    faqs: [
      { q: "Do I need n8n?", a: "No. Workflows run on their own; n8n is optional for connecting other tools." },
      { q: "Can I test without sending anything?", a: "Yes. Test runs are dry runs: they show what each step would do on a lead you pick." },
      { q: "What happens if a step fails?", a: "The run stops at that step with the error, and you can retry it from there once the cause is fixed." },
    ],
    keywords: ["automation", "workflow", "n8n", "zapier", "webhook", "trigger", "no-code", "integrations"],
  },
  {
    slug: "crm-quotes",
    name: "CRM & quotes",
    icon: Handshake,
    summary: "A pipeline that updates itself, with priced quotes and PDFs.",
    eyebrow: "CRM & quotations",
    headline: "From “interested” to a signed quote without leaving the tab.",
    highlight: "signed quote",
    intro: "Replies, calls and meetings move deals forward automatically. When it's time to price, AI drafts a quote from the conversation using only your catalog, you adjust it, and the prospect accepts online — which wins the deal.",
    demo: "crm",
    capabilities: [
      { id: "pipeline", title: "Drag-and-drop pipeline", body: "New to Won, kept in step with lead statuses automatically — forward only." },
      { id: "deals", title: "Deal workspace", body: "Value, probability, owner, next steps, meetings with calendar invites, notes and activity." },
      { id: "catalog", title: "Catalog and pricing rules", body: "Products and services with volume tiers, discounts, minimum orders, setup-fee waivers and tax." },
      { id: "ai-quotes", title: "AI quote drafts", body: "Drafted from what the prospect asked for, priced only from your catalog." },
      { id: "sharing", title: "PDF, email, WhatsApp and links", body: "Send a quote any way you like; views are tracked." },
      { id: "acceptance", title: "Online acceptance", body: "Prospects accept or decline on a public page. Accepting wins the deal." },
    ],
    details: [
      {
        title: "A pipeline you don't have to update",
        body: "A positive reply opens a deal. A booked meeting moves it to Meeting. A sent quote moves it to Proposal. You only drag when you want to.",
        points: ["Forward-only automation", "Lost reasons feed insights", "Weighted forecast"],
      },
      {
        title: "Quotes that never guess",
        body: "Prices come from your catalog or a price you type. Missing prices are flagged instead of filled in.",
        points: ["Numbered quotes", "Validity and expiry", "Tax and discounts applied correctly"],
      },
    ],
    faqs: [
      { q: "Is it a full CRM?", a: "It's a focused CRM for what outreach produces: companies, contacts, deals, tasks, meetings and quotes." },
      { q: "Can prospects sign quotes?", a: "They accept online by typing their name on the quote page; the acceptance is recorded with the time." },
      { q: "Can I export my pipeline?", a: "Yes, as CSV at any time." },
    ],
    keywords: ["crm", "pipeline", "deals", "quotes", "quotation", "pdf", "pricing", "catalog", "proposal", "tasks", "meetings"],
  },
  {
    slug: "analytics",
    name: "Analytics & insights",
    icon: BarChart3,
    summary: "Funnels, cohorts and costs — plus insights with evidence.",
    eyebrow: "Analytics",
    headline: "Know what works — and how sure you can be.",
    highlight: "how sure you can be",
    intro: "Every number comes from the event log. Rates are per contacted lead, compared with the previous period, with the counts behind them. AI insights are computed in code with sample sizes and significance tests, and AI may only reword them.",
    demo: "analytics",
    capabilities: [
      { id: "metrics", title: "20 defined metrics", body: "From qualification rate to cost per meeting, each with a written definition." },
      { id: "breakdowns", title: "Breakdowns", body: "By channel, campaign, area, business type, source, score band and fit." },
      { id: "cohorts", title: "Cohorts and heatmaps", body: "Weekly contact cohorts and a reply heatmap in your timezone." },
      { id: "costs", title: "Costs and ROI", body: "AI, channel, voice and plan costs in your currency, with ROI as a multiple." },
      { id: "insights", title: "Insights with evidence", body: "Two-proportion tests, minimum samples and a stated confidence on every insight." },
      { id: "export", title: "CSV export", body: "Every metric and breakdown, for the current filters." },
    ],
    details: [
      {
        title: "Filters that travel",
        body: "Period, campaign, channel, city, business type, source and score filters live in the URL — share a view with a link.",
        points: ["Previous-period comparison", "Counts behind every rate", "Table view for every chart"],
      },
      {
        title: "Insights that show their work",
        body: "“AI calls get more positive responses than email” comes with the counts, the method, the p-value and a confidence level.",
        points: ["Minimum sample sizes", "No invented numbers", "Dismiss or restore"],
      },
    ],
    faqs: [
      { q: "Are the numbers estimates?", a: "Counts and rates are exact, from recorded events. Costs are estimates and are labelled as such." },
      { q: "What does the AI do in insights?", a: "It can reword an insight. Any wording that adds a number the analysis didn't produce is rejected." },
      { q: "Which plans include advanced analytics?", a: "Core analytics are on every plan; cohorts, heatmaps, costs and AI insights are on paid plans." },
    ],
    keywords: ["analytics", "reports", "dashboard", "metrics", "insights", "roi", "funnel", "cohorts", "export"],
  },
];

export interface UseCase {
  slug: string;
  name: string;
  icon: LucideIcon;
  summary: string;
  headline: string;
  highlight: string;
  intro: string;
  /** An example discovery request for this kind of team. */
  exampleSearch: string;
  exampleMessage: string;
  playbook: Array<{ title: string; body: string }>;
  products: string[];
  keywords: string[];
}

export const USE_CASES: UseCase[] = [
  {
    slug: "agencies",
    name: "Marketing & creative agencies",
    icon: Briefcase,
    summary: "Fill the calendar with local businesses that need what you do.",
    headline: "Stop waiting for referrals. Pick your next clients.",
    highlight: "Pick your next clients",
    intro: "Agencies selling social media, websites, ads or content to local businesses use discovery to find companies with visible gaps, and outreach that points at those gaps specifically.",
    exampleSearch: "Restaurants in Gurgaon with under 50 Google reviews and no website",
    exampleMessage: "Saw Spice Route's menu photos on Google — they deserve a site that takes bookings. We build those for restaurants in Gurgaon. Worth a quick look?",
    playbook: [
      { title: "Find visible gaps", body: "Search for businesses missing a website, with few reviews or quiet social profiles." },
      { title: "Lead with the gap", body: "Messages reference the specific gap, not a generic pitch." },
      { title: "Quote from your packages", body: "Retainers and projects from your catalog, with setup fees and volume discounts." },
    ],
    products: ["lead-discovery", "ai-outreach", "crm-quotes"],
    keywords: ["agency", "marketing agency", "social media", "web design", "creative"],
  },
  {
    slug: "b2b-services",
    name: "B2B services",
    icon: Building2,
    summary: "Consultants, IT services and facilities teams reaching local companies.",
    headline: "A steady pipeline for services sold business to business.",
    highlight: "steady pipeline",
    intro: "IT support, accounting, cleaning, security, HR and other service firms use scoring to focus on companies that fit — by size, sector and area — and calls to reach decision makers faster.",
    exampleSearch: "Clinics and diagnostic labs in Noida with 10+ staff",
    exampleMessage: "Hi Dr. Mehra — we look after IT and data backups for diagnostic labs in Noida. Would a short call about keeping patient records safe be useful?",
    playbook: [
      { title: "Score by fit", body: "Industry, size and location decide who gets outreach first." },
      { title: "Mix channels", body: "Email first, a WhatsApp nudge, then an AI call to book the meeting." },
      { title: "Track next steps", body: "Deals, tasks and meetings keep follow-ups from slipping." },
    ],
    products: ["lead-discovery", "ai-calling", "crm-quotes"],
    keywords: ["services", "consulting", "it services", "accounting", "facilities", "b2b"],
  },
  {
    slug: "manufacturers",
    name: "Manufacturers & distributors",
    icon: Factory,
    summary: "Reach retailers, resellers and buyers across new cities.",
    headline: "New dealers and buyers, city by city.",
    highlight: "city by city",
    intro: "Manufacturers and distributors use discovery to map retailers and resellers in new territories, WhatsApp for quick introductions, and quotes with volume pricing for first orders.",
    exampleSearch: "Hardware and sanitaryware stores in Jaipur",
    exampleMessage: "Namaste — we manufacture CP fittings and are appointing dealers in Jaipur. Can I share our dealer price list and send samples?",
    playbook: [
      { title: "Map a territory", body: "Search a city or area for the store types you sell through." },
      { title: "Introduce on WhatsApp", body: "Approved templates with opt-in, then a conversation when they reply." },
      { title: "Quote volume pricing", body: "Tiered prices and minimum order quantities from your catalog." },
    ],
    products: ["lead-discovery", "ai-outreach", "crm-quotes"],
    keywords: ["manufacturer", "distributor", "dealers", "retailers", "wholesale", "b2b sales"],
  },
  {
    slug: "software",
    name: "Software & SaaS",
    icon: Code2,
    summary: "Outbound to the SMBs your product is built for.",
    headline: "Outbound for software that small businesses need.",
    highlight: "small businesses need",
    intro: "Teams selling POS, booking, billing or vertical software use signals — like no online booking — to find businesses that need it, and workflows to route hot replies to sales in seconds.",
    exampleSearch: "Salons in Bengaluru with no online booking",
    exampleMessage: "Hi Anjali — noticed Glow Studio takes bookings by phone only. Our salon app adds online booking and reminders. Want a 10-minute demo?",
    playbook: [
      { title: "Target by signal", body: "Find businesses whose public profile shows they need your product." },
      { title: "Automate hand-offs", body: "Workflows alert sales and create tasks the moment a lead replies positively." },
      { title: "Measure by segment", body: "See which areas and business types convert, with the numbers behind them." },
    ],
    products: ["lead-discovery", "workflows", "analytics"],
    keywords: ["saas", "software", "startup", "product", "demo", "smb"],
  },
];

export const COMPANY_LINKS = [
  { href: "/about", label: "About", description: `Why we're building ${brand.name}`, icon: Info },
  { href: "/security", label: "Security", description: "How your data is protected", icon: ShieldCheck },
  { href: "/contact", label: "Contact", description: "Talk to us about anything", icon: MessageSquare },
];

export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/security", label: "Security" },
];

export function productBySlug(slug: string) {
  return PRODUCTS.find((product) => product.slug === slug);
}

export function findUseCase(slug: string) {
  return USE_CASES.find((item) => item.slug === slug);
}

/** Questions shown on the home page and pricing page; also searchable. */
export const GENERAL_FAQS = [
  { q: "Does the AI send messages without my approval?", a: "Only if you choose Automated mode for a campaign. In Manual and Assisted modes every AI-written message waits in a review queue, and AI calls always need an explicit start." },
  { q: "Where do the leads come from?", a: "From discovery providers such as Google Places and public business information, plus your own CSV imports. Every lead shows its sources, and nothing is scraped from private data." },
  { q: "Is it compliant with email, WhatsApp and calling rules?", a: "Unsubscribe links and one-click unsubscribe are added to email, opt-outs are enforced across channels, WhatsApp uses approved templates and the 24-hour window, and AI calls require consent attestation, DND checks and calling hours." },
  { q: "Can I use my own email domain and WhatsApp number?", a: "Yes — connect Resend, SendGrid or SMTP for email, the official WhatsApp Cloud API for WhatsApp, and Twilio or Vapi for voice. Keys are encrypted." },
  { q: "Will the AI make up prices or facts?", a: "No. Prices only come from your catalog or a price you type. Agents are grounded in each lead’s real data, and AI insights can’t add numbers the analysis didn’t produce." },
  { q: "What do I need to connect?", a: "Nothing to start finding leads: real businesses come from OpenStreetMap, or Google Places if you add a key. To send email or WhatsApp and place calls, you connect your own accounts, and AI features use your AI key." },
];

export const PRICING_FAQS = [
  { q: "Is there a free plan?", a: "Yes. The free plan includes the lead engine, email outreach, the CRM pipeline and core analytics, with monthly limits. No card needed." },
  { q: "What counts as a lead credit?", a: "Each new lead added by discovery or import uses one credit. Re-running a search doesn't charge for leads you already have." },
  { q: "What are AI credits?", a: "Qualification, message writing, call analysis and other AI actions use credits. Cached results are free." },
  { q: "How can I pay?", a: "By card through Stripe — billed monthly, cancel anytime — or by UPI through Razorpay in rupees, one month at a time with no auto-debit. Card and UPI details go straight to the payment provider." },
  { q: "Can I change plans later?", a: "Yes. Upgrades apply as soon as the payment goes through. Moving to Free keeps your paid plan until the end of the month you paid for." },
  { q: "What happens when I hit a limit?", a: "The action that needs more is blocked with a message naming the limit. Nothing you already have is removed, and limits reset each billing period." },
];

// ----------------------------------------------------------------------------- Site search

export interface SearchEntry {
  id: string;
  group: "Pages" | "Features" | "Use cases" | "Questions";
  title: string;
  description: string;
  href: string;
  keywords: string;
}

export function buildSearchIndex(): SearchEntry[] {
  const pages: SearchEntry[] = [
    { id: "home", group: "Pages", title: "Home", description: brand.tagline, href: "/", keywords: "home start" },
    { id: "platform", group: "Pages", title: "Platform overview", description: "Every part of the product on one page", href: "/product", keywords: "features product platform overview" },
    { id: "pricing", group: "Pages", title: "Pricing", description: "Plans, limits and what's included", href: "/pricing", keywords: "price plans cost billing free pro scale compare" },
    { id: "use-cases", group: "Pages", title: "Use cases", description: "How different teams use the product", href: "/use-cases", keywords: "solutions industries teams" },
    ...COMPANY_LINKS.map((link) => ({ id: link.href, group: "Pages" as const, title: link.label, description: link.description, href: link.href, keywords: link.label.toLowerCase() })),
    { id: "privacy", group: "Pages", title: "Privacy policy", description: "What we collect and why", href: "/privacy", keywords: "privacy gdpr data personal" },
    { id: "terms", group: "Pages", title: "Terms of service", description: "The rules for using the product", href: "/terms", keywords: "terms legal agreement" },
    { id: "signup", group: "Pages", title: "Create an account", description: "Start on the free plan", href: "/signup", keywords: "signup register start free trial" },
    { id: "login", group: "Pages", title: "Sign in", description: "Open your workspace", href: "/login", keywords: "login sign in demo" },
  ];
  const features = PRODUCTS.flatMap((product) => [
    { id: product.slug, group: "Features" as const, title: product.name, description: product.summary, href: `/product/${product.slug}`, keywords: product.keywords.join(" ") },
    ...product.capabilities.map((capability) => ({
      id: `${product.slug}-${capability.id}`,
      group: "Features" as const,
      title: capability.title,
      description: `${product.name} · ${capability.body}`,
      href: `/product/${product.slug}#${capability.id}`,
      keywords: product.keywords.join(" "),
    })),
  ]);
  const useCases = USE_CASES.map((item) => ({ id: item.slug, group: "Use cases" as const, title: item.name, description: item.summary, href: `/use-cases/${item.slug}`, keywords: item.keywords.join(" ") }));
  const questions = [
    ...GENERAL_FAQS.map((item, index) => ({ id: `faq-${index}`, group: "Questions" as const, title: item.q, description: item.a, href: "/#faq", keywords: "" })),
    ...PRICING_FAQS.map((item, index) => ({ id: `pricing-faq-${index}`, group: "Questions" as const, title: item.q, description: item.a, href: "/pricing#faq", keywords: "pricing" })),
    ...PRODUCTS.flatMap((product) => product.faqs.map((item, index) => ({ id: `${product.slug}-faq-${index}`, group: "Questions" as const, title: item.q, description: item.a, href: `/product/${product.slug}#faq`, keywords: product.keywords.join(" ") }))),
  ];
  return [...pages, ...features, ...useCases, ...questions];
}
