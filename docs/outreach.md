# Campaigns & outreach

How a campaign turns qualified leads into conversations, and the guarantees each step keeps. Code lives in `packages/core/src/campaigns` and `packages/core/src/outreach`.

## Lifecycle

```
DRAFT ──estimate──▶ confirm ──▶ ACTIVE ⇄ PAUSED ──▶ COMPLETED ──▶ ARCHIVED
  │                                  │
  └─ builder: offer → audience → channels & mode → sequence → review
```

1. **Build** (`/app/campaigns/new`). The audience is a lead filter (categories, cities, minimum score, qualification, status) with a live count and sample. Leads that are do-not-contact, suppressed, or **already running in another campaign** are always excluded — one lead, one live sequence. Each step shows a preview rendered for a real lead; AI personalisation previews are opt-in because they use credits.
2. **Estimate** (`estimateLaunch`). Audience size, reachable leads per channel, why others are unreachable (no email, no opt-in…), upper-bound message volume, AI credits, estimated provider cost, remaining plan usage, provider state (connected / demo / missing) and warnings.
3. **Launch** (`launchCampaign`) requires `confirm: true`, an allowed automation mode for the plan, a connected (or demo) provider per channel and a non-empty audience. First touches are staggered a few seconds apart.

## Sequence engine

`CampaignLead` walks the campaign's ordered steps:

| Stage | Where | What happens |
|---|---|---|
| Due | `sequences.tick` (every minute) | Finds `IN_SEQUENCE` members with `nextActionAt ≤ now` in active campaigns and queues `outreach.prepare-step` (job id bucketed per 10 minutes). |
| Prepare | `prepareCampaignStep` | Refuses to prepare a step twice. Runs `assertCanContact` (DNC, suppression, contact detail, WhatsApp opt-in, demo-lead guard). Composes the message — AI (`outreach_message` agent) or template — and sets its status by mode. |
| Approve | review queue | `MANUAL` → draft; `ASSISTED` → pending approval; `AUTOMATED` → approved (first touch still needs approval unless disabled in compliance settings). Reviewers can edit, approve, skip the step or stop the lead. |
| Send | `messages.send` → `sendMessage` | Last gate: campaign still active, send window + daily limit for automated sends (deferred, not dropped), compliance re-check, WhatsApp 24-hour rule, atomic usage metering (idempotent per message). Provider errors retry with backoff when transient and fail cleanly otherwise (usage released). |
| Advance | `advanceSequence` | Schedules the next step after its delay, or completes the member. |

A **reply always stops the sequence** for that lead in every campaign and cancels queued follow-ups. Opt-outs, bounces and complaints add suppressions.

## Channels

**Email** — Resend, SendGrid or SMTP (workspace integration → platform env → demo). Every message carries a footer, an unsubscribe link (`/u/<signed token>`, confirmation page; link scanners can't unsubscribe by prefetching) and RFC 8058 one-click `List-Unsubscribe` headers (`POST /api/unsubscribe/<token>`). Follow-ups thread with `In-Reply-To`/`References`.

**WhatsApp** — official Cloud API only. Business-initiated messages need recorded opt-in and a Meta-approved template (synced from WhatsApp Manager; demo templates exist only for the mock provider). Free-form text is only possible inside the 24-hour customer-service window. A WhatsApp step without an approved template is skipped unless the window is open.

**Calls** — `MANUAL_CALL` steps create call tasks today; `VOICE` steps are wired to the AI voice agent through `registerVoiceStepHandler` (Phase 4).

## Inbound & classification

`handleInboundMessage` (webhooks, simulator) matches the sender to a lead (In-Reply-To → contact email/phone → lead), stores the message idempotently, marks the conversation *needs response*, stops sequences and queues `conversations.analyze-inbound`. The conversation-analysis agent returns intent (positive, meeting request, pricing, question, not now, negative, opt-out, wrong person, out of office), sentiment, a summary and a suggested reply. A deterministic keyword pass runs first so opt-outs are honoured even if AI is unavailable. Positive intents move the lead to *Interested*; meeting requests and "not now" create tasks.

## Webhooks

| Endpoint | Verification |
|---|---|
| `POST /api/webhooks/email/resend[?integration=<id>]` | Svix signature (`RESEND_WEBHOOK_SECRET` or the integration's secret) |
| `POST /api/webhooks/email/sendgrid[?integration=<id>]` | SendGrid ECDSA public key |
| `GET/POST /api/webhooks/whatsapp` | Verify token handshake; `X-Hub-Signature-256` with the app secret |

Events are stored in `WebhookEvent` (unique on provider + external id → replays are no-ops), attributed to a workspace via the referenced message, and processed on the `webhooks` queue.

## Demo mode

With the mock email/WhatsApp providers nothing is delivered. After a mock send, the simulator schedules realistic delivery, open/read and occasional reply events (`DEMO_SIMULATE_EVENTS`), all flagged `simulated` and labelled in the UI, and routed through the same handlers as real webhooks.

## Metrics

Campaign stats come from the event log: delivery rate per message; open, reply and positive rates **per contacted lead**; a zero-filled daily series since launch; per-step progress from message states. Nothing on a campaign page is computed separately from stored events.
