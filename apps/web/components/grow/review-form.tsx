"use client";

import * as React from "react";
import { CheckCircle2, Star } from "lucide-react";
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
  cn,
} from "@repo/ui";

interface Invite {
  business: string;
  logoUrl: string | null;
  done: boolean;
  suggestedName: string | null;
  suggestedRole: string | null;
}

const LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

export function ReviewForm({ token, invite }: { token: string; invite: Invite }) {
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [state, setState] = React.useState<"idle" | "sending" | "sent">(
    invite.done ? "sent" : "idle",
  );
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    setState("sending");
    setErrors({});
    setMessage(null);
    const response = await fetch(`/api/public/reviews/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, rating }),
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

  const shown = hover || rating;
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center px-4 py-10">
      <Aurora intensity={0.8} />
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          {invite.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- workspace logos are served by our own API route
            <img
              src={invite.logoUrl}
              alt=""
              className="size-11 rounded-xl border border-border object-contain p-1"
            />
          ) : (
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft font-heading text-lg font-semibold text-accent-soft-foreground">
              {invite.business.slice(0, 1)}
            </span>
          )}
          <div>
            <p className="text-[12px] text-foreground-muted">Review</p>
            <h1 className="text-[18px] leading-tight font-semibold">{invite.business}</h1>
          </div>
        </div>

        {state === "sent" ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-success-text" />
            <p className="text-[16px] font-semibold">Thank you for your review!</p>
            <p className="text-[13px] text-foreground-muted">
              It helps {invite.business} — and others choosing them.
            </p>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
            <div>
              <p className="mb-2 text-[14px] font-medium">How was your experience?</p>
              <div
                className="flex items-center gap-1"
                role="radiogroup"
                aria-label="Rating"
                onMouseLeave={() => setHover(0)}
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    role="radio"
                    aria-checked={rating === star}
                    aria-label={`${star} star${star === 1 ? "" : "s"}`}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHover(star)}
                    className="rounded-md p-1 transition-transform hover:scale-110"
                  >
                    <Star
                      className={cn(
                        "size-8",
                        star <= shown ? "fill-warning text-warning" : "text-border-strong",
                      )}
                    />
                  </button>
                ))}
                <span className="ml-2 text-[13px] text-foreground-muted">{LABELS[shown]}</span>
              </div>
              <FieldError>{errors.rating?.[0]}</FieldError>
            </div>
            <Field>
              <Label htmlFor="rv-comment">Your review</Label>
              <Textarea
                id="rv-comment"
                name="comment"
                rows={4}
                placeholder="What did they do well? Would you recommend them?"
              />
              <FieldError>{errors.comment?.[0]}</FieldError>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <Label htmlFor="rv-name">Your name</Label>
                <Input
                  id="rv-name"
                  name="authorName"
                  defaultValue={invite.suggestedName ?? ""}
                  autoComplete="name"
                />
                <FieldError>{errors.authorName?.[0]}</FieldError>
              </Field>
              <Field>
                <Label htmlFor="rv-role">Business (optional)</Label>
                <Input
                  id="rv-role"
                  name="authorRole"
                  defaultValue={invite.suggestedRole ?? ""}
                  placeholder="e.g. Owner, Café Aroma"
                />
              </Field>
            </div>
            {message ? <Callout tone="danger">{message}</Callout> : null}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={state === "sending" || rating === 0}
            >
              {state === "sending" ? <Spinner className="size-4" /> : null} Submit review
            </Button>
            <p className="text-center text-[11.5px] text-foreground-subtle">
              Your name and review will be shown on {invite.business}&apos;s page.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
