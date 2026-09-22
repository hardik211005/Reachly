# Billing & payments

Plans, limits and usage live in `packages/config/src/plans.ts` and `packages/core/src/billing/*`. Payments are optional and switched on by environment keys:

| Provider | Methods | Model | Keys |
|---|---|---|---|
| Stripe | Cards (international) | Monthly subscription that renews automatically | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Razorpay | UPI (plus Indian cards and netbanking in the same sheet) | One prepaid month per payment, in INR, no auto-debit | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |

With neither configured, owners can switch plans directly in development (clearly labelled "no payment collected"). In production that path is refused.

Prices: `priceMonthly` + `currency` (USD) for Stripe and `priceMonthlyInr` (paise) for UPI, per plan in `plans.ts`. Change them there. The public pricing page adds the rupee price when Razorpay keys are present when the site is built.

## Stripe (cards)

1. **Checkout** — `POST /api/v1/billing/checkout {plan, provider: "stripe"}`.
   - Creates a Stripe customer for the workspace the first time (stored as `Subscription.providerCustomerId`).
   - Finds the monthly price: `STRIPE_PRICE_*` if set, else a price Reachly created earlier (lookup key `reachly_<plan>_monthly_<currency>_<amount>`), else creates one.
   - Returns the Checkout URL. Metadata carries `organizationId` and `planKey`.
2. **Return** — Stripe redirects to `/app/billing?checkout=success&session_id=…`.
   - The page calls `POST /api/v1/billing/checkout/confirm`.
   - The server re-reads the session from Stripe, checks it belongs to the workspace, and applies the subscription and first invoice.
   - This works without webhooks, which helps local development.
3. **Switching plans while subscribed** — the existing subscription moves to the new price with proration. There is no second checkout.
4. **Portal** — `POST /api/v1/billing/portal` opens Stripe's customer portal (card, invoices, cancellation).
   - In test mode, save the portal settings once in the Stripe dashboard.
5. **Cancel / resume**
   - `POST /api/v1/billing/cancel` sets `cancel_at_period_end`.
   - `DELETE` on the same route undoes it.
6. **Webhooks** — `POST /api/webhooks/stripe`, verified with `STRIPE_WEBHOOK_SECRET`.
   - Subscription events: `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`.
     - Always re-read from Stripe, so out-of-order events are harmless.
     - A cancelled subscription moves the workspace to Free.
     - Events for a subscription the workspace has since replaced are ignored.
   - Invoice events: `invoice.finalized|paid|payment_failed|voided|marked_uncollectible`.
     - These upsert `Invoice` rows and record `Payment` successes and failures.
   - Locally: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

Plan resolution prefers the price being paid over metadata. Portal plan switches only change the price, so metadata can be stale.

## Razorpay (UPI)

1. **Order** — `POST /api/v1/billing/checkout {plan, provider: "razorpay"}`.
   - Creates a Razorpay order for the plan's INR price, with `notes {organizationId, planKey}`.
   - Returns what Razorpay Checkout needs.
2. **Pay** — the Billing page loads `checkout.razorpay.com/v1/checkout.js` only when needed.
   - It opens the sheet with UPI first.
   - Test mode: use the UPI id `success@razorpay`.
3. **Verify** — Checkout's handler posts `{orderId, paymentId, signature}` to `POST /api/v1/billing/upi/verify`. The server:
   - checks the HMAC (`order_id|payment_id` with the key secret);
   - re-reads the order and payment from Razorpay;
   - checks the workspace, order and amount;
   - captures the payment if it is only authorized;
   - then, in one transaction: marks the invoice paid, records the payment, and sets the plan with `billingProvider = "razorpay"`.
4. **Idempotency** — the unique payment id is the guard. The browser call and the webhook can both arrive; only one applies.
5. **Renewal** — paying again for the same plan before the month ends adds a month. A different plan starts a fresh month.
6. **Lapse** — nothing auto-debits. Three days after the paid month ends, `resolvePlan` moves the workspace back to Free (`hasLapsed` in `plans.ts`). The same fallback covers a cancelled card subscription whose final webhook never arrived.
7. **Webhooks** — `POST /api/webhooks/razorpay`, verified with `RAZORPAY_WEBHOOK_SECRET` (HMAC of the raw body).
   - Subscribe to `payment.captured` and `payment.failed`.
   - Events are recorded once per `x-razorpay-event-id`.

## Security notes

- Nothing from the browser is trusted. Sessions, orders and payments are re-read from the provider before the plan changes.
- Only workspace owners (`billing:manage`) can pay, cancel or open the portal.
- Webhooks are signature-checked. Each event is stored once in `webhook_events` (provider + event id) with a minimal payload: type and object id, no card or UPI details.
- Card and UPI details never touch Reachly. Stripe Checkout is a redirect; Razorpay Checkout runs in Razorpay's iframe. The `Permissions-Policy` allows the Payment Request API only for Razorpay's origins, and COOP is `same-origin-allow-popups` so bank popups work.

## Tests

- `packages/integrations/src/billing/billing.test.ts` covers the status mapping, periods, lookup keys and Razorpay signatures.
- `packages/core/test/integration/payments.test.ts` covers:
  - verified UPI payments applied once;
  - bad signatures, other workspaces' orders and short payments rejected;
  - capture of authorized payments;
  - month extension;
  - signed Razorpay and Stripe webhooks with replay protection;
  - lapse to Free;
  - the production guard on direct plan changes.
- Tests never call Stripe or Razorpay. Keys are blanked in the test setup and Razorpay's HTTP API is stubbed.
