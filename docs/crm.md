# CRM & quotes

A focused CRM for what outreach produces: deals, next steps, meetings and quotes. It is not a general-purpose CRM.

- **Code**:
  - `packages/core/src/crm` (deals, tasks, meetings, contacts)
  - `packages/core/src/quotes` (pricing, catalog, quotes, PDF)
  - the `quote_draft` agent in `packages/core/src/ai/agents/quote.ts`
- **UI**:
  - `/app/crm` (tabs: Pipeline, Tasks, Meetings, Quotes, Contacts, Products & pricing)
  - `/app/crm/quotes/:id` (quote editor)
  - the lead's **Deals & quotes** tab
  - the public quote page `/q/:token`

## Model

| Entity | What it is |
|---|---|
| Company | A lead (`Lead`). Discovery, enrichment, scoring and outreach all work on it. |
| Contact | People at the company (`Contact`), found by enrichment or added by hand. |
| Deal | An opportunity with one company. It has a stage, a value before tax, a probability, an expected close date, an owner and a contact. |
| Task / Note / Meeting | Belong to a company and, optionally, a deal. |
| Quote | A priced proposal for a company (usually on its deal), made of line items from the catalog. |

## Pipeline

Stages: **New → Qualified → Contacted → Interested → Meeting → Proposal → Negotiation → Won / Lost**. Each stage has a default win probability (5% … 75%). A deal can override it, and the override is cleared when the stage changes. The weighted forecast is the sum of value × probability.

- **Drag and drop** (dnd-kit, keyboard accessible: Space picks up and drops, Enter opens):
  - Order within a column uses fractional positions.
  - Dropping between two cards sends their ids, and the server computes the position. Columns are re-spaced when precision runs out.
- **Won** asks for the closed value. **Lost** requires a reason (Price, Timing, Chose a competitor, No response, Not a fit or free text). The reason feeds win/loss insights.
- **Closed columns** show the last 30 days.
- **Summary strip**: open pipeline, weighted forecast, won this month, win rate and average won deal (both over 90 days).

### Deals and lead statuses stay in step

Changes only ever move **forward** automatically. A late reply never drags a deal in negotiation back to "Interested".

| Lead status → | Deal | Deal stage → | Lead status |
|---|---|---|---|
| Interested | opened at Interested (or moved forward) | Qualified / Contacted / Interested / Meeting | same status (forward only) |
| Meeting | Meeting | Proposal / Negotiation | Quote sent |
| Quote sent | Proposal | Won | Won |
| Won / Lost | the open deal is closed | Lost | Lost |

- **Lead → deal**: the `crm` event subscriber listens for `lead_status_changed`. It opens a deal when a lead becomes Interested, books a meeting or gets a quote, crediting the channel of the latest reply or call.
- **Deal → lead**: moving a deal updates the lead through `changeLeadStatus`, which records the usual event.
- **Reopening**: moving a won or lost deal back to an open stage reopens the lead.
- **Do-not-contact** leads are never changed.

## Tasks, meetings, notes

- **Tasks**:
  - The Tasks tab groups open tasks as overdue, today, next 7 days, later, or no date. It shows *My tasks* or *Everyone*.
  - Tasks come from people, workflows, call outcomes and declined quotes.
  - The CRM item in the sidebar shows how many of your tasks are due today or overdue.
- **Meetings**:
  - Meetings are booked from calls, replies or by hand. Booking one moves the lead (and its deal) to Meeting.
  - Each has an `.ics` download for any calendar, and can be marked completed, no-show or canceled.
- **Notes**: notes on a deal also appear on the company's activity timeline.

## Quotes

### The catalog is the only source of prices

*Products & pricing* holds:
- **Offerings**: product, service or package, with unit, unit price (or "price on request"), setup fee, tax rate and minimum order.
- **Pricing rules.**

| Rule | Effect |
|---|---|
| Volume discount | % off from a quantity. Only the **best** matching tier applies. |
| Percentage discount | % off (e.g. a launch offer). Stacks with a volume tier; the total is capped at 100%. |
| Fixed discount | Fixed amount off each matching line. |
| Minimum order | Blocks sending below the quantity. |
| Setup fee waiver | Waives the setup fee within the quantity range. It shows as a discount, so the prospect sees the saving. |

**Pricing** (`quotes/pricing.ts`) is a pure function shared by the server and the editor, so the editor prices live and the server re-prices on every save.
- Amounts are computed in paise and rounded per line.
- Each line records which rules changed it (`appliedRules`), and the quote and PDF show them.

**Where prices come from:**
- A **typed price** (on a "price on request" item, or an override of the list price) is marked *manual* and skips the pricing rules. It is the only other source of prices.
- Tax is per line: from the offering, or typed.
- Lines without a price, below a minimum order, from removed or inactive offerings, or in another currency are **issues**. A quote with issues can't be sent.

### AI drafts

The `quote_draft` agent reads the recent conversation: messages, call summaries and key points, and notes. It returns only:
- which **catalog offerings** to include and in what **quantity**, from what the prospect said (e.g. "10,000 cups", "6 months");
- a short cover note;
- questions to confirm.

It never sees or produces prices, and every price comes from the pricing engine.
- Unknown offering ids are dropped, and quantities are raised to minimum orders (with a note).
- The deterministic fallback (demo mode, or when AI is unavailable) matches what the prospect asked for first. Otherwise it uses the one service our outreach pitched.
- Drafts are never sent automatically. The editor shows the agent's questions and a reason on each line.

### Lifecycle

```
DRAFT ──send (email / WhatsApp / share link)──▶ SENT ──prospect accepts──▶ ACCEPTED ──▶ deal Won at the quote's value (before tax)
  │                                               ├──prospect declines──▶ REJECTED ──▶ follow-up task for the lead owner
  └─ edit freely                                  └──validity passes───▶ EXPIRED   (hourly job quotes.expire)
```

- **Numbering**: `Q-2026-0001`, allocated atomically from the workspace counter. The prefix and validity are set in quote settings, with a retry if a hand-edited counter collides.
- **Editing**: sent quotes are read-only. *Duplicate* makes a revision.
- **Sending**:
  - Moves the deal to **Proposal**, and sets its value to the quote's total before tax.
  - Moves the lead to **Quote sent**.
  - Email and WhatsApp use the normal direct-message path, so suppression, do-not-contact and the WhatsApp 24-hour window all apply.
  - *Share link* marks the quote sent and gives you the link and a WhatsApp-ready message to paste.
- **Recording answers yourself**: a team member can mark a sent quote accepted or declined, e.g. after a call.

### The prospect's side

`/q/<signed token>`: the token is the credential and no account is needed. The prospect can:
- read the quote (same layout as the PDF);
- download the PDF;
- accept or decline, typing their name and an optional note.

The first open records `quote_viewed` and notifies the team. The view is recorded by a request from the browser, so email link scanners, which fetch pages without running scripts, don't count as views. Accepting or declining notifies the team and runs the lifecycle above. Expired quotes can't be accepted. Pages are `noindex`, and the respond and PDF endpoints are rate-limited per token.

### PDF

`renderQuotePdf` (pdf-lib):
- **Layout**: A4, seller block, prepared-for block, cover note, and items with discounts and rules explained. Then totals with tax, the acceptance stamp and terms. A footer and page numbers are on every page, and tables continue across pages.
- **Fonts**: Inter (OFL, `packages/core/assets/fonts`) is embedded whole, so ₹ and other symbols render. pdf-lib's subsetting drops glyphs with this font, so a PDF is about 370 KB. If the fonts can't be found, it falls back to Helvetica with "Rs." amounts.
- **Standalone builds**: `next.config.ts` traces the font folder.

## Automation & copilot

- **Workflows**:
  - The *Move deal forward* step opens the lead's deal or advances it, never backwards.
  - Triggers include deal won, deal stage changed and quote accepted.
  - Outbound webhooks can subscribe to `quote_created`, `quote_accepted`, `deal_won`, `deal_lost` and `deal_stage_changed`.
- **Copilot tools**:
  - `get_pipeline`: summary, per-stage counts and the biggest deals.
  - `get_my_tasks`
  - `list_quotes`

## Permissions & plans

- **Permissions**:
  - `crm:read` / `crm:write`: deals, tasks, meetings, notes.
  - `quotes:write`: create, send and mark quotes.
  - `workspace:manage`: catalog, pricing rules and quote settings.
- **Plans**:
  - The CRM is on every plan.
  - Quotes need Pro or Scale. On Free, the Quotes tab shows an upgrade note and the API returns `FEATURE_NOT_IN_PLAN`.

## API

| Method | Path | |
|---|---|---|
| GET / POST | `/api/v1/deals` | Pipeline (`?owner=me&q=`) with summary; create |
| GET / PATCH / DELETE | `/api/v1/deals/:id` | Deal with tasks, notes, meetings, quotes and activity |
| POST | `/api/v1/deals/:id/move` | `{ stage, prevId?, nextId?, lostReason?, value? }` |
| POST | `/api/v1/deals/:id/notes` | Add a note |
| GET | `/api/v1/leads/:id/deals` | A company's deals and quotes |
| GET / POST · PATCH | `/api/v1/meetings` · `/api/v1/meetings/:id` | `?when=upcoming\|past`; `GET /:id/ics` downloads the invite |
| GET · DELETE | `/api/v1/tasks` · `/api/v1/tasks/:id` | Plus the existing create and update |
| GET | `/api/v1/contacts` | People across companies (`?q=`) |
| GET / POST | `/api/v1/quotes` | List (`?status&leadId&dealId`) with counts; create |
| POST | `/api/v1/quotes/draft` | AI draft for `{ leadId, dealId? }` |
| GET / PATCH / DELETE | `/api/v1/quotes/:id` | Delete only works on drafts |
| POST | `/api/v1/quotes/:id/send` · `/mark` · `/duplicate` | |
| GET | `/api/v1/quotes/:id/pdf` · `/messages` | PDF; the exact email and WhatsApp texts |
| GET / PATCH | `/api/v1/quotes/settings` | Numbering, validity, seller details, terms |
| GET · POST / PATCH / DELETE | `/api/v1/catalog` · `/api/v1/pricing-rules[/:id]` | Offerings use `/api/v1/offerings` |
| GET · POST | `/api/public/quotes/:token/pdf` · `/view` · `/respond` | Prospect endpoints (no session) |

## Limitations

- **One currency**: the workspace currency. Offerings in another currency are flagged, not converted.
- **No e-signature or payment collection** on acceptance. Acceptance is a typed name with a timestamp.
- **No invoices**: quotes are not invoices. Billing (Phase 8) covers the platform's own subscription, not invoicing your customers.
- **Views**: a view counts once per quote, from a browser with JavaScript.
