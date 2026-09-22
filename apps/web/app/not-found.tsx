import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { Aurora, Button } from "@repo/ui";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center">
      <Aurora intensity={1.2} />
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <Link href="/" className="absolute top-6 left-6" aria-label="Home">
        <Logo />
      </Link>
      <p className="text-gradient animate-gradient-pan text-[120px] leading-none font-semibold tracking-[-0.06em] sm:text-[168px]">404</p>
      <h1 className="mt-4 text-[26px] font-semibold tracking-[-0.03em]">This page wandered off</h1>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-foreground-secondary">The link may be old or mistyped. Here are a few places to pick things up again.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild variant="primary" size="lg">
          <Link href="/">
            <ArrowLeft /> Back to home
          </Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href="/product">
            <Compass /> Explore the product
          </Link>
        </Button>
      </div>
      <nav aria-label="Popular pages" className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13.5px] text-foreground-muted">
        {[
          ["/pricing", "Pricing"],
          ["/use-cases", "Use cases"],
          ["/contact", "Contact"],
          ["/login", "Sign in"],
        ].map(([href, label]) => (
          <Link key={href} href={href!} className="transition-colors hover:text-foreground">
            {label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
