/**
 * The six rejection payloads from BUILD-CARD.md §3 (spine), plus the happy
 * path, run against the real validator. FHIR write-path tests live in
 * scripts/verify-demo.ts because they need the hosted server.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { validateClaim } from "../../lib/claims/validate";
import { composeReadback, idempotencyKey, parseExactTime } from "../../lib/claims/normalize";
import type { ClaimPayload } from "../../lib/claims/schema";
import {
  appendTurn,
  clearSessions,
  createSession,
  type InterviewSession,
} from "../../lib/session/store";

const CANONICAL: ClaimPayload = {
  encounterId: "stroke-code-001",
  patientId: "temporary-rosa",
  callId: "call-spouse-01",
  sourceId: "RelatedPerson/spouse",
  sourceRole: "spouse",
  eventType: "last-known-baseline",
  timeKind: "exact",
  time: "2026-08-01T08:32:00-07:00",
  interaction: "phone",
  directness: "direct",
  observedDomains: ["speech", "behavior"],
  anchor: {
    type: "phone-call-log",
    description: "Witness checked recent calls during interview",
  },
  quote: "She sounded completely normal and we talked about lunch.",
  confirmation: { method: "spoken-readback", confirmed: true },
};

function activeSession(): InterviewSession {
  const s = createSession({
    callId: "call-spouse-01",
    encounterId: "stroke-code-001",
    patientId: "temporary-rosa",
    sourceId: "RelatedPerson/spouse",
    sourceRole: "spouse",
    witnessName: "Luis M.",
    brief: "test brief",
  });
  s.status = "interviewing";
  s.gates = {
    disclosureBasisRecorded: true,
    recipientVerified: true,
    aiParticipationAgreed: true,
  };
  appendTurn(s.callId, {
    role: "assistant",
    content: "Did you personally see when Rosa's symptoms began, or did you learn about them afterward?",
  });
  appendTurn(s.callId, {
    role: "user",
    content: "I didn't see them start. Our daughter called me after she found her. I had spoken with Rosa earlier.",
  });
  appendTurn(s.callId, { role: "assistant", content: "When did you last personally speak with Rosa?" });
  appendTurn(s.callId, { role: "user", content: "This morning, around eight-thirty." });
  appendTurn(s.callId, { role: "assistant", content: "Can you check your recent calls for the exact time?" });
  appendTurn(s.callId, { role: "user", content: "One second. It was 8:32 AM." });
  appendTurn(s.callId, {
    role: "assistant",
    content: "During that call, what did you notice about her speech or behavior?",
  });
  appendTurn(s.callId, {
    role: "user",
    content: "She sounded completely normal and we talked about lunch.",
  });
  appendTurn(s.callId, { role: "assistant", content: composeReadback(CANONICAL) });
  appendTurn(s.callId, { role: "user", content: "Yes, that's correct." });
  return s;
}

beforeEach(() => clearSessions());

describe("validateClaim — happy path", () => {
  it("accepts the canonical ST-01 claim with field evidence", () => {
    const s = activeSession();
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(true);
    expect(out.result.accepted).toBe(true);
    expect(out.evidence?.map((e) => e.field)).toEqual([
      "time",
      "eventType",
      "directness",
      "observedDomains",
      "anchor",
      "confirmation",
    ]);
    const timeEvidence = out.evidence?.find((e) => e.field === "time");
    expect(timeEvidence?.quote).toContain("8:32");
  });

  it("read-back composition speaks the clock time and day segment", () => {
    const readback = composeReadback(CANONICAL);
    expect(readback).toContain("8:32");
    expect(readback).toContain("morning");
    expect(readback).toContain("call log");
  });

  it("distinguishes finding symptoms from witnessing their onset in the spoken read-back", () => {
    const discovery = composeReadback({ ...CANONICAL, eventType: "symptom-discovery", interaction: "in-person", observedDomains: ["speech", "movement"] });
    expect(discovery).toContain("found the patient with symptoms already present");
    expect(discovery).toContain("speech and movement");
    expect(discovery).toContain("in person at 8:32 this morning");
    expect(discovery).not.toContain("normal");
    expect(discovery).not.toContain("witnessed symptoms begin");
    const onset = composeReadback({ ...CANONICAL, eventType: "witnessed-onset" });
    expect(onset).toContain("witnessed symptoms begin");
    expect(onset).not.toContain("already present");
    const contact = composeReadback({ ...CANONICAL, eventType: "last-contact" });
    expect(contact).not.toContain("normal");
  });
});

describe("validateClaim — the six rejection payloads", () => {
  it("1. rejects an unconfirmed claim", () => {
    const s = activeSession();
    const out = validateClaim(
      { ...CANONICAL, confirmation: { method: "spoken-readback", confirmed: false } },
      s
    );
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("exact-time-not-confirmed");
  });

  it("2. rejects an exact time without an anchor", () => {
    const s = activeSession();
    const out = validateClaim(
      { ...CANONICAL, anchor: { type: "none", description: "remembered" } },
      s
    );
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("exact-time-missing-anchor");
  });

  it("3. rejects an exact time without date and timezone", () => {
    const s = activeSession();
    const out = validateClaim({ ...CANONICAL, time: "08:32" }, s);
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("exact-time-missing-date-or-timezone");
  });

  it("4. rejects a wrong patient or encounter for the session", () => {
    const s = activeSession();
    const out = validateClaim({ ...CANONICAL, patientId: "someone-else" }, s);
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("wrong-patient-or-encounter");
  });

  it("5. returns original resource IDs on a duplicate idempotency key, creating nothing", () => {
    const s = activeSession();
    const ids = {
      observation: "Observation/existing-1",
      questionnaireResponse: "QuestionnaireResponse/existing-1",
      task: "Task/existing-1",
      provenance: "Provenance/existing-1",
    };
    s.recorded[idempotencyKey(CANONICAL)] = ids;
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(true);
    expect(out.duplicateOf).toEqual(ids);
    expect(out.result.resourceIds).toEqual(ids);
    expect(out.result.reason).toBe("duplicate-idempotency-key-returned-existing");
  });

  it("6. rejects a payload after refusal or cancellation", () => {
    const s = activeSession();
    s.status = "refused";
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("call-refused-or-cancelled");
  });
});

describe("validateClaim — false precision and read-back gates", () => {
  it("rejects a non-exact timeKind on the confirmed-claim function", () => {
    const s = activeSession();
    const out = validateClaim({ ...CANONICAL, timeKind: "approximate" }, s);
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("non-exact-time-on-confirmed-claim");
  });

  it("accepts a read-back split across consecutive assistant turns (live voice chunking)", () => {
    const s = activeSession();
    s.transcript = s.transcript.slice(0, 8);
    appendTurn(s.callId, { role: "assistant", content: "Let me read back what you've shared: You spoke with Rosa by phone this morning at exactly 8:32 AM." });
    appendTurn(s.callId, { role: "assistant", content: "During that call, you personally observed that she sounded completely normal." });
    appendTurn(s.callId, { role: "assistant", content: "This time comes from your phone call log." });
    appendTurn(s.callId, { role: "assistant", content: "Is that correct?" });
    appendTurn(s.callId, { role: "user", content: "Yes. That's correct." });
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(true);
    expect(out.result.accepted).toBe(true);
  });

  it("accepts a quote split across consecutive witness turns (live voice chunking)", () => {
    const s = activeSession();
    s.transcript = s.transcript.slice(0, 7);
    appendTurn(s.callId, { role: "user", content: "She sounded completely normal." });
    appendTurn(s.callId, { role: "user", content: "We talked about lunch plans." });
    appendTurn(s.callId, { role: "assistant", content: composeReadback(CANONICAL) });
    appendTurn(s.callId, { role: "user", content: "Yes, that's correct." });
    const out = validateClaim(
      { ...CANONICAL, quote: "She sounded completely normal. We talked about lunch plans." },
      s
    );
    expect(out.ok).toBe(true);
  });

  it("accepts a read-back with a benign witness interjection mid-read-back", () => {
    const s = activeSession();
    s.transcript = s.transcript.slice(0, 8);
    appendTurn(s.callId, { role: "assistant", content: "Let me read that back: you spoke with Rosa by phone at 8:32 AM this morning." });
    appendTurn(s.callId, { role: "user", content: "She sounded completely normal." });
    appendTurn(s.callId, { role: "assistant", content: "Right — she sounded completely normal, and the time comes from your call log. Is that correct?" });
    appendTurn(s.callId, { role: "user", content: "Yes, that's correct." });
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(true);
  });

  it("rejects when the claimed time was mentioned earlier but absent from the final read-back", () => {
    const s = activeSession();
    s.transcript = s.transcript.slice(0, 6); // includes witness saying "8:32 AM" earlier
    appendTurn(s.callId, { role: "assistant", content: "Earlier you mentioned 8:32 AM this morning." });
    appendTurn(s.callId, { role: "user", content: "Right." });
    appendTurn(s.callId, { role: "assistant", content: "So she was found with symptoms already present around two PM." });
    appendTurn(s.callId, { role: "assistant", content: "Could you confirm that this is correct?" });
    appendTurn(s.callId, { role: "user", content: "Yes, I confirm that is correct." });
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("readback-not-observed");
  });

  it("rejects a time the witness never said, even when the read-back was confirmed", () => {
    const s = activeSession();
    // Witness said 8:32; the agent drifts to 8:30 in the read-back and files 8:30.
    appendTurn(s.callId, { role: "assistant", content: "Let me read that back: you spoke with Rosa by phone at 8:30 this morning, she sounded completely normal, and the time comes from your call log. Is that correct?" });
    appendTurn(s.callId, { role: "user", content: "Yes, that's correct." });
    const out = validateClaim({ ...CANONICAL, time: "2026-08-01T08:30:00-07:00" }, s);
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("time-not-spoken-by-witness");
  });

  it("accepts a witness time spoken as words split across ASR turns", () => {
    const s = activeSession();
    s.transcript = s.transcript.slice(0, 5);
    appendTurn(s.callId, { role: "user", content: "It says eight" });
    appendTurn(s.callId, { role: "user", content: "thirty two AM." });
    appendTurn(s.callId, { role: "assistant", content: "What did you notice about her speech or behavior?" });
    appendTurn(s.callId, { role: "user", content: "She sounded completely normal and we talked about lunch." });
    appendTurn(s.callId, { role: "assistant", content: composeReadback(CANONICAL) });
    appendTurn(s.callId, { role: "user", content: "Yes, that's correct." });
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(true);
  });

  it("accepts phone-ASR digit forms — the witness says '8 32 PM' after checking", () => {
    const s = activeSession();
    s.transcript = s.transcript.slice(0, 5);
    appendTurn(s.callId, { role: "user", content: "Yes. This is 8 32 AM confirmed." });
    appendTurn(s.callId, { role: "assistant", content: "During that call, what did you notice?" });
    appendTurn(s.callId, { role: "user", content: "She sounded completely normal and we talked about lunch." });
    appendTurn(s.callId, { role: "assistant", content: composeReadback(CANONICAL) });
    appendTurn(s.callId, { role: "user", content: "That's correct." });
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(true);
  });

  it("rejects when no spoken read-back turn exists in the transcript", () => {
    const s = activeSession();
    s.transcript = s.transcript.slice(0, 8);
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("readback-not-observed");
  });

  it("rejects when the transfer gates are not all set", () => {
    const s = activeSession();
    s.gates.aiParticipationAgreed = false;
    const out = validateClaim(CANONICAL, s);
    expect(out.ok).toBe(false);
    expect(out.result.reason).toBe("transfer-gates-not-satisfied");
  });

  it("parses exact times and renders spoken variants", () => {
    const t = parseExactTime("2026-08-01T08:32:00-07:00");
    expect(t?.spokenClock).toBe("8:32");
    expect(t?.daySegment).toBe("morning");
    expect(parseExactTime("2026-08-01T08:32:00")).toBeNull();
    expect(parseExactTime("late morning")).toBeNull();
  });
});
