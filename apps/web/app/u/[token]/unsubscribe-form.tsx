"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@repo/ui";

export function UnsubscribeForm({ token, email, sender }: { token: string; email: string; sender: string }) {
  const [state, setState] = React.useState<"idle" | "pending" | "done" | "error">("idle");

  async function unsubscribe() {
    setState("pending");
    const response = await fetch(`/api/unsubscribe/${token}`, { method: "POST" }).catch(() => null);
    setState(response?.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-8 text-success-text" />
        <h1 className="mt-3 text-base font-semibold">You’re unsubscribed</h1>
        <p className="mt-2 text-[13px] text-foreground-muted">
          {email} won’t receive further outreach emails from {sender}. It can take a moment for messages already in transit to stop.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-base font-semibold">Unsubscribe from {sender}</h1>
      <p className="mt-2 text-[13px] text-foreground-muted">
        Stop all outreach emails from {sender} to <span className="font-medium text-foreground-secondary">{email}</span>.
      </p>
      {state === "error" ? <p className="mt-3 text-[13px] text-danger-text">That didn’t work. Please try again, or reply “unsubscribe” to the email.</p> : null}
      <Button className="mt-5 w-full" onClick={unsubscribe} disabled={state === "pending"}>
        {state === "pending" ? "Unsubscribing…" : "Unsubscribe"}
      </Button>
    </div>
  );
}
