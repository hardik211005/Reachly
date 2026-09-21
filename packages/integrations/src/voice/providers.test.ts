import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IntegrationError } from "../lib/errors";
import { TwilioVoiceProvider, VapiVoiceProvider, twiml } from "./providers";

const request = (body: string, headers: Record<string, string>, url = "https://app.example.com/api/webhooks/voice/vapi") => ({ headers: new Headers(headers), rawBody: body, url });

describe("Vapi webhooks", () => {
  const vapi = new VapiVoiceProvider({ apiKey: "key", phoneNumberId: "pn_1", webhookSecret: "s3cret" });
  const report = JSON.stringify({
    message: {
      type: "end-of-call-report",
      endedReason: "assistant-ended-call",
      startedAt: "2026-09-21T05:00:00.000Z",
      endedAt: "2026-09-21T05:01:10.000Z",
      cost: 0.11,
      call: { id: "call_1", metadata: { callId: "c-1" } },
      artifact: {
        recordingUrl: "https://storage.example.com/rec.wav",
        messages: [
          { role: "system", message: "prompt" },
          { role: "bot", message: "Hi, do you have a minute?", secondsFromStart: 0.4, time: 1000, endTime: 3000 },
          { role: "user", message: "Sure.", secondsFromStart: 3.2, time: 3800, endTime: 4400 },
        ],
      },
    },
  });

  it("rejects a missing or wrong secret", () => {
    expect(() => vapi.handleWebhook(request(report, {}))).toThrow(IntegrationError);
    expect(() => vapi.handleWebhook(request(report, { "x-vapi-secret": "nope" }))).toThrow(IntegrationError);
  });

  it("turns the end-of-call report into a transcript and a completed status", () => {
    const events = vapi.handleWebhook(request(report, { "x-vapi-secret": "s3cret" }));
    const transcript = events.find((event) => event.type === "transcript");
    const status = events.find((event) => event.type === "status");
    expect(transcript).toMatchObject({ callId: "c-1", transcript: { segments: [{ speaker: "agent", text: "Hi, do you have a minute?", startMs: 400, endMs: 2400 }, { speaker: "prospect", text: "Sure." }] } });
    expect(status).toMatchObject({ status: "completed", durationSeconds: 70, recordingUrl: "https://storage.example.com/rec.wav", costUsd: 0.11 });
  });

  it("maps unanswered calls", () => {
    const body = JSON.stringify({ message: { type: "end-of-call-report", endedReason: "customer-did-not-answer", call: { id: "call_2" } } });
    const [status] = vapi.handleWebhook(request(body, { "x-vapi-secret": "s3cret" }));
    expect(status).toMatchObject({ type: "status", status: "no_answer" });
  });
});

describe("Twilio", () => {
  const twilio = new TwilioVoiceProvider({ accountSid: "AC1", authToken: "token", fromNumber: "+15550001111" });
  const url = "https://app.example.com/api/webhooks/voice/twilio?call=c-9";
  const params = { CallSid: "CA123", CallStatus: "completed", CallDuration: "95", SequenceNumber: "3" };
  const body = new URLSearchParams(params).toString();
  const signature = createHmac("sha1", "token")
    .update(Object.keys(params).sort().reduce((acc, key) => acc + key + params[key as keyof typeof params], url))
    .digest("base64");

  it("verifies X-Twilio-Signature and parses status callbacks", () => {
    expect(() => twilio.handleWebhook(request(body, { "x-twilio-signature": "bad" }, url))).toThrow(IntegrationError);
    const [event] = twilio.handleWebhook(request(body, { "x-twilio-signature": signature }, url));
    expect(event).toMatchObject({ type: "status", providerCallId: "CA123", callId: "c-9", status: "completed", durationSeconds: 95 });
  });

  it("builds TwiML that listens for speech, and escapes text", () => {
    const xml = twiml({ say: ["Tom & Jerry's <café>"], gather: { action: "https://app.example.com/turn?call=1", language: "en-IN" } });
    expect(xml).toContain("<Gather input=\"speech\"");
    expect(xml).toContain("Tom &amp; Jerry&apos;s &lt;café&gt;");
    expect(xml).toContain("<Redirect");
    expect(twiml({ say: ["Bye"], hangup: true })).toMatch(/<Say[^>]*>Bye<\/Say><Hangup\/><\/Response>$/);
  });
});
