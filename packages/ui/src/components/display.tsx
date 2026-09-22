import * as React from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, RefreshCw, Sparkles } from "lucide-react";
import { cn, formatNumber } from "../lib/utils";
import { AnimatedNumber } from "../motion";
import { Button } from "./button";

// ----------------------------------------------------------------------------- PageHeader

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs text-foreground-muted">{eyebrow}</div> : null}
        <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] text-foreground-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- EmptyState

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-16", className)}>
      {Icon ? (
        <div className="mb-3 flex size-10 animate-float items-center justify-center rounded-lg border border-border bg-surface-muted shadow-xs">
          <Icon className="size-5 text-foreground-muted" />
        </div>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-foreground-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- ErrorState

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-danger-soft">
        <AlertTriangle className="size-5 text-danger-text" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-foreground-muted">{description}</p> : null}
      {onRetry ? (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- MetricCard (stat tile)

export interface MetricDelta {
  /** Fractional change vs comparison period, e.g. 0.12 = +12%. null when not computable. */
  value: number | null;
  /** Whether an increase is good for this metric (costs: false). */
  upIsGood?: boolean;
  label?: string;
}

export function MetricCard({
  label,
  value,
  delta,
  hint,
  sparkline,
  className,
  href,
  numeric,
}: {
  label: string;
  value: React.ReactNode;
  /** Counts up to this number (formatted) instead of showing `value` statically. */
  numeric?: { value: number; format?: (value: number) => string };
  delta?: MetricDelta;
  hint?: React.ReactNode;
  sparkline?: React.ReactNode;
  className?: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground-muted">{label}</span>
        {delta ? <DeltaBadge delta={delta} /> : null}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <span className="text-[22px] leading-none font-semibold tracking-[-0.02em] text-foreground">{numeric ? <AnimatedNumber value={numeric.value} format={numeric.format} /> : value}</span>
        {sparkline ? <div className="h-7 w-20 shrink-0">{sparkline}</div> : null}
      </div>
      {hint ? <div className="mt-1.5 truncate text-[11px] text-foreground-muted">{hint}</div> : null}
    </>
  );
  const classes = cn(
    "block rounded-lg border border-border bg-surface px-4 py-3.5 shadow-xs transition-[border-color,box-shadow,transform] duration-200",
    href && "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md",
    className,
  );
  return href ? (
    <a href={href} className={classes}>
      {content}
    </a>
  ) : (
    <div className={classes}>{content}</div>
  );
}

export function DeltaBadge({ delta }: { delta: MetricDelta }) {
  if (delta.value === null || !Number.isFinite(delta.value)) {
    // Nothing to compare against (previous period was empty): keep the header compact.
    return (
      <span title={delta.label ?? "No data in the previous period"} className="shrink-0 text-[11px] text-foreground-subtle">
        new
      </span>
    );
  }
  const up = delta.value > 0.0005;
  const down = delta.value < -0.0005;
  const good = up ? (delta.upIsGood ?? true) : down ? !(delta.upIsGood ?? true) : null;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span
      title={delta.label}
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium tabular",
        good === true && "text-success-text",
        good === false && "text-danger-text",
        good === null && "text-foreground-muted",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {Math.abs(delta.value * 100) >= 100 ? formatNumber(Math.round(delta.value * 100)) : (delta.value * 100).toFixed(1).replace(/\.0$/, "")}%
      <span className="sr-only">{up ? "increase" : down ? "decrease" : "no change"}</span>
    </span>
  );
}

// ----------------------------------------------------------------------------- ScoreIndicator

export function scoreTone(score: number | null | undefined): "high" | "medium" | "low" | "none" {
  if (score === null || score === undefined) return "none";
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

export function ScoreIndicator({ score, size = "md", className }: { score: number | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  const tone = scoreTone(score);
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const dims = { sm: 22, md: 28, lg: 44 }[size];
  const stroke = size === "lg" ? 4 : 3;
  const r = (dims - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const color = { high: "var(--status-good)", medium: "var(--accent)", low: "var(--foreground-subtle)", none: "var(--border-strong)" }[tone];
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: dims, height: dims }}
      title={score === null || score === undefined ? "Not scored yet" : `Lead score ${score}/100`}
    >
      <svg width={dims} height={dims} className="-rotate-90" aria-hidden>
        <circle cx={dims / 2} cy={dims / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        {score !== null && score !== undefined ? (
          <circle
            cx={dims / 2}
            cy={dims / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          />
        ) : null}
      </svg>
      <span className={cn("absolute font-semibold tabular text-foreground", size === "lg" ? "text-sm" : "text-[10px]")}>
        {score ?? "–"}
      </span>
    </span>
  );
}

/** Horizontal factor bar used in score breakdowns. */
export function ScoreBar({ label, score, weight, className }: { label: string; score: number; weight?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1", className)}>
      <span className="truncate text-[13px] text-foreground-secondary">
        {label}
        {weight !== undefined ? <span className="ml-1.5 text-[11px] text-foreground-subtle">×{weight}</span> : null}
      </span>
      <span className="text-[13px] font-medium tabular">{Math.round(score)}</span>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- StatusBadge (dot + label)

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted";

export function StatusDot({ tone = "neutral", className }: { tone?: StatusTone; className?: string }) {
  const colors: Record<StatusTone, string> = {
    neutral: "bg-foreground-muted",
    accent: "bg-accent",
    success: "bg-good",
    warning: "bg-warning",
    danger: "bg-critical",
    muted: "bg-foreground-subtle",
  };
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", colors[tone], className)} />;
}

export function StatusBadge({ tone = "neutral", children, className }: { tone?: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-sm border border-border bg-surface px-1.5 text-[11px] font-medium whitespace-nowrap text-foreground-secondary",
        className,
      )}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

// ----------------------------------------------------------------------------- AIInsightCard

export function AIInsightCard({
  title,
  body,
  metric,
  comparison,
  confidence,
  sentiment = "neutral",
  footer,
  className,
}: {
  title: string;
  body: React.ReactNode;
  metric?: React.ReactNode;
  comparison?: React.ReactNode;
  confidence?: number;
  sentiment?: "positive" | "negative" | "neutral";
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4 shadow-xs", className)}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
            sentiment === "positive" && "bg-success-soft text-success-text",
            sentiment === "negative" && "bg-danger-soft text-danger-text",
            sentiment === "neutral" && "bg-accent-soft text-accent-soft-foreground",
          )}
        >
          <Sparkles className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <div className="mt-1 text-[13px] leading-relaxed text-foreground-secondary">{body}</div>
          {metric || comparison || confidence !== undefined ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-muted">
              {metric ? <span>{metric}</span> : null}
              {comparison ? <span>{comparison}</span> : null}
              {confidence !== undefined ? <span>Confidence {Math.round(confidence * 100)}%</span> : null}
            </div>
          ) : null}
          {footer ? <div className="mt-3">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Timeline

export interface TimelineItem {
  id: string;
  time: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: StatusTone;
  meta?: React.ReactNode;
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            {index < items.length - 1 ? <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-border" /> : null}
            <span
              className={cn(
                "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface",
                item.tone === "success" && "border-transparent bg-success-soft text-success-text",
                item.tone === "danger" && "border-transparent bg-danger-soft text-danger-text",
                item.tone === "accent" && "border-transparent bg-accent-soft text-accent-soft-foreground",
                item.tone === "warning" && "border-transparent bg-warning-soft text-warning-text",
              )}
            >
              {Icon ? <Icon className="size-3.5" /> : <span className="size-1.5 rounded-full bg-foreground-muted" />}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] font-medium text-foreground">{item.title}</p>
                <span className="shrink-0 text-[11px] text-foreground-muted tabular">{item.time}</span>
              </div>
              {item.description ? <div className="mt-0.5 text-[13px] text-foreground-secondary">{item.description}</div> : null}
              {item.meta ? <div className="mt-1 text-[11px] text-foreground-muted">{item.meta}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ----------------------------------------------------------------------------- DescriptionList

export function DescriptionList({ items, className }: { items: Array<{ label: string; value: React.ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(100px,auto)_1fr] gap-x-4 gap-y-2.5 text-[13px]", className)}>
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <dt className="text-foreground-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-foreground">{item.value ?? <span className="text-foreground-subtle">—</span>}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// ----------------------------------------------------------------------------- Banner / Callout

export function Callout({
  tone = "neutral",
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  tone?: "neutral" | "accent" | "warning" | "danger" | "success";
  icon?: React.ComponentType<{ className?: string }>;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3.5 py-3 text-[13px]",
        tone === "neutral" && "border-border bg-surface-muted text-foreground-secondary",
        tone === "accent" && "border-transparent bg-accent-soft text-accent-soft-foreground",
        tone === "warning" && "border-transparent bg-warning-soft text-warning-text",
        tone === "danger" && "border-transparent bg-danger-soft text-danger-text",
        tone === "success" && "border-transparent bg-success-soft text-success-text",
        className,
      )}
    >
      {Icon ? <Icon className="mt-0.5 size-4 shrink-0" /> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
