/**
 * Per-unit channel cost *estimates* (USD) used for pre-launch campaign estimates and
 * cost-per-lead analytics. Real costs come from provider invoices; these are defaults
 * operators can tune per deployment.
 */
export const CHANNEL_UNIT_COST_USD = {
  EMAIL: 0.0009,
  /** Marketing template conversation, typical APAC rate. */
  WHATSAPP: 0.011,
  /** Per minute, AI voice agent including telephony. */
  VOICE_PER_MINUTE: 0.09,
  MANUAL_CALL: 0,
} as const;

/** Typical AI credits consumed per generated outreach message (for estimates). */
export const AI_CREDITS_PER_MESSAGE_ESTIMATE = 2;
/** Assumed average AI call length in minutes (for estimates). */
export const AVERAGE_CALL_MINUTES_ESTIMATE = 2.5;

/**
 * Approximate USD → currency rates for showing USD-priced costs (AI, channel estimates) in a
 * workspace's currency. Estimates for analytics only — operators can tune them.
 */
export const USD_EXCHANGE_RATE: Record<string, number> = {
  USD: 1,
  INR: 83,
  EUR: 0.92,
  GBP: 0.79,
  AED: 3.67,
  SGD: 1.35,
  AUD: 1.52,
};

export function usdTo(currency: string, amountUsd: number): number {
  return amountUsd * (USD_EXCHANGE_RATE[currency] ?? 1);
}
