"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CheckSquare, Inbox, Megaphone, PhoneCall, Telescope } from "lucide-react";
import { AnimatedNumber, Aurora, Button, Stagger, StaggerItem, cn, formatCurrency } from "@repo/ui";
import { api } from "@/lib/api-client";
import { RangePicker } from "./range-picker";

interface Summary {
  needsResponse: number;
  pendingApproval: number;
  callsWaiting: number;
  tasksDue: number;
}

/** One tile of the Today bento. Span classes come from the caller; the page owns the grid. */
export function BentoTile({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "relative isolate min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-xs",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

/** A counter tile that links to where the work is. */
function CounterTile({
  href,
  icon: Icon,
  count,
  label,
  tone,
  className,
}: {
  href: string;
  icon: typeof Inbox;
  count: number;
  label: string;
  tone: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-xs transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md sm:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cn("flex size-9 items-center justify-center rounded-lg", tone)}>
          <Icon className="size-4" />
        </span>
        <ArrowUpRight className="size-4 text-foreground-subtle transition-colors group-hover:text-foreground" />
      </div>
      <div>
        <span className="block text-[30px] leading-none font-semibold tracking-[-0.03em] tabular">
          <AnimatedNumber value={count} />
        </span>
        <span className="mt-1 block text-[13px] text-foreground-muted">{label}</span>
      </div>
    </Link>
  );
}

/**
 * The top of the Today bento: a greeting tile and three counters. Returns tiles only; the page
 * owns the grid.
 */
export function OverviewHero({
  greeting,
  workspace,
  days,
  revenue,
  meetings,
  currency,
}: {
  greeting: string;
  workspace: string;
  days: number;
  revenue: number;
  meetings: number;
  currency: string;
}) {
  const summary = useQuery({
    queryKey: ["inbox-summary"],
    queryFn: () => api<Summary>("/api/v1/conversations/summary"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return (
    <>
      <BentoTile className="col-span-2 px-5 py-5 sm:px-6 md:col-span-6 xl:col-span-6">
        <Aurora intensity={0.9} />
        <div
          aria-hidden
          className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]"
        />
        <Stagger step={0.08} className="flex h-full flex-col justify-between gap-4">
          <div>
            <StaggerItem>
              <p className="text-xs font-medium tracking-wide text-foreground-muted uppercase">
                {workspace}
              </p>
            </StaggerItem>
            <StaggerItem>
              <h1 className="mt-1 text-[28px] leading-tight font-extrabold tracking-[-0.04em] text-balance sm:text-[30px]">
                {greeting}
              </h1>
            </StaggerItem>
            <StaggerItem>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-foreground-secondary">
                In the last {days} days you won{" "}
                <span className="text-gradient font-semibold">
                  <AnimatedNumber
                    value={revenue}
                    format={(value) =>
                      formatCurrency(value, currency, { compact: value >= 100_000 })
                    }
                  />
                </span>{" "}
                and booked{" "}
                <span className="font-semibold text-foreground">
                  <AnimatedNumber value={meetings} /> meeting{meetings === 1 ? "" : "s"}
                </span>
                . Here’s everything that moved.
              </p>
            </StaggerItem>
          </div>
          <StaggerItem className="flex flex-wrap items-center gap-2">
            <Button asChild variant="primary" size="sm">
              <Link href="/app/discover">
                <Telescope /> Find customers
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/campaigns/new">
                <Megaphone /> Send an offer
              </Link>
            </Button>
            <div className="ml-0 sm:ml-auto">
              <RangePicker />
            </div>
          </StaggerItem>
        </Stagger>
      </BentoTile>
      <CounterTile
        href="/app/conversations"
        icon={Inbox}
        count={summary.data?.needsResponse ?? 0}
        label="replies need you"
        tone="bg-accent-soft text-accent-soft-foreground"
        className="col-span-2 md:col-span-2 xl:col-span-2"
      />
      <CounterTile
        href="/app/calls"
        icon={PhoneCall}
        count={summary.data?.callsWaiting ?? 0}
        label="calls waiting"
        tone="bg-success-soft text-success-text"
        className="md:col-span-2 xl:col-span-2"
      />
      <CounterTile
        href="/app/crm?tab=tasks"
        icon={CheckSquare}
        count={summary.data?.tasksDue ?? 0}
        label="tasks due"
        tone="bg-warning-soft text-warning-text"
        className="md:col-span-2 xl:col-span-2"
      />
    </>
  );
}
