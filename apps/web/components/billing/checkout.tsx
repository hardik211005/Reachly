"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";

type CheckoutStart =
  | { kind: "redirect"; provider: "stripe"; url: string }
  | { kind: "updated"; provider: "stripe" }
  | {
      kind: "razorpay";
      provider: "razorpay";
      keyId: string;
      orderId: string;
      amount: number;
      currency: string;
      planName: string;
      workspace: string;
      prefill: { name: string; email: string | null };
    };

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(
    event: "payment.failed",
    handler: (response: { error: { description?: string } }) => void,
  ): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

/** Razorpay Checkout is a hosted script; load it only when someone actually pays. */
function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Razorpay. Check your connection and try again."));
    };
    document.body.appendChild(script);
  });
  return loading;
}

function accentColor(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#b4532a"
  );
}

/**
 * Starts a payment for a plan. Stripe sends the browser to Checkout (or switches an existing
 * card subscription in place); Razorpay opens its UPI sheet here and the result is verified
 * on the server before the plan changes.
 */
export function useCheckout(onDone: () => void) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = React.useState(false);

  const finish = React.useCallback(
    (message: string) => {
      void queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.success(message);
      router.refresh();
      onDone();
    },
    [queryClient, router, onDone],
  );

  const verifyUpi = useMutation({
    mutationFn: (response: RazorpayResponse) =>
      api<{ status: string }>("/api/v1/billing/upi/verify", {
        method: "POST",
        json: {
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        },
      }),
    onSuccess: () => finish("Payment received — your plan is active"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setWaiting(false),
  });

  const start = useMutation({
    mutationFn: (input: { plan: string; provider: "stripe" | "razorpay" }) =>
      api<CheckoutStart>("/api/v1/billing/checkout", { method: "POST", json: input }),
    onSuccess: async (result) => {
      if (result.kind === "redirect") {
        setWaiting(true);
        window.location.assign(result.url);
        return;
      }
      if (result.kind === "updated") {
        finish("Plan changed — the difference is prorated on your next invoice");
        return;
      }
      try {
        await loadRazorpay();
      } catch (error) {
        toast.error(errorMessage(error));
        return;
      }
      if (!window.Razorpay) return;
      setWaiting(true);
      const sheet = new window.Razorpay({
        key: result.keyId,
        order_id: result.orderId,
        amount: result.amount,
        currency: result.currency,
        name: "Reachly",
        description: `${result.planName} plan · 1 month for ${result.workspace}`,
        prefill: { name: result.prefill.name, email: result.prefill.email ?? undefined },
        theme: { color: accentColor() },
        // UPI first; cards and netbanking stay available below it.
        config: {
          display: {
            blocks: { upi: { name: "Pay with UPI", instruments: [{ method: "upi" }] } },
            sequence: ["block.upi"],
            preferences: { show_default_blocks: true },
          },
        },
        handler: (response: RazorpayResponse) => verifyUpi.mutate(response),
        modal: { ondismiss: () => setWaiting(false), confirm_close: true },
      });
      sheet.on("payment.failed", (response) =>
        toast.error(response.error.description || "The payment failed. No money was taken."),
      );
      sheet.open();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    start: start.mutate,
    pending: start.isPending || verifyUpi.isPending || waiting,
    pendingProvider: start.isPending || waiting ? start.variables?.provider : undefined,
  };
}

type CreditCheckout =
  CheckoutStart | { kind: "granted"; provider: "none"; added: number; metric: string };

/** Buying a credit pack: Razorpay (UPI first, cards too), verified on the server; instant in development without keys. */
export function useCreditCheckout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = React.useState(false);
  const finish = React.useCallback(
    (message: string) => {
      void queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.success(message);
      router.refresh();
    },
    [queryClient, router],
  );
  const verify = useMutation({
    mutationFn: (response: RazorpayResponse) =>
      api<{ status: string }>("/api/v1/billing/upi/verify", {
        method: "POST",
        json: {
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        },
      }),
    onSuccess: () => finish("Payment received — your credits are added"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setWaiting(false),
  });
  const start = useMutation({
    mutationFn: (pack: string) =>
      api<CreditCheckout>("/api/v1/billing/credits", { method: "POST", json: { pack } }),
    onSuccess: async (result) => {
      if (result.kind === "granted")
        return finish(
          `${result.added.toLocaleString("en-IN")} credits added (no payment collected — development only)`,
        );
      if (result.kind !== "razorpay") return;
      try {
        await loadRazorpay();
      } catch (error) {
        toast.error(errorMessage(error));
        return;
      }
      if (!window.Razorpay) return;
      setWaiting(true);
      const sheet = new window.Razorpay({
        key: result.keyId,
        order_id: result.orderId,
        amount: result.amount,
        currency: result.currency,
        name: "Reachly",
        description: `${result.planName} for ${result.workspace}`,
        prefill: { name: result.prefill.name, email: result.prefill.email ?? undefined },
        theme: { color: accentColor() },
        config: {
          display: {
            blocks: { upi: { name: "Pay with UPI", instruments: [{ method: "upi" }] } },
            sequence: ["block.upi"],
            preferences: { show_default_blocks: true },
          },
        },
        handler: (response: RazorpayResponse) => verify.mutate(response),
        modal: { ondismiss: () => setWaiting(false), confirm_close: true },
      });
      sheet.on("payment.failed", (response) =>
        toast.error(response.error.description || "The payment failed. No money was taken."),
      );
      sheet.open();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return {
    buy: start.mutate,
    pendingPack: start.isPending || verify.isPending || waiting ? start.variables : undefined,
  };
}
