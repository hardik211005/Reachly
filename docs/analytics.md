# Analytics & AI insights

Every number in analytics comes from the immutable event log (`events` table) or, for current state such as open deals, from the records themselves. Nothing is sampled, modelled or made up. When there isn't enough data, the UI says so instead of showing a figure.

- **Code**:
  - `packages/core/src/analytics` (`filters.ts`, `overview.ts` for the dashboard, `report.ts` for the analytics page and CSV export)
  - `packages/core/src/insights` (`stats.ts`, `generators.ts`, `service.ts`)
  - the `insight_writer` agent in `packages/core/src/ai/agents/insights.ts`
  - jobs in `packages/core/src/jobs/analytics.ts`
- **UI**:
  - `/app` (overview)
  - `/app/analytics` (filters in the URL, so a view can be shared)
  - `/app/ai-insights`

## Filters

All analytics queries take the same filters (`analyticsFilterSchema`):

| Filter | Applies to |
|---|---|
| `days` (default 30, max 730) or `from` / `to` | The period. The previous period of the same length is always computed for comparison. |
| `campaignId`, `channel` | The event itself |
| `city`, `industry`, `category` (business type), `source`, `minScore` | The lead the event belongs to (joined on `leads`, deleted leads excluded) |

Rates and counts respect every filter. AI cost can't be split by channel, so the page adds a note when a channel filter is on.

## Metric definitions

Rates are **per contacted lead** unless stated otherwise. A lead counts as *contacted* when an `email_sent`, `whatsapp_sent`, `call_started`, `call_failed` or `call_completed` event exists for it in the period. Each metric's definition is shown in its tooltip and exported with the CSV.

| Group | Metric | Definition |
|---|---|---|
| Acquisition | New leads | `lead_created` events |
| | Qualified leads | Distinct leads with `lead_qualified` |
| | Qualification rate | Qualified ÷ new leads |
| | Cost per lead | Total cost ÷ new leads |
| Engagement | Outreach sent | Emails + WhatsApp messages sent |
| | Delivery rate | Delivered ÷ sent (email and WhatsApp) |
| | Open rate | Distinct opened emails ÷ delivered emails. Approximate because of image blocking. |
| | Reply rate | Leads who replied (email or WhatsApp) or answered a call ÷ contacted |
| | Positive reply rate | Leads with a positive reply classification (`POSITIVE`, `MEETING_REQUEST`, `PRICING_REQUEST`) or a positive call outcome (`INTERESTED`, `MEETING_REQUESTED`) ÷ contacted |
| | Call answer rate | Calls answered ÷ calls placed |
| Conversion | Meeting rate | Leads with a meeting ÷ contacted |
| | Quote rate | Leads sent a quote ÷ contacted |
| | Conversion rate | Leads with a won deal ÷ contacted |
| | Revenue won | Sum of `deal_won` values (before tax) |
| Cost & ROI | AI cost | Model usage for every agent |
| | Channel & automation cost | Estimated email and WhatsApp fees plus voice minutes |
| | Cost per qualified lead / per meeting | Total cost ÷ qualified leads / meetings |
| | Total cost | AI + channels + voice + the plan subscription, prorated to the period |
| | Estimated ROI | (Revenue − total cost) ÷ total cost, shown as a multiple |

Changes against the previous period are relative for counts and money, and in percentage points for rates. When the previous period is empty, the change reads "new" instead of a misleading percentage.

## Costs

Costs are **estimates** in the workspace currency.

- **AI**: the recorded cost of every AI request (`ai_usage`, micro-USD), converted with `USD_EXCHANGE_RATE` in `packages/config/src/costs.ts`.
- **Channels**: `CHANNEL_UNIT_COST_USD` per email ($0.0009) and WhatsApp template conversation ($0.011).
- **Voice**: the provider's reported cost when there is one (stored in the org currency); otherwise the call length × $0.09 per minute.
- **Subscription**: the plan's monthly price × days in the period ÷ 30.

Operators can tune the rates in `costs.ts`. The page footer always states that costs are estimates and which currency they are converted into.

## The analytics page

- **Metric tiles** by group. Rate tiles show their numerator and denominator ("22 of 40").
- **Over time**: activity, meetings & wins, leads and revenue, daily (weekly for ranges over 92 days) in the workspace timezone.
- **Conversion funnel**: leads → qualified → contacted → replied → interested → meeting → quote → won.
- **Channels**: reply and positive rates per contacted lead on each channel.
- **Where results come from**: the same rates by area, city, business type, source, score band or fit. Groups with fewer than 5 contacted leads are marked `(n=…)` so they aren't over-read.
- **Advanced** (plans with `advancedAnalytics`):
  - campaigns with channel cost
  - reply heatmap (weekday × hour, workspace timezone)
  - replies by sequence step (each reply credited to the last step received before it)
  - cohorts by week of first contact (share reaching replied / positive / meeting / won within N weeks)
  - loss reasons and objection themes from analysed calls
  - lead quality
  - cost breakdown
  - AI usage by agent
- **Export**: CSV for metrics, series, funnel and every breakdown (`GET /api/v1/analytics/export?dataset=…`).

Every chart has a table view (the table icon on its card) with the same numbers.

## AI insights

Insights are computed **in code** from the last 30 days, then optionally reworded by AI. AI never chooses what to say or which numbers to use.

### Generators

| Kind | Finding | Evidence required |
|---|---|---|
| `channel_comparison` | One channel gets more positive responses than another | ≥ 8 contacted leads per channel, ≥ 2 positives, lift ≥ 25%, two-proportion z-test confidence ≥ 70% |
| `area_comparison`, `category_comparison`, `campaign_comparison` | An area, business type or campaign responds better than everyone else | ≥ 5 contacted in the segment (8 for campaigns), ≥ 8 in the rest, ≥ 2 hits, lift ≥ 30%, z-test against the rest ≥ 70% |
| `score_calibration` | High-score leads really do reply more (or don't) | ≥ 8 leads in each band, ≥ 8 point gap, z-test ≥ 70% |
| `loss_reasons` | Price is the most common loss reason or objection | ≥ 35% share, or ≥ 3 mentions of one theme |
| `followup_decay` / `followup_value` | Later follow-ups stop working, or follow-ups bring a large share of replies | ≥ 8 sends per step, ≥ 3 replies |
| `period_change` | The reply rate moved against the previous 30 days | ≥ 16 contacted leads in both periods, ≥ 5 point change, z-test ≥ 70% |
| `stalled_deals` | Open deals unchanged for 14+ days | Current state |
| `unopened_quotes` | Quotes sent 3+ days ago with no view | Current state |

Each insight stores its **method**, the **group counts**, the **p-value** where one applies, the **confidence** and the exact **facts** it may quote. The UI shows these under "Show evidence". Confidence is labelled **High** from 90%, **Moderate** from 75%, and **Early signal** below that. Descriptive findings use a confidence that grows with the amount of evidence and is capped at 95%.

### Wording

When a real AI provider is configured, `insight_writer` rewords the template. The result is **rejected** if it contains any number that isn't in the facts or the template (`usesOnlyKnownNumbers`), and the template is kept. Insights reworded by AI are marked as such.

### Lifecycle

- **Regeneration**:
  - daily at 06:00 (`analytics.insights-all`, one job per workspace with recent activity and the `aiInsights` feature)
  - on demand with **Refresh** (`POST /api/v1/insights/refresh`, rate-limited)
- **Deduplication**: the fingerprint is `kind:key:ISO-week`, so a rerun in the same week updates an insight instead of duplicating it.
- **Current set**: the latest run, at most 8 insights, ordered by confidence. Older runs are under **Earlier**.
- **Dismissing** hides an insight until it is restored (`POST /api/v1/insights/:id/dismiss`).

## API

| Endpoint | What it returns |
|---|---|
| `GET /api/v1/analytics/overview` | Dashboard KPIs, series, funnel, channels, campaigns |
| `GET /api/v1/analytics/report` | The analytics page: metric groups, costs, series, funnel, channels, advanced detail |
| `GET /api/v1/analytics/breakdown?dimension=` | Rates by `channel`, `campaign`, `city`, `area`, `category`, `source`, `score` or `fit` |
| `GET /api/v1/analytics/cohorts?milestone=` | Weekly contact cohorts for `replied`, `positive`, `meeting` or `won` |
| `GET /api/v1/analytics/export?dataset=` | CSV |
| `GET /api/v1/insights?view=` | `current`, `history` or `dismissed` |
| `POST /api/v1/insights/refresh` | Regenerate now |
| `POST /api/v1/insights/:id/dismiss` | `{ dismissed: boolean }` |

All analytics endpoints take the filters above as query parameters and require the `analytics:read` permission.
