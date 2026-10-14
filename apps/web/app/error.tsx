"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Aurora, Button } from "@repo/ui";
import { Logo } from "@/components/brand/logo";

/** Fallback for unexpected errors on public pages (the app has its own inside the shell). */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center">
      <Aurora intensity={1} />
      <Link href="/" className="absolute top-6 left-6" aria-label="Home">
        <Logo />
      </Link>
      <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Something went wrong</h1>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-foreground-secondary">An unexpected error stopped this page from loading. Trying again usually fixes it.</p>
      {error.digest ? <p className="mt-3 font-mono text-[12px] text-foreground-subtle">Reference: {error.digest}</p> : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button variant="primary" size="lg" onClick={() => retry()}>
          <RotateCcw /> Try again
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href="/">
            <ArrowLeft /> Back to home
          </Link>
        </Button>
      </div>
    </main>
  );
}
