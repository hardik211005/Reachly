# Automation

Workflows react to what happens in ReachAI (a reply, a call outcome, a booked meeting) and do the follow-up work: update the lead, create tasks, notify the team, enrol the lead in a campaign, prepare a call, or hand off to n8n and other systems. Code: `packages/core/src/workflows`, jobs in `packages/core/src/jobs/workflows.ts`, n8n client in `packages/integrations/src/automation/n8n.ts`, UI in `apps/web/components/workflows`.

The app owns the data, rules and permissions. n8n is an optional integration layer, not where business logic lives.

## Model

A workflow is a JSON definition validated by the same zod schemas on the client and the server (`workflows/schemas.ts`):

```json
{
  "name": "Positive reply → follow up fast",
  "trigger": { "type": "event", "eventType": "reply_classified",
               "conditions": [{ "field": "event.properties.intent", "op": "equals", "value": "POSITIVE" }] },
  "steps": [
    { "id": "s1", "type": "update_lead_status", "status": "INTERESTED" },
    { "id": "s2", "type": "create_task", "title": "Reply to {{lead.name}} today", "priority": "HIGH", "dueInDays": 0 },
    { "id": "s3", "type": "notify", "title": "{{lead.name}} replied positively", "body": "" }
  ]
}
```

- **Triggers**:
  - `event`: one of 12 domain events, optionally filtered by conditions.
  - `schedule`: daily or weekly at an hour in the workspace timezone.
  - `webhook`: a signed inbound URL.
  - `manual`: run by hand.
- **Steps** run top to bottom. There is no branching: a condition step (*Only continue if…*) ends the run when it doesn't match, and the run counts as completed.

| Step | What it does | Needs a lead |
|---|---|---|
| Only continue if… | Stops unless all/any conditions match | – |
| Wait | Pauses 1–90 minutes/hours/days | – |
| Update lead status | Moves the lead (skipped for do-not-contact leads) | ✓ |
| Add tag | Adds a lowercase tag | ✓ |
| Add to campaign | Enrols the lead through the normal audience rules (suppression, one live campaign per lead) | ✓ |
| Stop sequences | Stops the lead's running sequences and cancels unsent campaign messages | ✓ |
| Send email | Direct email; a draft in the review queue unless *Require approval* is off. Skipped if the lead has no email or can't be contacted | ✓ |
| Prepare a call | Creates a call with an AI brief in the call queue. It never dials; starting a call stays an explicit human action | ✓ |
| Create task | Task assigned to the lead owner | – |
| Notify the team | In-app notification, plus Slack when connected | – |
| Send webhook | Signed JSON POST to any HTTPS URL | – |
| Run n8n workflow | Triggers an n8n webhook and can wait for n8n to call back | – |

**Conditions** use the operators `equals`, `not_equals`, `in`, `not_in`, `contains`, `gt`, `gte`, `lt`, `lte`, `exists` and `not_exists`. They can check lead fields (status, score, fit tier, city, category, tags, email, phone) and event fields (reply intent, call outcome, new status, channel).

**Text fields** accept `{{tokens}}` such as `{{lead.name}}`, `{{lead.city}}`, `{{event.label}}` or `{{steps.<id>.<field>}}`. In the builder, *Insert variable* lists them. Unknown tokens render empty.

**Validation** (`validateDefinition`) runs on save and again before activating:

- steps that need a lead aren't allowed on triggers that have none;
- campaigns must exist;
- n8n steps require the plan feature.

A workflow with problems can be saved as a draft but not activated.

## Engine

```
event ──▶ event subscriber "workflows" ──▶ startExecution ──▶ workflows.execute ──▶ step … step ──▶ COMPLETED
          (conditions, self-trigger guard,    (idempotency key,        │                          FAILED ──▶ notification + retry from the failed step
           idempotency event:<id>)            context snapshot)        └─ Wait / n8n ──▶ WAITING ──workflows.resume-due (every minute)──▶ continues
```

- **Snapshot**: every execution stores its trigger data, lead variables and a copy of the definition. Editing a workflow never changes runs already in flight.
- **Persisted progress**: each step writes a `WorkflowStepRun` (input, output, error, timing), and the execution records `currentStepIndex`. Retrying a failed run resumes from the step that failed; earlier steps aren't repeated. If a worker dies mid-step, the open step run is closed as interrupted and the step runs again.
- **Exactly once per trigger**: runs are keyed on `event:<eventId>`, `schedule:<hour slot>` or the caller's `idempotencyKey` for webhooks. Retries of the fan-out job never start a workflow twice.
- **No loops**: steps run as the workflow's own actor (`WORKFLOW`, `<workflowId>`), and a workflow ignores events it produced itself.
- **Waits**: a Wait step sets the execution to `WAITING` with `resumeAt`. The `workflows.resume-due` job runs every minute; it re-queues due runs, times out n8n waits and starts scheduled workflows. Scheduled workflows run at most once per ~23 hours.
- **Failures**:
  - A failing step fails the run with *Step N (label): reason*.
  - It records `workflow_failed` and notifies the team with a link to the run.
  - *Send email* and *Prepare a call* treat "can't contact this lead" as a skipped step, not a failure.
- **Tests (dry runs)**: *Test* runs every step synchronously against a chosen lead (or none), without changing anything. Each node shows what it *would* do, e.g. *Would create task "Reply to Monsoon Cafe today"*. For event triggers the test builds a sample event from the trigger's conditions. Test runs are hidden from run history by default.
- **Plan gating**:
  - workflows and n8n are Pro+;
  - outbound webhook endpoints are Scale;
  - the number of workflows is capped by the plan's workflow limit.

Run history (*Workflows → Runs* and the builder's *Runs* panel) shows every execution with its trigger, lead, duration, and each step's input, output and error. Failed runs can be retried; running or waiting runs can be canceled.

## n8n

Both directions are supported. None of them is required: without n8n, workflows run entirely in the app.

**ReachAI → n8n** (*Run n8n workflow* step)
- POSTs `{ workflow, execution, event, lead, trigger, callback }` to `<n8n>/webhook/<path>`.
- Signed as `x-reachai-signature: t=<unix>,v1=<hex HMAC-SHA256("t.body")>` with `N8N_WEBHOOK_SECRET` (or the workspace's n8n integration secret).
- With *Wait for n8n* on, the run pauses until n8n POSTs to `callback.url`:

```json
{ "token": "<callback.token>", "status": "success", "data": { "outlets": 12 } }
```

- The token is signed, bound to the run and step, and valid for 7 days.
- `data` becomes `{{steps.<id>.callback.*}}` for later steps. `"status": "error"` fails the run.
- If n8n doesn't answer within the step's timeout (1–72 h, default 24), the run fails instead of hanging.

**n8n → ReachAI**
- Workflows with a *webhook* trigger show a signed URL: `POST /api/hooks/workflows/<token>`. The token is the credential. Rotating the signing secret invalidates all hook URLs.
- The body is free JSON. `leadId` attaches a lead, and `idempotencyKey` makes retries safe.
- The URL answers `202` with the run id. Requests are rate-limited to 120/min per workflow, and bodies are limited to 64 KB.
- n8n can also call the REST API with an API key (Scale plan).

**Connection**, checked in this order:
1. the workspace's n8n integration (URL, API key, webhook secret);
2. the platform `N8N_URL` / `N8N_API_KEY`;
3. in demo mode, a labelled simulated client.

*Workflows → n8n* shows health, the workflows in the connected n8n and the callback URL.

**Templates** in `apps/web/public/n8n/`: download them from the n8n tab and import them into n8n. `docker compose` also mounts them at `/workflows`.

| File | Pattern |
|---|---|
| `reachai-meeting-booked.json` | Webhook → verify signature → Google Sheets row → respond |
| `reachai-enrich-callback.json` | Webhook → do work → POST the result to the callback URL (for steps that wait) |
| `reachai-daily-digest.json` | Schedule → ReachAI API → Slack |

The template Code nodes verify the signature, so n8n needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` and `REACHAI_WEBHOOK_SECRET` set to the same value as `N8N_WEBHOOK_SECRET`. The compose file sets both.

**Known limitation**: n8n re-serialises the parsed body before it's hashed, so a payload whose JSON serialises differently (e.g. unusual number formats) would fail verification. ReachAI's payloads are plain JSON and verify as expected. The templates haven't been tested against every n8n version.

## Outbound webhooks

On the Scale plan, admins subscribe HTTPS endpoints to domain events (*Workflows → Outbound webhooks*). This is separate from workflows.

- **Secret**: each endpoint has its own `whsec_…` secret. It is shown once and stored encrypted.
- **Delivery**:
  - Headers: `x-reachai-event`, `x-reachai-delivery` (the delivery id, for deduplication) and `x-reachai-signature` (same `t=,v1=` scheme as above).
  - Body: `{ id, type, occurredAt, data: { leadId, campaignId, callId, dealId, channel, properties } }`.
- **Retries**: up to 6 attempts with exponential backoff (2 s, 4 s, 8 s …, capped at 5 minutes). A delivered webhook is never re-sent. *Send test* posts a single `ping` that fails visibly if the endpoint is down.
- **Delivery log**: each endpoint shows its last 10 deliveries with status code and error.

Verifying a delivery (Node):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret: string, header: string, rawBody: string) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return Math.abs(Date.now() / 1000 - Number(t)) < 300 && v1?.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

## Security

- **Outbound URLs**:
  - *Send webhook* steps and endpoints go through `assertPublicUrl`.
  - In production they must be HTTPS and can't target localhost, private ranges, link-local or `.internal`/`.local` hosts.
  - Requests time out (15 s for steps, 10 s for deliveries). Stored responses are cut to 500 characters.
  - Limitation: the check is on the hostname only. DNS answers aren't pinned, so a public name that resolves to a private address isn't caught. Run workers with egress rules if that matters.
- **Signatures**:
  - *Send webhook* steps are signed with a per-workflow secret derived from `SIGNING_SECRET`, shown in the step inspector.
  - n8n traffic uses the n8n secret.
  - Endpoints use their own secret.
- **Permissions**: `workflows:read` / `workflows:write` for workflows; `integrations:manage` for endpoints. Activation, pausing and deletion are audited.

## API

| Method | Path | |
|---|---|---|
| GET / POST | `/api/v1/workflows` | List; create from `{ template }` or a definition |
| GET / PUT / DELETE | `/api/v1/workflows/:id` | Read (with issues and hook URL), update, delete |
| POST | `/api/v1/workflows/:id/status` | `{ status: "ACTIVE" \| "PAUSED" }` |
| POST | `/api/v1/workflows/:id/run` | `{ leadId?, dryRun = true, payload? }` |
| GET | `/api/v1/workflows/executions` | `?workflowId&status&includeTests&limit` |
| GET | `/api/v1/workflows/executions/:id` | Run with step runs |
| POST | `/api/v1/workflows/executions/:id/retry` · `/cancel` | |
| GET | `/api/v1/workflows/templates` · `/n8n` | Built-in templates; n8n status |
| GET / POST / DELETE | `/api/v1/webhook-endpoints[/:id]` | Outbound endpoints; `POST /:id/test` sends a ping |
| POST | `/api/hooks/workflows/:token` | Inbound trigger (no session; the token is the credential) |
| POST | `/api/hooks/n8n/callback` | n8n continues a waiting run |

## Demo data

The seed creates three live workflows (*Positive reply → follow up fast*, *Call back requested → schedule it*, *Opt-out → alert the owner*) and two drafts. It replays the demo events through the real engine, so their runs, tasks and notifications are genuine engine output. In demo mode n8n steps use the simulated client, and their output is labelled `simulated: true`.
