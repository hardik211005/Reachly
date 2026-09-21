import Link from "next/link";
import { brand } from "@repo/config";
import { Logo } from "@/components/brand/logo";

const LOOP = [
  { step: "Describe", detail: "what you sell and who buys it" },
  { step: "Discover", detail: "businesses that match, with sources" },
  { step: "Qualify", detail: "every lead scored with visible reasons" },
  { step: "Reach out", detail: "personalised email, WhatsApp and calls" },
  { step: "Close", detail: "replies, meetings and quotes in one CRM" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Link href="/" className="w-fit">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">{children}</div>
        </div>
        <p className="text-xs text-foreground-subtle">
          © {new Date().getFullYear()} {brand.legalName}
        </p>
      </div>
      <aside className="relative hidden overflow-hidden border-l border-border bg-surface lg:flex lg:flex-col lg:justify-center lg:px-14">
        <div className="max-w-md">
          <p className="text-xs font-medium tracking-wide text-foreground-muted uppercase">How it works</p>
          <h2 className="mt-3 text-2xl leading-snug font-semibold tracking-[-0.02em] text-balance">
            Stop searching maps and spreadsheets for customers.
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-foreground-secondary">{brand.description}</p>
          <ol className="mt-10 space-y-0">
            {LOOP.map((item, index) => (
              <li key={item.step} className="relative flex gap-4 pb-6 last:pb-0">
                {index < LOOP.length - 1 ? <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-border" /> : null}
                <span className="relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold text-foreground-secondary tabular">
                  {index + 1}
                </span>
                <div className="pt-0.5">
                  <p className="text-[13px] font-medium">{item.step}</p>
                  <p className="text-[13px] text-foreground-muted">{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
