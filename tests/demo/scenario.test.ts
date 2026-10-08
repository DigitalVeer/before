import { describe, expect, it } from "vitest";
import { demoPayloadAt, CHAPTERS, CONFIRMED_AT, PARALLEL_REVEAL_AT, FULL_CHART_AT, DEMO_WITNESSES, demoSession, SPOUSE_CLAIM, DAUGHTER_CLAIM, chapterAt, demoMoment, DEMO_DURATION, AUDIO_CUES, SPOUSE_TURNS } from "../../lib/demo/scenario";
import { createHash } from "node:crypto";
import audio from "../../lib/demo/audio-cues.json";
import { validateClaim } from "../../lib/claims/validate";

describe("showcase evidence boundaries", () => {
  it("keeps the timeline unresolved through the read-back, before the witness says yes", () => {
    const data = demoPayloadAt(CHAPTERS[3].at);
    expect(data.timeline.interval).toBeNull();
    expect(data.timeline.events.every((event) => event.evidence === null)).toBe(true);
    expect(validateClaim(SPOUSE_CLAIM, demoSession("spouse", 7)).ok).toBe(false);
  });
  it("validates both fixtures through the production evidence gates", () => {
    expect(validateClaim(SPOUSE_CLAIM, demoSession("spouse")).ok).toBe(true);
    expect(validateClaim(DAUGHTER_CLAIM, demoSession("daughter")).ok).toBe(true);
    expect(demoPayloadAt(CONFIRMED_AT).timeline.interval?.minutes).toBe(38);
    expect(demoPayloadAt(DEMO_WITNESSES[1].filedAt).timeline.interval?.minutes).toBe(36);
  });
  it("rejects unsupported precision and missing anchors in the interactive proof", () => {
    const session = demoSession("spouse");
    expect(validateClaim({ ...SPOUSE_CLAIM, time: SPOUSE_CLAIM.time.replace("08:32", "08:30") }, session).ok).toBe(false);
    expect(validateClaim({ ...SPOUSE_CLAIM, anchor: { type: "none", description: "memory" } }, session).result.reason).toBe("exact-time-missing-anchor");
  });
  it("preserves preliminary evidence when a simulated clinician reviews it", () => {
    const baseline = demoPayloadAt(FULL_CHART_AT, ["demo-spouse"]).timeline.events.find((event) => event.id === "demo-spouse")!;
    expect(baseline.preliminary).toBe(true);
    expect(baseline.receipts?.decisionPending).toBe(false);
    expect(baseline.acceptedBy).toContain("demo");
    expect(demoPayloadAt(0).timeline.reviewTasks).toEqual([]);
    expect(chapterAt(0)).toBe(0);
    expect(chapterAt(DEMO_DURATION)).toBe(CHAPTERS.length - 1);
  });
  it("holds evidence until the recorded confirmation has finished speaking", () => {
    const beforeYes = AUDIO_CUES[7].end - 0.01;
    expect(demoMoment(beforeYes).confirmed).toBe(false);
    expect(demoPayloadAt(beforeYes).timeline.interval).toBeNull();
    const afterYes = AUDIO_CUES[7].end + 0.21;
    expect(demoMoment(afterYes).confirmed).toBe(true);
    expect(demoPayloadAt(afterYes).timeline.interval?.minutes).toBe(38);
    expect(demoMoment(AUDIO_CUES[3].end - 0.01).anchored).toBe(false);
    expect(demoMoment(AUDIO_CUES[3].end).anchored).toBe(true);
  });
  it("keeps the bundled recording and captions attached to the same script", () => {
    expect(createHash("sha256").update(JSON.stringify(SPOUSE_TURNS)).digest("hex")).toBe(audio.scriptSha256);
    expect(AUDIO_CUES).toHaveLength(SPOUSE_TURNS.length);
    AUDIO_CUES.forEach((cue, index) => {
      expect(cue.turn).toBe(index);
      expect(cue.end).toBeGreaterThan(cue.start);
      if (index) expect(cue.start).toBeGreaterThan(AUDIO_CUES[index - 1].end);
    });
    expect(DEMO_DURATION).toBeGreaterThan(FULL_CHART_AT + 1);
  });
  it("uses independent, validated transcripts for all five parallel sources", () => {
    expect(DEMO_WITNESSES).toHaveLength(5);
    expect(new Set(DEMO_WITNESSES.map((witness) => witness.claim.callId)).size).toBe(5);
    for (const witness of DEMO_WITNESSES) {
      const session = demoSession(witness.key);
      const result = validateClaim(witness.claim, session);
      expect(result.ok, witness.name).toBe(true);
      expect(result.evidence?.find((field) => field.field === "anchor")?.quote).toContain(witness.claim.time.slice(11, 16).replace(/^0/, ""));
      expect(validateClaim(witness.claim, demoSession(witness.key, witness.turns.length - 1)).ok).toBe(false);
    }
    expect(validateClaim(DEMO_WITNESSES[2].claim, demoSession("daughter")).result.reason).toBe("wrong-patient-or-encounter");
  });
  it("adds each result at its arrival boundary, then combines the later baseline and earlier discovery", () => {
    expect(demoPayloadAt(PARALLEL_REVEAL_AT).timeline.interval?.minutes).toBe(38);
    const expectedMinutes = [38, 36, 22, 22, 22];
    DEMO_WITNESSES.forEach((witness, index) => {
      expect(demoPayloadAt(witness.filedAt - 0.001).timeline.events.find((event) => event.id === witness.id)).toBeUndefined();
      const data = demoPayloadAt(witness.filedAt);
      expect(data.timeline.events.filter((event) => event.evidence)).toHaveLength(index + 1);
      expect(data.timeline.interval?.minutes).toBe(expectedMinutes[index]);
    });
    const final = demoPayloadAt(FULL_CHART_AT);
    expect(final.timeline.interval?.startId).toBe("demo-neighbor");
    expect(final.timeline.interval?.endId).toBe("demo-daughter");
    expect(final.timeline.events.find((event) => event.id === "demo-colleague")?.eventType).toBe("last-contact");
    expect(final.timeline.events.every((event) => event.preliminary)).toBe(true);
  });
  it("reveals quoted observations without letting drafts establish a chart baseline", () => {
    expect(demoMoment(AUDIO_CUES[5].end - 0.001).direct).toBe(false);
    expect(demoMoment(AUDIO_CUES[5].end).direct).toBe(true);
    expect(demoPayloadAt(AUDIO_CUES[5].end).timeline.interval).toBeNull();
    expect(demoMoment(PARALLEL_REVEAL_AT - 0.001).parallel).toBe(false);
    expect(demoMoment(PARALLEL_REVEAL_AT).parallel).toBe(true);
    expect(demoPayloadAt(CHAPTERS[2].at).timeline.events.filter((event) => event.evidence)).toHaveLength(0);
  });
});
