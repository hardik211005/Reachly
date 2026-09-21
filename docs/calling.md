# AI calling

How the AI voice agent calls leads, and the rules it can't break. Code: `packages/integrations/src/voice`, `packages/core/src/calls`, agents in `packages/core/src/ai/agents/calls.ts`.

## Flow

```
prepare ──▶ PREPARED ──start (explicit confirm)──▶ QUEUED ──calls.start──▶ RINGING ──▶ IN_PROGRESS ──▶ COMPLETED ──calls.analyze──▶ outcome
   │  call_brief agent                               │ outside calling hours:                │ live transcript           │ call_analysis agent
   │  (objective, opening, pitch,                    │ scheduled, not dropped                │ (turn by turn)            │ + rule safety net
   │   questions, objections, close)                 ▼                                       ▼                           ▼
   │                                              NO_ANSWER / BUSY / FAILED ──▶ call_failed, sequence continues      CRM side effects
```

1. **Prepare** (`prepareCall`) — the `call_brief` agent writes a brief from the lead's data, conversation history and configured offer. Prices only come from configured offerings. If the AI is unavailable the grounded template brief is used, so calls never block on AI.
2. **Start** (`startCall`) needs `confirm: true`. AI calls then pass `assertCanCall`. Outside the workspace's calling hours a real call is scheduled for the next window.
3. **Place** (`executeCallStart`, job `calls.start`) re-checks the policy and hands the call to the provider with the agent config (first message, system prompt built from the brief, end phrases, max 5 minutes, recording per settings).
4. **During the call**, statuses arrive by webhook (or from the demo simulator). The transcript fills in live, and the call page polls it.
5. **After the call** (`applyCallStatus` → `analyzeCall`) voice minutes are metered once per call (idempotent, rounded up per call). The `call_analysis` agent sets the outcome, summary, sentiment, interest, objections and next step. If the transcript contains an explicit opt-out, the outcome is always *do not contact*.

## Outcomes → CRM

| Outcome | What happens |
|---|---|
| Meeting requested | A `Meeting` at the time the prospect said, parsed in the workspace timezone (e.g. "Thursday afternoon" → Thu 15:00), plus a task to send the invite. If no day was said, only a task is created — times are never invented. Lead → *Meeting*. |
| Interested / needs information | Lead → *Interested*, follow-up task. |
| Call back later | Call task on the follow-up date. |
| Wrong contact | Task to find the right person. |
| Do not contact | Phone + lead suppressed everywhere; `opt_out` event. |
| Not interested | No further tasks. |

In a campaign, a positive outcome stops the sequence (`REPLIED`), an opt-out marks the member `OPTED_OUT`, a clear no stops it, and anything else (no answer, call back later) moves on to the next step.

## Rules (`assertCanCall`)

AI calls are refused (`CallBlockedError`, HTTP 409 `COMPLIANCE_BLOCKED`) unless:

- the plan includes the voice agent and voice minutes remain;
- an admin has **enabled calling** and **attested consent / lawful basis**. This is audited with who and when (Calls → *Calling setup*);
- the lead has a number, isn't do-not-contact, and the number and lead aren't suppressed;
- for real providers: the lead isn't demo data, and, if *Require a DND registry check* is on, a registry check is available. No registry provider ships yet, so real calls stay blocked until the admin turns the requirement off after confirming consent. Your own suppression list is always checked.

The agent says it is an AI assistant when *Disclose that the caller is an AI* is on (the default). Recording is off by default. Enable it only where it's lawful and callees are told.

## Providers

| | Vapi | Twilio | Demo |
|---|---|---|---|
| Who runs the conversation | Vapi's hosted agent, configured per call with our brief | Our server: each turn Twilio posts speech to `/api/webhooks/voice/twilio/turn`, the `voice_turn` agent (6s timeout, rule-based fallback) picks the next line, and we answer with TwiML `<Say>` + speech `<Gather>` | Simulator, using the same turn policy as Twilio calls |
| Status | `status-update` and `end-of-call-report` to `/api/webhooks/voice/vapi` | StatusCallback to `/api/webhooks/voice/twilio?call=<id>` | Demo jobs |
| Verification | `x-vapi-secret` must equal the webhook secret | `X-Twilio-Signature` over the public URL + params | — |
| Transcript | From the end-of-call report | Captured turn by turn | Written live |

Setup:

- **Vapi**: create a phone number in Vapi, then set `VOICE_PROVIDER=vapi`, `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` and `VAPI_WEBHOOK_SECRET`. Or connect it per workspace in Integrations. The server URL is set on each call.
- **Twilio**: set `VOICE_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`. `APP_URL` must be the public HTTPS URL Twilio calls, because signatures are computed over it.

Adapter request shapes follow each provider's API. Every provider call sits in one method per adapter (`createCall`, `endCall`, `getCallStatus`, `getRecording`, `getTranscript`, `handleWebhook`), so updating to an API change touches only one file.

## Demo mode

With the mock provider nobody is dialled. The simulator rings the call, picks a scenario (meeting, info request, callback, not interested, wrong person, opt-out, no answer, busy) and plays the conversation live through the same turn policy real Twilio calls use. It then ends the call so metering, analysis and CRM updates run exactly as they would for a real call. Simulated calls are flagged `simulated` and labelled on every screen. Outside calling hours, demo calls still run, and the call page notes that a real call would have waited.
