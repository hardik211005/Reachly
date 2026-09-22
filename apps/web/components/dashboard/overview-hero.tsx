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

function Chip({ href, icon: Icon, count, label, tone }: { href: string; icon: typeof Inbox; count: number; label: string; tone: string }) {
  return (
    <Link
      href={href}
      className="group relative flex h-full items-center gap-2.5 rounded-lg border border-border bg-surface/70 px-3 py-2.5 backdrop-blur-sm transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", tone)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg leading-tight font-semibold tabular">
          <AnimatedNumber value={count} />
        </span>
        <span className="block text-xs leading-tight text-foreground-muted">{label}</span>
      </span>
      <ArrowUpRight className="absolute top-2 right-2 size-3.5 text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

export function OverviewHero({ greeting, workspace, days, revenue, meetings, currency }: { greeting: string; workspace: string; days: number; revenue: number; meetings: number; currency: string }) {
  const summary = useQuery({ queryKey: ["inbox-summary"], queryFn: () => api<Summary>("/api/v1/conversations/summary"), refetchInterval: 30_000, staleTime: 15_000 });
  return (
    <section className="relative isolate mb-6 overflow-hidden rounded-xl border border-border bg-surface px-5 py-6 shadow-xs sm:px-7 sm:py-7">
      <Aurora intensity={0.9} />
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end">
        <Stagger step={0.08}>
          <StaggerItem>
            <p className="text-xs font-medium tracking-wide text-foreground-muted uppercase">{workspace}</p>
          </StaggerItem>
          <StaggerItem>
            <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-[32px]">{greeting}</h1>
          </StaggerItem>
          <StaggerItem>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-foreground-secondary">
              In the last {days} days you won{" "}
              <span className="text-gradient font-semibold">
                <AnimatedNumber value={revenue} format={(value) => formatCurrency(value, currency, { compact: value >= 100_000 })} />
              </span>{" "}
              and booked{" "}
              <span className="font-semibold text-foreground">
                <AnimatedNumber value={meetings} /> meeting{meetings === 1 ? "" : "s"}
              </span>
              . Here’s everything that moved.
            </p>
          </StaggerItem>
          <StaggerItem className="mt-5 flex flex-wrap items-center gap-2">
            <Button asChild variant="primary" size="sm">
              <Link href="/app/discover">
                <Telescope /> Find leads
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/campaigns/new">
                <Megaphone /> New campaign
              </Link>
            </Button>
            <div className="ml-0 sm:ml-2">
              <RangePicker />
            </div>
          </StaggerItem>
        </Stagger>
        <Stagger step={0.07} delay={0.15} className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <StaggerItem>
            <Chip href="/app/conversations" icon={Inbox} count={summary.data?.needsResponse ?? 0} label="replies need you" tone="bg-accent-soft text-accent-soft-foreground" />
          </StaggerItem>
          <StaggerItem>
            <Chip href="/app/calls" icon={PhoneCall} count={summary.data?.callsWaiting ?? 0} label="calls waiting" tone="bg-success-soft text-success-text" />
          </StaggerItem>
          <StaggerItem>
            <Chip href="/app/crm?tab=tasks" icon={CheckSquare} count={summary.data?.tasksDue ?? 0} label="tasks due" tone="bg-warning-soft text-warning-text" />
          </StaggerItem>
        </Stagger>
      </div>
    </section>
  );
}
