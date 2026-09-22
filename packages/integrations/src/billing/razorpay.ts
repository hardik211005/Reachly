import { IntegrationError, providerFetch } from "../lib/errors";
import { hmac, safeEqual } from "../lib/signatures";

/**
 * Razorpay adapter for UPI payments: create an order on the server, let Razorpay Checkout
 * collect the payment in the browser, then verify the signature and re-read the payment
 * from Razorpay before trusting it.
 */
const BASE_URL = "https://api.razorpay.com/v1";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: "created" | "attempted" | "paid";
  notes: Record<string, string> | unknown[];
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method: string;
  email: string | null;
  vpa?: string | null;
  error_description?: string | null;
  notes: Record<string, string> | unknown[];
  created_at: number;
}

export class RazorpayClient {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  private async request<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
    const response = await providerFetch("razorpay", `${BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      timeoutMs: 20_000,
    });
    return (await response.json()) as T;
  }

  createOrder(input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<RazorpayOrder> {
    if (input.receipt.length > 40) throw new IntegrationError("razorpay", "Receipt ids are limited to 40 characters", null, false);
    return this.request<RazorpayOrder>("/orders", { method: "POST", body: input });
  }

  fetchOrder(orderId: string): Promise<RazorpayOrder> {
    return this.request<RazorpayOrder>(`/orders/${encodeURIComponent(orderId)}`);
  }

  fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
  }

  /** Accounts set to manual capture leave payments "authorized"; capture them so the money settles. */
  capturePayment(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}/capture`, { method: "POST", body: { amount, currency } });
  }
}

/** Razorpay sends `notes` as an object, or as an empty array when there are none. */
export function razorpayNote(entity: { notes: Record<string, string> | unknown[] }, key: string): string | null {
  const notes = entity.notes;
  if (!notes || Array.isArray(notes)) return null;
  const value = notes[key];
  return typeof value === "string" && value ? value : null;
}

/** Checkout's handler signature: HMAC-SHA256 of `order_id|payment_id` with the key secret. */
export function verifyRazorpayPaymentSignature(input: { orderId: string; paymentId: string; signature: string; keySecret: string }): boolean {
  const expected = hmac("sha256", input.keySecret, `${input.orderId}|${input.paymentId}`).toString("hex");
  return safeEqual(input.signature, expected);
}

/** Webhook `X-Razorpay-Signature`: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyRazorpayWebhookSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  return safeEqual(signature, hmac("sha256", secret, body).toString("hex"));
}
