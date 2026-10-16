"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Inbox,
  MessageSquareQuote,
  Repeat,
  Star,
} from "lucide-react";
import {
  AnimatedNumber,
  Badge,
  Button,
  Callout,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Switch,
  Textarea,
  cn,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage } from "../shell/shell-context";
import { Row, SaveBar, Section } from "../settings/kit";

interface PageSettings {
  enabled: boolean;
  headline: string | null;
  about: string | null;
  showPrices: boolean;
  acceptEnquiries: boolean;
  afterWinFollowUps: boolean;
  url: string;
  stats: {
    enquiries30d: number;
    publishedReviews: number;
    pendingReviewRequests: number;
    averageRating: number | null;
  };
}

interface ReviewRow {
  id: string;
  status: "REQUESTED" | "PUBLISHED" | "HIDDEN";
  rating: number | null;
  comment: string | null;
  authorName: string | null;
  authorRole: string | null;
  requestedAt: string;
  submittedAt: string | null;
  lead: { id: string; name: string } | null;
  url: string | null;
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function copy(text: string, label = "Link copied") {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.error("Couldn't copy — select and copy it instead"),
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
      <p className="flex items-center gap-1.5 text-[12px] text-foreground-muted">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-1.5 font-heading text-[24px] leading-none font-semibold tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11.5px] text-foreground-subtle">{hint}</p> : null}
    </div>
  );
}

function PageSection({ settings }: { settings: PageSettings }) {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const initial = {
    enabled: settings.enabled,
    headline: settings.headline ?? "",
    about: settings.about ?? "",
    showPrices: settings.showPrices,
    acceptEnquiries: settings.acceptEnquiries,
    afterWinFollowUps: settings.afterWinFollowUps,
  };
  const [form, setForm] = React.useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: () => api<PageSettings>("/api/v1/grow/page", { method: "PUT", json: form }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["grow-page"], updated);
      toast.success(updated.enabled ? "Your page is live" : "Saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const disabled = !canManage;

  return (
    <Section
      title="Your public page"
      description="A page customers can find and share: what you offer, your prices, reviews from real customers and an enquiry form. Enquiries arrive as interested leads with a deal already open."
      icon={Globe}
      footer={
        canManage ? (
          <SaveBar
            dirty={dirty}
            pending={save.isPending}
            onSave={() => save.mutate()}
            onReset={() => setForm(initial)}
          />
        ) : null
      }
    >
      <Row
        label="Page is live"
        hint="Turn it on to make the link work. Your services and prices come from Settings → Business & services."
      >
        <div className="grid gap-2">
          <Switch
            checked={form.enabled}
            disabled={disabled}
            onCheckedChange={(checked) => set("enabled", checked)}
            aria-label="Page is live"
          />
          <div className="flex flex-wrap items-center gap-2">
            <code
              className={cn(
                "max-w-full truncate rounded-md bg-surface-muted px-2 py-1 text-[12px]",
                !settings.enabled && "text-foreground-muted",
              )}
            >
              {settings.url}
            </code>
            <Button variant="ghost" size="xs" onClick={() => copy(settings.url)}>
              <Copy /> Copy
            </Button>
            {settings.enabled ? (
              <Button asChild variant="ghost" size="xs">
                <a href={settings.url} target="_blank" rel="noopener">
                  <ExternalLink /> Open
                </a>
              </Button>
            ) : null}
          </div>
          <p className="text-[12px] text-foreground-muted">
            Share it on WhatsApp, Instagram, Google Maps and your visiting cards.
          </p>
        </div>
      </Row>
      <Row
        label="Headline"
        hint="One line under your name. Leave empty to use your value proposition."
        htmlFor="gp-headline"
      >
        <Input
          id="gp-headline"
          value={form.headline}
          maxLength={120}
          disabled={disabled}
          onChange={(event) => set("headline", event.target.value)}
          placeholder="e.g. Fresh custom cakes for cafés, offices and events"
        />
      </Row>
      <Row
        label="About"
        hint="A few lines about you. Leave empty to use your business description."
        htmlFor="gp-about"
      >
        <Textarea
          id="gp-about"
          rows={4}
          value={form.about}
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => set("about", event.target.value)}
        />
      </Row>
      <Row
        label="Show prices"
        hint="Off: visitors see your services and are asked to request a quote."
      >
        <Switch
          checked={form.showPrices}
          disabled={disabled}
          onCheckedChange={(checked) => set("showPrices", checked)}
          aria-label="Show prices"
        />
      </Row>
      <Row
        label="Enquiry form"
        hint="Spam-protected. Each enquiry creates an interested lead, opens a deal and notifies you."
      >
        <Switch
          checked={form.acceptEnquiries}
          disabled={disabled}
          onCheckedChange={(checked) => set("acceptEnquiries", checked)}
          aria-label="Enquiry form"
        />
      </Row>
      <Row
        label="After a win"
        hint="When a deal is won: a private review link is ready, with tasks to ask for the review in 3 days and check back for repeat business in 30."
      >
        <Switch
          checked={form.afterWinFollowUps}
          disabled={disabled}
          onCheckedChange={(checked) => set("afterWinFollowUps", checked)}
          aria-label="After-win follow-ups"
        />
      </Row>
    </Section>
  );
}

function ReviewsSection() {
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ["grow-reviews"],
    queryFn: () => api<ReviewRow[]>("/api/v1/grow/reviews"),
  });
  const visibility = useMutation({
    mutationFn: ({ id, visible }: { id: string; visible: boolean }) =>
      api(`/api/v1/grow/reviews/${id}`, { method: "PATCH", json: { visible } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["grow-reviews"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const rows = reviews.data ?? [];
  const answered = rows.filter((review) => review.status !== "REQUESTED");
  const pending = rows.filter((review) => review.status === "REQUESTED");

  return (
    <Section
      title="Reviews"
      description="Only customers you invite can review you — each gets a private link. Ask from any lead's menu, or automatically after a win."
      icon={MessageSquareQuote}
    >
      {reviews.isError ? (
        <ErrorState
          description={errorMessage(reviews.error)}
          onRetry={() => void reviews.refetch()}
        />
      ) : !reviews.data ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={Star}
          title="No reviews yet"
          description="Open a customer in Leads and choose “Ask for a review” from the ⋯ menu."
        />
      ) : (
        <div className="grid gap-5">
          {answered.length ? (
            <ul className="grid gap-3">
              {answered.map((review) => (
                <li
                  key={review.id}
                  className={cn(
                    "rounded-lg border border-border p-3",
                    review.status === "HIDDEN" && "opacity-60",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="inline-flex items-center gap-0.5"
                      aria-label={`${review.rating} out of 5`}
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={cn(
                            "size-3.5",
                            star <= (review.rating ?? 0)
                              ? "fill-warning text-warning"
                              : "text-border-strong",
                          )}
                        />
                      ))}
                    </span>
                    <div className="flex items-center gap-2">
                      {review.status === "HIDDEN" ? (
                        <Badge>Hidden</Badge>
                      ) : (
                        <Badge tone="success">On your page</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={visibility.isPending}
                        onClick={() =>
                          visibility.mutate({ id: review.id, visible: review.status === "HIDDEN" })
                        }
                      >
                        {review.status === "HIDDEN" ? <Eye /> : <EyeOff />}{" "}
                        {review.status === "HIDDEN" ? "Show" : "Hide"}
                      </Button>
                    </div>
                  </div>
                  {review.comment ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed">“{review.comment}”</p>
                  ) : null}
                  <p className="mt-1 text-[12px] text-foreground-muted">
                    {review.authorName}
                    {review.authorRole ? ` · ${review.authorRole}` : ""} ·{" "}
                    {review.submittedAt ? DATE.format(new Date(review.submittedAt)) : ""}
                    {review.lead ? (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          href={`/app/leads/${review.lead.id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {review.lead.name}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {pending.length ? (
            <div>
              <h3 className="mb-2 text-[12.5px] font-semibold text-foreground-secondary">
                Waiting for an answer ({pending.length})
              </h3>
              <ul className="grid gap-1.5">
                {pending.map((review) => (
                  <li
                    key={review.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted/50 px-3 py-2 text-[12.5px]"
                  >
                    <span className="min-w-0 truncate">
                      {review.lead ? (
                        <Link
                          href={`/app/leads/${review.lead.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {review.lead.name}
                        </Link>
                      ) : (
                        "Customer"
                      )}{" "}
                      <span className="text-foreground-muted">
                        · asked {DATE.format(new Date(review.requestedAt))}
                      </span>
                    </span>
                    {review.url ? (
                      <Button variant="ghost" size="xs" onClick={() => copy(review.url!)}>
                        <Copy /> Copy link
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

export function GrowView() {
  const settings = useQuery({
    queryKey: ["grow-page"],
    queryFn: () => api<PageSettings>("/api/v1/grow/page"),
  });
  if (settings.isError)
    return (
      <ErrorState
        description={errorMessage(settings.error)}
        onRetry={() => void settings.refetch()}
      />
    );
  if (!settings.data) return <Skeleton className="h-96 rounded-xl" />;
  const { stats } = settings.data;
  return (
    <div className="grid gap-5">
      {!settings.data.enabled ? (
        <Callout
          tone="accent"
          icon={Globe}
          title="Let customers find you, not just the other way round"
        >
          Turn on your public page below, then share the link. Enquiries become leads automatically.
        </Callout>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Inbox}
          label="Enquiries (30 days)"
          value={<AnimatedNumber value={stats.enquiries30d} />}
          hint="From your public page"
        />
        <Stat
          icon={Star}
          label="Average rating"
          value={stats.averageRating ? `${stats.averageRating}★` : "—"}
          hint={`${stats.publishedReviews} review${stats.publishedReviews === 1 ? "" : "s"} shown`}
        />
        <Stat
          icon={MessageSquareQuote}
          label="Review requests"
          value={<AnimatedNumber value={stats.pendingReviewRequests} />}
          hint="Waiting for an answer"
        />
        <Stat
          icon={Repeat}
          label="After-win follow-ups"
          value={settings.data.afterWinFollowUps ? "On" : "Off"}
          hint="Review + repeat-business tasks"
        />
      </div>
      <PageSection key={JSON.stringify(settings.data)} settings={settings.data} />
      <ReviewsSection />
    </div>
  );
}
