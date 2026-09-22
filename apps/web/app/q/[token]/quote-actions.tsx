"use client";

import * as React from "react";
import { CheckCircle2, Clock, Download, XCircle } from "lucide-react";
import { formatMoney } from "@repo/core/quotes/pricing";
import { Button, Field, Input, Label, Textarea } from "@repo/ui";

interface Props {
  token: string;
  quote: {
    number: string;
    status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
    expired: boolean;
    total: number;
    currency: string;
    validUntil: string | null;
    respondedByName: string | null;
    respondedAt: string | null;
    sellerName: string;
    leadName: string;
    contactName: string | null;
    pdfUrl: string;
  };
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)) : "";
}

export function PublicQuoteActions({ token, quote }: Props) {
  const [mode, setMode] = React.useState<"idle" | "accept" | "decline">("idle");
  const [name, setName] = React.useState(quote.contactName ?? "");
  const [note, setNote] = React.useState("");
  const [state, setState] = React.useState<{ status: "idle" | "pending" | "error"; message?: string }>({ status: "idle" });
  const [answered, setAnswered] = React.useState<{ status: "ACCEPTED" | "REJECTED"; name: string } | null>(null);

  // Count the view from the browser, not from link scanners.
  React.useEffect(() => {
    if (quote.status === "SENT") void fetch(`/api/public/quotes/${token}/view`, { method: "POST" }).catch(() => undefined);
  }, [token, quote.status]);

  async function respond(decision: "accept" | "decline") {
    setState({ status: "pending" });
    const response = await fetch(`/api/public/quotes/${token}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, name: name.trim(), note: note.trim() || undefined }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { data?: { status: "ACCEPTED" | "REJECTED" }; error?: { message: string } } | null;
    if (!response?.ok || !body?.data) {
      setState({ status: "error", message: body?.error?.message ?? "That didn’t go through. Please try again." });
      return;
    }
    setAnswered({ status: body.data.status, name: name.trim() });
    setState({ status: "idle" });
  }

  const total = formatMoney(quote.total, quote.currency);
  const status = answered?.status ?? quote.status;
  const who = answered?.name ?? quote.respondedByName;

  let banner: React.ReactNode;
  if (status === "ACCEPTED") {
    banner = (
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-text" />
        <div>
          <p className="text-sm font-semibold">Quote accepted{who ? ` by ${who}` : ""}{!answered && quote.respondedAt ? ` on ${date(quote.respondedAt)}` : ""}</p>
          <p className="mt-0.5 text-[13px] text-foreground-muted">Thank you! {quote.sellerName} has been notified and will be in touch about next steps.</p>
        </div>
      </div>
    );
  } else if (status === "REJECTED") {
    banner = (
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 size-5 shrink-0 text-foreground-muted" />
        <div>
          <p className="text-sm font-semibold">Quote declined{who ? ` by ${who}` : ""}</p>
          <p className="mt-0.5 text-[13px] text-foreground-muted">Thanks for letting {quote.sellerName} know. Reply to their email if you’d like a revised quote.</p>
        </div>
      </div>
    );
  } else if (status === "EXPIRED" || quote.expired) {
    banner = (
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-5 shrink-0 text-warning-text" />
        <div>
          <p className="text-sm font-semibold">This quote expired{quote.validUntil ? ` on ${date(quote.validUntil)}` : ""}</p>
          <p className="mt-0.5 text-[13px] text-foreground-muted">Prices may have changed. Ask {quote.sellerName} for an updated quote.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5" aria-label="Respond to this quote">
      {banner ?? (
        <div className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">
                {quote.sellerName} sent you quote {quote.number}
              </p>
              <p className="mt-0.5 text-[13px] text-foreground-muted">
                Total <span className="font-semibold text-foreground tabular">{total}</span>
                {quote.validUntil ? ` · valid until ${date(quote.validUntil)}` : ""}
              </p>
            </div>
            {mode === "idle" ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setMode("decline")}>
                  Decline
                </Button>
                <Button variant="primary" onClick={() => setMode("accept")}>
                  <CheckCircle2 /> Accept quote
                </Button>
              </div>
            ) : null}
          </div>
          {mode !== "idle" ? (
            <form
              className="grid gap-3 border-t border-border pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim().length >= 2) void respond(mode);
              }}
            >
              <p className="text-[13px] font-medium">{mode === "accept" ? `Accept ${quote.number} for ${total} on behalf of ${quote.leadName}` : `Decline ${quote.number}`}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="respond-name">Your name</Label>
                  <Input id="respond-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" autoFocus required minLength={2} />
                </Field>
                <Field>
                  <Label htmlFor="respond-note">{mode === "accept" ? "Message (optional)" : "Reason (optional)"}</Label>
                  <Textarea id="respond-note" rows={1} value={note} onChange={(event) => setNote(event.target.value)} placeholder={mode === "accept" ? "When would you like to start?" : "What would make it work?"} />
                </Field>
              </div>
              {state.status === "error" ? <p className="text-[13px] text-danger-text">{state.message}</p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
                  Back
                </Button>
                <Button type="submit" variant={mode === "accept" ? "primary" : "danger"} loading={state.status === "pending"} disabled={name.trim().length < 2}>
                  {mode === "accept" ? "Confirm acceptance" : "Decline quote"}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      )}
      <div className="mt-4 flex justify-end border-t border-border pt-3">
        <a href={quote.pdfUrl} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground-secondary hover:text-foreground">
          <Download className="size-4" /> Download PDF
        </a>
      </div>
    </section>
  );
}
