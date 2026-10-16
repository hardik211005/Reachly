/**
 * Short "how to connect" guides, one per provider, written for business owners (no jargon where
 * it can be avoided). Steps that mention the webhook URL refer to the box shown once connected.
 */
export interface ConnectGuide {
  /** Where to start: the page in the provider's dashboard. */
  start: { label: string; url: string };
  steps: string[];
  /** Roughly how long it takes. */
  time: string;
  note?: string;
}

export const CONNECT_GUIDES: Record<string, ConnectGuide> = {
  anthropic: {
    start: {
      label: "Open the Anthropic console",
      url: "https://console.anthropic.com/settings/keys",
    },
    time: "2 minutes",
    steps: [
      "Sign in (or create an account) at console.anthropic.com.",
      "Go to Settings → API keys and click Create key. Name it “Reachly”.",
      "Add some credit under Settings → Billing — the key won’t work without it.",
      "Paste the key here and click Connect. Choosing a model is optional.",
    ],
  },
  openai: {
    start: { label: "Open OpenAI API keys", url: "https://platform.openai.com/api-keys" },
    time: "2 minutes",
    steps: [
      "Sign in at platform.openai.com.",
      "Open API keys and click Create new secret key. Name it “Reachly”.",
      "Add credit under Settings → Billing.",
      "Paste the key here and click Connect.",
    ],
  },
  google: {
    start: { label: "Open Google AI Studio", url: "https://aistudio.google.com/apikey" },
    time: "1 minute",
    steps: [
      "Sign in to Google AI Studio with your Google account.",
      "Click Create API key and pick (or create) a project.",
      "Copy the key, paste it here and click Connect.",
    ],
  },
  google_places: {
    start: {
      label: "Open Google Cloud console",
      url: "https://console.cloud.google.com/apis/library/places.googleapis.com",
    },
    time: "5 minutes",
    steps: [
      "Sign in to Google Cloud and create a project (any name).",
      "Turn on billing for the project — Google gives a monthly free allowance.",
      "Enable “Places API (New)” for the project.",
      "Go to APIs & Services → Credentials → Create credentials → API key.",
      "Recommended: restrict the key to the Places API. Then paste it here.",
    ],
  },
  resend: {
    start: { label: "Open Resend", url: "https://resend.com/domains" },
    time: "10 minutes (plus DNS wait)",
    steps: [
      "In Resend, open Domains → Add domain and enter your business domain.",
      "Add the DNS records Resend shows at your domain provider (GoDaddy, Hostinger, Cloudflare…). Wait until it says Verified.",
      "Open API keys → Create API key with “Sending access”. Paste it here.",
      "Fill in the From email using that domain (for example hello@yourbusiness.com) and click Connect.",
      "Then copy the Webhook URL shown below into Resend → Webhooks, and paste the signing secret it gives you back here. This lets Reachly see deliveries and bounces.",
    ],
  },
  sendgrid: {
    start: {
      label: "Open SendGrid settings",
      url: "https://app.sendgrid.com/settings/sender_auth",
    },
    time: "10 minutes (plus DNS wait)",
    steps: [
      "In SendGrid, open Settings → Sender Authentication and authenticate your domain (add the DNS records it shows).",
      "Open Settings → API Keys → Create API Key with “Mail Send” access. Paste it here.",
      "Fill in the From email on your domain and click Connect.",
      "Then in Settings → Mail Settings → Event Webhook, paste the Webhook URL shown below, turn on Signed Event Webhook and paste its verification key back here.",
    ],
  },
  smtp: {
    start: { label: "Google app passwords", url: "https://myaccount.google.com/apppasswords" },
    time: "5 minutes",
    steps: [
      "Gmail or Google Workspace: turn on 2-Step Verification, then create an App password. Use host smtp.gmail.com, port 587 (STARTTLS), your full email as username and the app password as password.",
      "Microsoft 365 / Outlook: use host smtp.office365.com, port 587 (STARTTLS) and your email and password. Your admin may need to allow “SMTP AUTH” for the mailbox.",
      "Any other email host (Zoho, Hostinger, GoDaddy…): copy the SMTP host, port and login from their help page.",
      "Fill in the From email and click Connect.",
    ],
    note: "Normal mailboxes have daily sending limits (Gmail ≈ 500/day). For bigger campaigns use Resend or SendGrid.",
  },
  meta: {
    start: { label: "Open Meta for Developers", url: "https://developers.facebook.com/apps" },
    time: "20 minutes",
    steps: [
      "At developers.facebook.com, click Create app → choose “Business”, and add the WhatsApp product.",
      "In WhatsApp → API Setup, add your business phone number and verify it with the code Meta sends. Copy the Phone number ID and the WhatsApp Business account ID into the fields here.",
      "In Meta Business Settings → Users → System users, add a system user (Admin), assign your app, and click Generate token with the whatsapp_business_messaging and whatsapp_business_management permissions. That is the permanent access token.",
      "In your app’s Settings → Basic, copy the App secret. Paste everything here and click Connect.",
      "Finally, in WhatsApp → Configuration → Webhook, paste the Webhook URL and Verify token shown below, and subscribe to “messages”. Now replies reach Reachly.",
    ],
    note: "The number you connect can’t stay logged in on the normal WhatsApp app at the same time. Message templates need Meta’s approval before the first message to a new customer.",
  },
  twilio: {
    start: { label: "Open the Twilio console", url: "https://console.twilio.com" },
    time: "10 minutes",
    steps: [
      "Sign in to the Twilio console. On the home page, copy the Account SID and Auth token into the fields here.",
      "Go to Phone Numbers → Buy a number with Voice enabled (Indian numbers need a short verification).",
      "Enter that number in +91… format as the Caller number and click Connect.",
      "Then open the number’s settings and, under “Call status changes”, paste the Webhook URL shown below.",
    ],
  },
  vapi: {
    start: { label: "Open the Vapi dashboard", url: "https://dashboard.vapi.ai" },
    time: "10 minutes",
    steps: [
      "In the Vapi dashboard, open API Keys and copy your private key into the field here.",
      "Open Phone Numbers, create or import a number, and copy its ID.",
      "Click Connect. Then set the Server URL in Vapi to the Webhook URL shown below (and a secret, if you added one here).",
    ],
  },
  slack: {
    start: { label: "Create a Slack app", url: "https://api.slack.com/apps?new_app=1" },
    time: "3 minutes",
    steps: [
      "Click Create New App → From scratch, name it “Reachly” and pick your Slack workspace.",
      "Open Incoming Webhooks, switch it on, then Add New Webhook to Workspace and choose a channel.",
      "Copy the webhook URL, paste it here, click Connect — then Send test to check it lands.",
    ],
  },
};
