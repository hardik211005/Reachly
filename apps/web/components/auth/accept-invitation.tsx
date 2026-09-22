"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button, Spinner } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";

export function AcceptInvitation({ token, signedInAs, invitedEmail }: { token: string; signedInAs: string; invitedEmail: string }) {
  const router = useRouter();
  const matches = signedInAs.toLowerCase() === invitedEmail.toLowerCase();
  const accept = useMutation({
    mutationFn: () => api<{ organizationId: string; workspace: string }>("/api/v1/invitations/accept", { method: "POST", json: { token } }),
    onSuccess: () => {
      router.push("/app");
      router.refresh();
    },
  });
  if (!matches) {
    return (
      <div className="grid gap-3">
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
          You&apos;re signed in as {signedInAs}. This invitation is for {invitedEmail}.
        </p>
        <Button asChild variant="secondary">
          <Link href="/app">Back to my workspace</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <Button variant="primary" size="lg" disabled={accept.isPending} onClick={() => accept.mutate()}>
        {accept.isPending ? <Spinner className="size-4" /> : null} Accept and join
      </Button>
      {accept.isError ? <p className="text-[13px] text-danger-text">{errorMessage(accept.error)}</p> : null}
      <p className="text-[12px] text-foreground-muted">Signed in as {signedInAs}</p>
    </div>
  );
}
