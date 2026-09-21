import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

export const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-[11px] font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-muted text-foreground-secondary",
        accent: "border-transparent bg-accent-soft text-accent-soft-foreground",
        success: "border-transparent bg-success-soft text-success-text",
        warning: "border-transparent bg-warning-soft text-warning-text",
        danger: "border-transparent bg-danger-soft text-danger-text",
        outline: "border-border-strong bg-transparent text-foreground-secondary",
        solid: "border-transparent bg-primary text-primary-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
