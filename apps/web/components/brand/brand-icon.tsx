import {
  siAnthropic,
  siGmail,
  siGooglegemini,
  siGooglemaps,
  siMeta,
  siN8n,
  siRazorpay,
  siResend,
  siStripe,
  siWhatsapp,
} from "simple-icons";
import { Mail } from "lucide-react";
import { cn } from "@repo/ui";

/**
 * Brand marks so owners recognise each service at a glance. Glyphs come from Simple Icons (CC0);
 * brands it no longer ships (their owners asked) get a tile in the brand colour with initials.
 * Names and marks belong to their owners and are used only to identify the service.
 */
type Brand = { title: string; hex: string; path?: string; letters?: string; dark?: boolean };

const BRANDS: Record<string, Brand> = {
  anthropic: { title: "Anthropic", hex: siAnthropic.hex, path: siAnthropic.path },
  openai: { title: "OpenAI", hex: "000000", letters: "AI" },
  google: { title: "Google Gemini", hex: siGooglegemini.hex, path: siGooglegemini.path },
  google_places: { title: "Google Places", hex: siGooglemaps.hex, path: siGooglemaps.path },
  resend: { title: "Resend", hex: siResend.hex, path: siResend.path },
  sendgrid: { title: "SendGrid", hex: "1A82E2", letters: "SG" },
  meta: { title: "WhatsApp", hex: siWhatsapp.hex, path: siWhatsapp.path },
  whatsapp: { title: "WhatsApp", hex: siWhatsapp.hex, path: siWhatsapp.path },
  twilio: { title: "Twilio", hex: "F22F46", letters: "Tw" },
  vapi: { title: "Vapi", hex: "5DFECA", letters: "V", dark: true },
  slack: { title: "Slack", hex: "4A154B", letters: "S" },
  gmail: { title: "Gmail", hex: siGmail.hex, path: siGmail.path },
  facebook: { title: "Meta", hex: siMeta.hex, path: siMeta.path },
  n8n: { title: "n8n", hex: siN8n.hex, path: siN8n.path },
  stripe: { title: "Stripe", hex: siStripe.hex, path: siStripe.path },
  razorpay: { title: "Razorpay", hex: siRazorpay.hex, path: siRazorpay.path },
};

export function hasBrand(key: string) {
  return key in BRANDS;
}

/** A rounded app-icon style tile: the brand colour with its white mark. */
export function BrandIcon({
  brand,
  className,
  muted = false,
}: {
  brand: string;
  className?: string;
  muted?: boolean;
}) {
  const item = BRANDS[brand];
  const base = cn(
    "flex size-10 shrink-0 items-center justify-center rounded-xl",
    muted && "opacity-60 grayscale",
    className,
  );
  if (!item) {
    // SMTP and anything generic: a neutral mail tile.
    return (
      <span
        className={cn(base, "border border-border bg-surface-muted text-foreground-secondary")}
        aria-hidden
      >
        <Mail className="size-[45%]" />
      </span>
    );
  }
  return (
    <span
      className={base}
      style={{ backgroundColor: `#${item.hex}` }}
      title={item.title}
      aria-hidden
    >
      {item.path ? (
        <svg viewBox="0 0 24 24" className="size-[52%]" fill="#fff">
          <path d={item.path} />
        </svg>
      ) : (
        <span
          className={cn(
            "text-[13px] font-bold tracking-tight",
            item.dark ? "text-[#0b1f1a]" : "text-white",
          )}
        >
          {item.letters}
        </span>
      )}
    </span>
  );
}

/** The WhatsApp mark in its own green, sized like a nav icon (accepts the same className). */
export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(className, "text-[#25D366]")}
      fill="currentColor"
      aria-hidden
    >
      <path d={siWhatsapp.path} />
    </svg>
  );
}
