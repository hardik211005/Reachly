"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LayoutDashboard, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@repo/ui";

/** Errors inside the product keep the sidebar and top bar, so people can navigate away. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger-text">
        <TriangleAlert className="size-5" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-[-0.02em]">This page couldn&apos;t load</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-foreground-secondary">Something unexpected went wrong. Your data is safe — try again, or head back to the overview.</p>
      {error.digest ? <p className="mt-3 font-mono text-[12px] text-foreground-subtle">Reference: {error.digest}</p> : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => retry()}>
          <RotateCcw /> Try again
        </Button>
        <Button asChild variant="secondary">
          <Link href="/app">
            <LayoutDashboard /> Overview
          </Link>
        </Button>
      </div>
    </div>
  );
}
