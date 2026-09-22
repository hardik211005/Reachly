"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Search, Sparkles, Users } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { EASE_OUT, Reveal, SpotlightCard, Stagger, StaggerItem } from "@repo/ui";
import { UseCasesStrip } from "./sections";
import { productBySlug, USE_CASES, findUseCase, type UseCase } from "./site";
import { CtaBand, DemoFrame, PageIntro, PrimaryActions, SectionHeading } from "./ui";

function ExamplePanel({ useCase }: { useCase: UseCase }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotion();
  const show = inView || reduce;
  return (
    <div ref={ref}>
      <DemoFrame title={`Example · ${useCase.name}`}>
        <div className="grid gap-4 p-5">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-foreground-muted uppercase">1 · Describe who you want</p>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 shadow-xs">
              <Search className="size-4 shrink-0 text-foreground-muted" />
              {show ? (
                <motion.span initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={{ duration: reduce ? 0 : 1.6, ease: "linear" }} className="text-[13px]">
                  {useCase.exampleSearch}
                </motion.span>
              ) : null}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-foreground-muted uppercase">2 · Reach out with specifics</p>
            <motion.div initial={{ opacity: 0, y: 14 }} animate={show ? { opacity: 1, y: 0 } : {}} transition={{ delay: reduce ? 0 : 1.8, duration: 0.5, ease: EASE_OUT }} className="mt-2 rounded-xl border border-border bg-background p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground-muted">
                <Sparkles className="size-3 text-brand-2" /> AI draft · waiting for your approval
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed">{useCase.exampleMessage}</p>
            </motion.div>
          </div>
        </div>
      </DemoFrame>
    </div>
  );
}

function Playbook({ useCase }: { useCase: UseCase }) {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="The playbook" title="Three moves that do the work" highlight="do the work" />
        <ol className="relative mt-14 grid gap-6 md:grid-cols-3">
          <motion.span aria-hidden initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 1.2, ease: EASE_OUT }} className="bg-brand-gradient absolute top-6 right-[16%] left-[16%] hidden h-px origin-left md:block" />
          {useCase.playbook.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.15} className="relative text-center">
              <span className="relative mx-auto flex size-12 items-center justify-center rounded-2xl border border-border bg-surface text-[15px] font-semibold shadow-md tabular">
                <span className="text-gradient">{index + 1}</span>
              </span>
              <h3 className="mt-5 text-[17px] font-semibold">{step.title}</h3>
              <p className="mx-auto mt-2 max-w-xs text-[14px] leading-relaxed text-foreground-secondary">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ProductsUsed({ useCase }: { useCase: UseCase }) {
  return (
    <section className="border-y border-border bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="What you'll use" title="The parts that matter most here" />
        <Stagger inView step={0.08} className="mt-12 grid gap-4 md:grid-cols-3">
          {useCase.products.map((slug) => {
            const product = productBySlug(slug)!;
            return (
              <StaggerItem key={slug}>
                <SpotlightCard className="lift group relative flex h-full flex-col rounded-2xl border border-border bg-background p-6">
                  <span className="border-gradient flex size-10 items-center justify-center rounded-xl bg-surface">
                    <product.icon className="size-5 text-brand-1" />
                  </span>
                  <h3 className="mt-4 text-[16px] font-semibold">
                    <Link href={`/product/${slug}`} className="after:absolute after:inset-0 after:rounded-2xl after:content-['']">
                      {product.name}
                    </Link>
                  </h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-foreground-secondary">{product.summary}</p>
                  <span className="mt-auto inline-flex items-center gap-1 pt-5 text-[12.5px] font-medium text-brand-1">
                    Learn more <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </SpotlightCard>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>
    </section>
  );
}

function OtherUseCases({ current }: { current: string }) {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <p className="text-center text-[13px] font-medium text-foreground-muted">Other teams</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {USE_CASES.filter((item) => item.slug !== current).map((item) => (
              <Link key={item.slug} href={`/use-cases/${item.slug}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-medium text-foreground-secondary transition-all hover:-translate-y-0.5 hover:text-foreground hover:shadow-md">
                <item.icon className="size-4 text-brand-1" /> {item.name}
              </Link>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function UseCasePageView({ slug }: { slug: string }) {
  const useCase = findUseCase(slug)!;
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { href: "/use-cases", label: "Use cases" }, { label: useCase.name }]}
        eyebrow={useCase.name}
        icon={useCase.icon}
        title={useCase.headline}
        highlight={useCase.highlight}
        description={useCase.intro}
        actions={<PrimaryActions />}
        aside={<ExamplePanel useCase={useCase} />}
      />
      <Playbook useCase={useCase} />
      <ProductsUsed useCase={useCase} />
      <OtherUseCases current={slug} />
      <CtaBand />
    </>
  );
}

export function UseCasesIndexView() {
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { label: "Use cases" }]}
        eyebrow="Use cases"
        icon={Users}
        title="One engine, pointed at your buyers"
        highlight="your buyers"
        description="Whoever you sell to, the loop is the same: describe them, find them, reach them, close them. Here's how it looks for different teams."
        actions={<PrimaryActions secondary={{ href: "/contact", label: "Talk to us" }} />}
        center
      />
      <UseCasesStrip heading={false} />
      <CtaBand />
    </>
  );
}
