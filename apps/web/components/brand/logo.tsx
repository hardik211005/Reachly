import { brand } from "@repo/config";
import { cn } from "@repo/ui";

/** Wordmark + glyph. The glyph is geometric so it survives a rename of the product. */
export function Logo({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
        <rect width="24" height="24" rx="6" className="fill-foreground" />
        <path d="M7 16.5 12 7l5 9.5" className="stroke-background" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="13.6" r="1.6" className="fill-background" />
      </svg>
      {showName ? <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{brand.name}</span> : null}
    </span>
  );
}
