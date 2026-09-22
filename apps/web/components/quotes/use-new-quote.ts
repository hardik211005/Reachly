"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";

export interface DraftHints {
  questions: string[];
  reasons: Array<{ offeringId: string; reason: string }>;
}

const hintKey = (quoteId: string) => `quote-draft-hints:${quoteId}`;

function readRaw(quoteId: string): string {
  try {
    return window.sessionStorage.getItem(hintKey(quoteId)) ?? "";
  } catch {
    return "";
  }
}

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** AI draft notes survive the navigation to the editor (per viewer, best effort; none during SSR). */
export function useDraftHints(quoteId: string): [DraftHints | null, () => void] {
  const raw = React.useSyncExternalStore(
    subscribe,
    () => readRaw(quoteId),
    () => "",
  );
  const hints = React.useMemo(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DraftHints;
    } catch {
      return null;
    }
  }, [raw]);
  const dismiss = React.useCallback(() => {
    try {
      window.sessionStorage.removeItem(hintKey(quoteId));
    } catch {
      // storage unavailable
    }
    for (const listener of listeners) listener();
  }, [quoteId]);
  return [hints, dismiss];
}

/** Starts a quote for a lead (blank, or drafted by AI from the conversation) and opens the editor. */
export function useNewQuote() {
  const router = useRouter();
  const blank = useMutation({
    mutationFn: (input: { leadId: string; dealId?: string | null }) => api<{ id: string }>("/api/v1/quotes", { method: "POST", json: { leadId: input.leadId, dealId: input.dealId ?? undefined, lines: [] } }),
    onSuccess: (quote) => router.push(`/app/crm/quotes/${quote.id}`),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const draft = useMutation({
    mutationFn: (input: { leadId: string; dealId?: string | null }) => api<{ quote: { id: string } } & DraftHints>("/api/v1/quotes/draft", { method: "POST", json: input }),
    onSuccess: (result) => {
      try {
        window.sessionStorage.setItem(hintKey(result.quote.id), JSON.stringify({ questions: result.questions, reasons: result.reasons }));
      } catch {
        // storage unavailable: the editor simply shows no hints
      }
      router.push(`/app/crm/quotes/${result.quote.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return { blank, draft, pending: blank.isPending || draft.isPending };
}
