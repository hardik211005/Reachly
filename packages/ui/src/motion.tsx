"use client";

import * as React from "react";
import { MotionConfig, animate, motion, useInView, useReducedMotion, type HTMLMotionProps, type Variants } from "motion/react";
import { cn } from "./lib/utils";

/**
 * Motion primitives. One easing family and a few durations keep the product feeling like one
 * thing. Everything respects the OS "reduce motion" setting (MotionConfig reducedMotion="user"
 * plus explicit checks for effects that aren't transforms).
 */

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Fades and rises into place when scrolled into view (once). */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
  amount = 0.15,
  ...props
}: { children: React.ReactNode; className?: string; delay?: number; y?: number; amount?: number } & Omit<HTMLMotionProps<"div">, "children" | "initial" | "whileInView">) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount }} transition={{ duration: 0.55, ease: EASE_OUT, delay }} {...props}>
      {children}
    </motion.div>
  );
}

const staggerContainer = (step: number, delay: number): Variants => ({ hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } } });
const staggerChild: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

/** Children wrapped in <StaggerItem> enter one after another. */
export function Stagger({ children, className, step = 0.06, delay = 0, inView = false }: { children: React.ReactNode; className?: string; step?: number; delay?: number; inView?: boolean }) {
  return (
    <motion.div
      className={className}
      variants={staggerContainer(step, delay)}
      initial="hidden"
      {...(inView ? { whileInView: "show", viewport: { once: true, amount: 0.1 } } : { animate: "show" })}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, ...props }: { children: React.ReactNode; className?: string } & Omit<HTMLMotionProps<"div">, "children" | "variants">) {
  return (
    <motion.div className={className} variants={staggerChild} {...props}>
      {children}
    </motion.div>
  );
}

/**
 * Counts up to `value` when it comes into view (and tweens between later values). The server
 * renders the final number, so it's correct without JS; the animation only runs client-side.
 */
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)), duration = 1, className }: { value: number; format?: (value: number) => string; duration?: number; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotion();
  const shown = React.useRef<number | null>(null);
  const formatRef = React.useRef(format);
  React.useEffect(() => {
    formatRef.current = format;
  });
  React.useEffect(() => {
    const node = ref.current;
    if (!node || !inView) return;
    if (reduce || !Number.isFinite(value)) {
      node.textContent = formatRef.current(value);
      shown.current = value;
      return;
    }
    const from = shown.current ?? 0;
    const controls = animate(from, value, {
      duration: shown.current === null ? duration : Math.min(duration, 0.6),
      ease: EASE_OUT,
      onUpdate: (latest) => {
        node.textContent = formatRef.current(latest);
      },
    });
    shown.current = value;
    return () => controls.stop();
  }, [value, inView, reduce, duration]);
  return (
    <span ref={ref} className={cn("tabular", className)}>
      {format(value)}
    </span>
  );
}

/** A card with a soft light that follows the pointer. */
export function SpotlightCard({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("spotlight", className)}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--x", `${event.clientX - rect.left}px`);
        event.currentTarget.style.setProperty("--y", `${event.clientY - rect.top}px`);
      }}
      {...props}
    >
      {children}
    </div>
  );
}

/** Slowly drifting brand-coloured light, for heroes. Purely decorative. */
export function Aurora({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div
        className="absolute -top-1/3 -left-1/4 h-[70%] w-[60%] rounded-full blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--brand-1), transparent)", opacity: 0.28 * intensity, animation: "aurora-a 18s ease-in-out infinite" }}
      />
      <div
        className="absolute -top-1/4 right-[-15%] h-[65%] w-[55%] rounded-full blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--brand-2), transparent)", opacity: 0.22 * intensity, animation: "aurora-b 22s ease-in-out infinite" }}
      />
      <div
        className="absolute bottom-[-35%] left-[20%] h-[60%] w-[50%] rounded-full blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--brand-3), transparent)", opacity: 0.18 * intensity, animation: "aurora-a 26s ease-in-out infinite reverse" }}
      />
    </div>
  );
}

/** Entrance for route changes (used by app/app/template.tsx). */
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
      {children}
    </motion.div>
  );
}

/** A bar that grows to `value` (0–1) when it scrolls into view. */
export function GrowBar({ value, className, barClassName, style }: { value: number; className?: string; barClassName?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("overflow-hidden", className)}>
      <motion.div
        className={cn("h-full", barClassName)}
        style={style}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease: EASE_OUT }}
      />
    </div>
  );
}

export { motion, useReducedMotion };
