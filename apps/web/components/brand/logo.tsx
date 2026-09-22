import { brand } from "@repo/config";
import { cn } from "@repo/ui";

const SIZES = {
  sm: { mark: "size-6", text: "text-[15px]" },
  md: { mark: "size-8", text: "text-[18px]" },
  lg: { mark: "size-9", text: "text-[20px]" },
  xl: { mark: "size-10", text: "text-[23px]" },
} as const;

/** Wordmark + glyph. The glyph is geometric so it survives a rename of the product. */
export function Logo({ className, showName = true, size = "md" }: { className?: string; showName?: boolean; size?: keyof typeof SIZES }) {
  const scale = SIZES[size];
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 24 24" className={cn(scale.mark, "shrink-0")} aria-hidden>
        <rect width="24" height="24" rx="6.5" className="fill-foreground" />
        <path d="M7 16.5 12 7l5 9.5" className="stroke-background" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="13.6" r="1.6" className="fill-accent" />
      </svg>
      {showName ? <span className={cn(scale.text, "font-display font-bold tracking-[-0.03em] text-foreground")}>{brand.name}</span> : null}
    </span>
  );
}
