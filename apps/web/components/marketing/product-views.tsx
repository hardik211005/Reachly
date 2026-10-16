"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { motion, useScroll, useSpring } from "motion/react";
import { EASE_OUT, Reveal, SpotlightCard, Stagger, StaggerItem, cn } from "@repo/ui";
import { ProductDemo } from "./demos";
import { IntegrationsMarquee, Trust } from "./sections";
import { PRODUCTS, productBySlug, type Product } from "./site";
import { CtaBand, FaqSection, PageIntro, PrimaryActions, SectionHeading } from "./ui";

/** A product name mid-sentence: "Lead discovery" → "lead discovery", but "AI calling" stays. */
const inline = (name: string) => name.replace(/^([A-Z])(?=[a-z])/, (letter) => letter.toLowerCase());

/** The loop the products form, left to right; workflows run alongside all of them. */
const LOOP = ["lead-discovery", "ai-outreach", "ai-calling", "crm-quotes", "analytics"];

function LoopStrip({ current }: { current?: string }) {
  return (
    <div className="overflow-x-auto pb-2 [scrollbar-width:none]">
      <ol className="mx-auto flex w-max items-center gap-2 px-1">
        {LOOP.map((slug, index) => {
          const product = productBySlug(slug)!;
          const active = slug === current;
          return (
            <li key={slug} className="flex items-center gap-2">
              <Link href={`/product/${slug}`} aria-current={active ? "page" : undefined} className={cn("group inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-all", active ? "border-transparent bg-foreground text-background shadow-[var(--brand-glow)]" : "border-border bg-surface text-foreground-secondary hover:-translate-y-0.5 hover:text-foreground hover:shadow-md")}>
                <product.icon className={cn("size-4", active ? "" : "text-brand-1")} /> {product.name}
              </Link>
              {index < LOOP.length - 1 ? (
                <motion.span aria-hidden initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ delay: 0.2 + index * 0.15, duration: 0.4 }} className="bg-brand-gradient h-px w-6 origin-left" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Capabilities({ product }: { product: Product }) {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="What you get" title={`Everything in ${inline(product.name)}`} description={product.summary} />
        <Stagger inView step={0.06} className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {product.capabilities.map((capability, index) => (
            <StaggerItem key={capability.id}>
              <SpotlightCard id={capability.id} className="lift group h-full scroll-mt-28 rounded-2xl border border-border bg-surface p-5 shadow-xs target:border-transparent target:shadow-[var(--brand-glow)]">
                <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-[13px] font-semibold text-accent-soft-foreground tabular">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="mt-4 text-[15px] font-semibold">{capability.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-foreground-secondary">{capability.body}</p>
              </SpotlightCard>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function DetailRows({ product }: { product: Product }) {
  return (
    <section className="relative isolate border-y border-border bg-surface py-20 sm:py-24">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-25 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="mx-auto grid max-w-6xl gap-20 px-4 sm:px-6">
        {product.details.map((detail, index) => (
          <div key={detail.title} className={cn("grid items-center gap-10 lg:grid-cols-2", index % 2 === 1 && "lg:[&>*:first-child]:order-2")}>
            <Reveal x={index % 2 ? 30 : -30} y={0}>
              <p className="text-xs font-semibold tracking-[0.14em] text-brand-1 uppercase">{product.eyebrow}</p>
              <h3 className="mt-3 text-[28px] leading-tight font-semibold tracking-[-0.03em] text-balance">{detail.title}</h3>
              <p className="mt-4 text-[15px] leading-relaxed text-foreground-secondary">{detail.body}</p>
            </Reveal>
            <Reveal x={index % 2 ? -30 : 30} y={0}>
              <div className="relative overflow-hidden rounded-2xl border border-border bg-background p-6 shadow-md">
                <div aria-hidden className="bg-brand-gradient absolute -top-16 -right-16 size-40 rounded-full opacity-15 blur-3xl" />
                <ul className="relative grid gap-3">
                  {detail.points.map((point, pointIndex) => (
                    <motion.li key={point} initial={{ opacity: 0, x: 16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.6 }} transition={{ delay: 0.15 + pointIndex * 0.12, duration: 0.45, ease: EASE_OUT }} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 shadow-xs">
                      <motion.span initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.35 + pointIndex * 0.12, type: "spring", stiffness: 400, damping: 18 }} className="bg-brand-gradient flex size-6 shrink-0 items-center justify-center rounded-full text-white">
                        <Check className="size-3.5" />
                      </motion.span>
                      <span className="text-[14px] font-medium">{point}</span>
                    </motion.li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        ))}
      </div>
    </section>
  );
}

function Related({ current }: { current: string }) {
  const others = PRODUCTS.filter((product) => product.slug !== current);
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Better together" title="Part of one connected loop" highlight="one connected loop" description="Every part shares the same leads, events and history — no syncing between tools." />
        <Reveal className="mt-10">
          <LoopStrip current={current} />
        </Reveal>
        <Stagger inView step={0.06} className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {others.map((product) => (
            <StaggerItem key={product.slug}>
              <Link href={`/product/${product.slug}`} className="group flex h-full flex-col rounded-xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md">
                <product.icon className="size-5 text-brand-1" />
                <span className="mt-3 text-[14px] font-semibold">{product.name}</span>
                <span className="mt-1 text-[12.5px] leading-snug text-foreground-muted">{product.summary}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[12px] font-medium text-foreground-secondary group-hover:text-foreground">
                  Explore <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

export function ProductPageView({ slug }: { slug: string }) {
  const product = productBySlug(slug)!;
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { href: "/product", label: "Product" }, { label: product.name }]}
        eyebrow={product.eyebrow}
        icon={product.icon}
        title={product.headline}
        highlight={product.highlight}
        description={product.intro}
        actions={<PrimaryActions />}
        aside={<ProductDemo demo={product.demo} />}
      />
      <Capabilities product={product} />
      <DetailRows product={product} />
      <Related current={product.slug} />
      <FaqSection items={product.faqs} title={`${product.name}, answered`} description={<>More questions? <Link href="/contact" className="font-medium text-foreground underline underline-offset-2">Ask us</Link>.</>} />
      <CtaBand />
    </>
  );
}

// ----------------------------------------------------------------------------- Platform overview

function ProductChapter({ product, index }: { product: Product; index: number }) {
  return (
    <div className={cn("grid items-center gap-10 lg:grid-cols-2", index % 2 === 1 && "lg:[&>*:first-child]:order-2")}>
      <Reveal x={index % 2 ? 30 : -30} y={0}>
        <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-brand-1 uppercase">
          <span className="border-gradient flex size-7 items-center justify-center rounded-lg bg-surface">
            <product.icon className="size-3.5" />
          </span>
          {String(index + 1).padStart(2, "0")} · {product.eyebrow}
        </p>
        <h3 className="mt-4 text-[28px] leading-tight font-semibold tracking-[-0.03em] text-balance">{product.headline}</h3>
        <p className="mt-4 text-[15px] leading-relaxed text-foreground-secondary">{product.intro}</p>
        <ul className="mt-5 grid gap-2">
          {product.capabilities.slice(0, 3).map((capability) => (
            <li key={capability.id} className="flex items-start gap-2 text-[14px] text-foreground-secondary">
              <Check className="mt-0.5 size-4 shrink-0 text-good" /> {capability.title}
            </li>
          ))}
        </ul>
        <Link href={`/product/${product.slug}`} className="group mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
          Explore {inline(product.name)} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </Reveal>
      <Reveal x={index % 2 ? -30 : 30} y={0}>
        <ProductDemo demo={product.demo} />
      </Reveal>
    </div>
  );
}

export function ProductOverviewView() {
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 60%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 26 });
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { label: "Product" }]}
        eyebrow="The platform"
        icon={Sparkles}
        title="One workspace for the whole B2B sales loop"
        highlight="whole B2B sales loop"
        description="Find the right businesses, reach them on the channels they answer, and turn replies into meetings, quotes and won deals — with the numbers to show what worked."
        actions={<PrimaryActions />}
        center
      />
      <Reveal className="mx-auto -mt-6 max-w-6xl px-4 sm:px-6">
        <LoopStrip />
      </Reveal>
      <section className="relative py-20 sm:py-28">
        <div ref={ref} className="relative mx-auto grid max-w-6xl gap-24 px-4 sm:px-6">
          <div aria-hidden className="absolute top-0 bottom-0 left-1/2 hidden w-px -translate-x-1/2 bg-border lg:block" />
          <motion.div aria-hidden className="bg-brand-gradient absolute top-0 left-1/2 hidden w-px origin-top -translate-x-1/2 lg:block" style={{ height: "100%", scaleY: progress }} />
          {PRODUCTS.map((product, index) => (
            <ProductChapter key={product.slug} product={product} index={index} />
          ))}
        </div>
      </section>
      <IntegrationsMarquee />
      <Trust />
      <CtaBand />
    </>
  );
}
