"use client";

import * as React from "react";
import Link from "next/link";
import { BadgeCheck, CheckCircle2, ExternalLink, MapPin, Send, Star } from "lucide-react";
import { brand } from "@repo/config/brand";
import {
  Aurora,
  Button,
  Callout,
  Field,
  FieldError,
  Input,
  Label,
  Spinner,
  Textarea,
  formatCurrency,
} from "@repo/ui";

interface PageData {
  name: string;
  logoUrl: string | null;
  headline: string | null;
  about: string | null;
  industry: string | null;
  city: string | null;
  website: string | null;
  acceptEnquiries: boolean;
  offerings: Array<{
    id: string;
    type: string;
    name: string;
    description: string | null;
    unit: string;
    unitPrice: number | null;
    currency: string;
  }>;
  reviews: Array<{
    id: string;
    rating: number | null;
    comment: string | null;
    authorName: string | null;
    authorRole: string | null;
    submittedAt: string | null;
  }>;
  rating: { average: number | null; count: number };
}

// Fixed locale + UTC so the server and browser render the same text.
const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function Stars({ value, size = "size-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${size} ${star <= Math.round(value) ? "fill-warning text-warning" : "text-border-strong"}`}
        />
      ))}
    </span>
  );
}

function EnquiryForm({ slug, business }: { slug: string; business: string }) {
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle");
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("sending");
    setErrors({});
    setMessage(null);
    const response = await fetch(`/api/public/pages/${slug}/enquiry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    }).catch(() => null);
    if (response?.ok) return setState("sent");
    const body = (await response?.json().catch(() => null)) as {
      error?: { message?: string; fields?: Record<string, string[]> };
    } | null;
    setErrors(body?.error?.fields ?? {});
    setMessage(
      body?.error?.fields ? null : (body?.error?.message ?? "Couldn't send — please try again."),
    );
    setState("idle");
  }

  if (state === "sent") {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-9 text-success-text" />
        <p className="text-[16px] font-semibold">Thanks — your enquiry is with {business}</p>
        <p className="text-[13px] text-foreground-muted">They&apos;ll get back to you soon.</p>
      </div>
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor="enq-name">Your name</Label>
          <Input id="enq-name" name="name" autoComplete="name" required />
          <FieldError>{errors.name?.[0]}</FieldError>
        </Field>
        <Field>
          <Label htmlFor="enq-company">Business (optional)</Label>
          <Input id="enq-company" name="company" autoComplete="organization" />
        </Field>
        <Field>
          <Label htmlFor="enq-email">Email</Label>
          <Input id="enq-email" name="email" type="email" autoComplete="email" />
          <FieldError>{errors.email?.[0]}</FieldError>
        </Field>
        <Field>
          <Label htmlFor="enq-phone">Phone / WhatsApp</Label>
          <Input id="enq-phone" name="phone" type="tel" autoComplete="tel" />
        </Field>
      </div>
      <Field>
        <Label htmlFor="enq-message">What do you need?</Label>
        <Textarea
          id="enq-message"
          name="message"
          rows={4}
          placeholder="Tell them what you're looking for, quantities, dates…"
          required
        />
        <FieldError>{errors.message?.[0]}</FieldError>
      </Field>
      {/* Honeypot: hidden from people, filled in by bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden
      />
      {message ? <Callout tone="danger">{message}</Callout> : null}
      <Button type="submit" variant="primary" size="lg" disabled={state === "sending"}>
        {state === "sending" ? <Spinner className="size-4" /> : <Send />} Send enquiry
      </Button>
      <p className="text-center text-[11.5px] text-foreground-subtle">
        Your details go only to {business}.
      </p>
    </form>
  );
}

export function PublicBusinessPage({ slug, page }: { slug: string; page: PageData }) {
  const priced = page.offerings.some((offering) => offering.unitPrice !== null);
  return (
    <main className="relative isolate min-h-dvh">
      <Aurora intensity={0.8} />
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 sm:py-14">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {page.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- workspace logos are served by our own API route
            <img
              src={page.logoUrl}
              alt=""
              className="size-16 shrink-0 rounded-2xl border border-border bg-surface object-contain p-1.5 shadow-xs"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-accent-soft font-heading text-2xl font-semibold text-accent-soft-foreground">
              {page.name.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="font-heading text-[30px] leading-tight font-semibold tracking-[-0.03em] sm:text-[38px]">
              {page.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-foreground-secondary">
              {page.industry ? <span>{page.industry}</span> : null}
              {page.city ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" /> {page.city}
                </span>
              ) : null}
              {page.rating.count ? (
                <span className="inline-flex items-center gap-1.5">
                  <Stars value={page.rating.average ?? 0} size="size-3.5" /> {page.rating.average} ·{" "}
                  {page.rating.count} review{page.rating.count === 1 ? "" : "s"}
                </span>
              ) : null}
              {page.website ? (
                <a
                  href={page.website}
                  target="_blank"
                  rel="noopener nofollow"
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                >
                  Website <ExternalLink className="size-3" />
                </a>
              ) : null}
            </p>
          </div>
        </header>

        {page.headline || page.about ? (
          <div className="max-w-3xl">
            {page.headline ? (
              <p className="text-[19px] leading-snug font-medium text-balance">{page.headline}</p>
            ) : null}
            {page.about ? (
              <p className="mt-3 text-[14.5px] leading-relaxed whitespace-pre-line text-foreground-secondary">
                {page.about}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-8">
            {page.offerings.length ? (
              <section>
                <h2 className="mb-3 text-[17px] font-semibold">What we offer</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {page.offerings.map((offering) => (
                    <li
                      key={offering.id}
                      className="rounded-xl border border-border bg-surface p-4 shadow-xs"
                    >
                      <p className="font-medium">{offering.name}</p>
                      {offering.description ? (
                        <p className="mt-1 text-[13px] leading-relaxed text-foreground-muted">
                          {offering.description}
                        </p>
                      ) : null}
                      {offering.unitPrice !== null ? (
                        <p className="mt-2 text-[14px] font-semibold">
                          {formatCurrency(offering.unitPrice, offering.currency)}{" "}
                          <span className="text-[12px] font-normal text-foreground-muted">
                            / {offering.unit}
                          </span>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {!priced ? (
                  <p className="mt-2 text-[12.5px] text-foreground-muted">
                    Ask for a quote — prices depend on what you need.
                  </p>
                ) : null}
              </section>
            ) : null}

            <section>
              <h2 className="mb-3 text-[17px] font-semibold">What customers say</h2>
              {page.reviews.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-foreground-muted">
                  No reviews yet.
                </p>
              ) : (
                <ul className="grid gap-3">
                  {page.reviews.map((review) => (
                    <li
                      key={review.id}
                      className="rounded-xl border border-border bg-surface p-4 shadow-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Stars value={review.rating ?? 0} />
                        {review.submittedAt ? (
                          <span className="text-[11.5px] text-foreground-subtle">
                            {MONTH.format(new Date(review.submittedAt))}
                          </span>
                        ) : null}
                      </div>
                      {review.comment ? (
                        <p className="mt-2 text-[14px] leading-relaxed">“{review.comment}”</p>
                      ) : null}
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-foreground-secondary">
                        <span className="font-medium text-foreground">{review.authorName}</span>
                        {review.authorRole ? <span>· {review.authorRole}</span> : null}
                        <span className="inline-flex items-center gap-1 text-success-text">
                          <BadgeCheck className="size-3.5" /> Verified customer
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11.5px] text-foreground-subtle">
                Reviews can only be left by customers {page.name} has worked with, through a private
                link.
              </p>
            </section>
          </div>

          {page.acceptEnquiries ? (
            <aside className="h-fit rounded-2xl border border-border bg-surface p-5 shadow-sm lg:sticky lg:top-6">
              <h2 className="text-[17px] font-semibold">Send an enquiry</h2>
              <p className="mt-1 mb-4 text-[13px] text-foreground-muted">
                Ask a question or request a quote.
              </p>
              <EnquiryForm slug={slug} business={page.name} />
            </aside>
          ) : null}
        </div>

        <p className="text-center text-[11.5px] text-foreground-subtle">
          Powered by{" "}
          <Link href="/" className="underline-offset-2 hover:underline">
            {brand.name}
          </Link>
        </p>
      </div>
    </main>
  );
}
