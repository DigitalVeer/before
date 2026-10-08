/** Synthetic, local presentation. Uses the production validator; never writes FHIR. */
import type { TimelinePayload, EventView } from "../../app/clinician/screen";
import type { ClaimPayload } from "../claims/schema";
import { composeReadback, parseExactTime } from "../claims/normalize";
import { validateClaim } from "../claims/validate";
import type { InterviewSession, TranscriptTurn } from "../session/store";
import { computeInterval } from "../timeline/interval";
import audio from "./audio-cues.json";

export const AUDIO_CUES = audio.cues;
export const CONFIRMED_AT = AUDIO_CUES[7].end + 0.2;
export const PARALLEL_REVEAL_AT = CONFIRMED_AT + 4;
export const FULL_CHART_AT = PARALLEL_REVEAL_AT + 4;

export const CHAPTERS = [
  { title: "The missing history", short: "The case", at: 0, description: "Rosa cannot speak. The chart holds a secondhand baseline and a discovery time. Neither tells the full story." },
  { title: "A memory is a starting point", short: "Interview", at: AUDIO_CUES[0].start, description: "Luis remembers a normal conversation around eight-thirty. The assistant keeps that recollection out of the structured timeline." },
  { title: "Turn memory into evidence", short: "Anchor", at: AUDIO_CUES[2].start, description: "The assistant asks Luis to check his call log. The exact time comes from the witness’s own words: 8:32 AM." },
  { title: "Read it back. Wait for yes.", short: "Read-back", at: AUDIO_CUES[6].start, description: "The whole claim is read back aloud. An exact time still cannot be filed until the witness explicitly confirms it." },
  { title: "The evidence lands", short: "Confirmed", at: CONFIRMED_AT, description: "Only after confirmation does the claim pass validation. The timeline gains a direct baseline and a 38-minute interval." },
  { title: "Five calls. One chart.", short: "Parallel", at: PARALLEL_REVEAL_AT, description: "Pull back to reveal four more agents gathering independent accounts. Their validated evidence arrives in one shared chart." },
  { title: "Every account keeps its source", short: "Full chart", at: FULL_CHART_AT, description: "Five sources are linked to their own transcripts. A later direct baseline and earlier discovery bound a 22-minute interval; a text contact adds context without establishing normality." },
] as const;

export const DEMO_DURATION = audio.duration;
export const DEMO_SECONDS = Math.ceil(DEMO_DURATION);

export function demoMoment(seconds: number) {
  const currentTurn = AUDIO_CUES.reduce((index, cue) => seconds >= cue.start ? cue.turn : index, -1);
  return {
    currentTurn,
    speaking: currentTurn >= 0 && seconds < AUDIO_CUES[currentTurn].end,
    anchored: seconds >= AUDIO_CUES[3].end,
    direct: seconds >= AUDIO_CUES[5].end,
    confirmed: seconds >= CONFIRMED_AT,
    parallel: seconds >= PARALLEL_REVEAL_AT,
  };
}
const DATE = "2026-08-01";
const time = (clock: string) => `${DATE}T${clock}:00-07:00`;

export const SPOUSE_CLAIM: ClaimPayload = {
  encounterId: "stroke-code-001", patientId: "temporary-rosa", callId: "call-spouse-01",
  sourceId: "RelatedPerson/spouse", sourceRole: "spouse", eventType: "last-known-baseline",
  timeKind: "exact", time: time("08:32"), interaction: "phone", directness: "direct",
  observedDomains: ["speech", "behavior"],
  anchor: { type: "phone-call-log", description: "Witness checked recent calls during interview" },
  quote: "She sounded completely normal and we talked about lunch.",
  confirmation: { method: "spoken-readback", confirmed: true },
};

export const DAUGHTER_CLAIM: ClaimPayload = {
  ...SPOUSE_CLAIM, callId: "call-daughter-01", sourceId: "RelatedPerson/daughter", sourceRole: "daughter",
  eventType: "symptom-discovery", time: time("09:08"), interaction: "in-person",
  observedDomains: ["speech", "movement"],
  anchor: { type: "phone-call-log", description: "Ana checked her outgoing call to Luis" },
  quote: "Her face was drooping and her words came out all wrong.",
};

type Turn = Pick<TranscriptTurn, "role" | "content">;
export const SPOUSE_TURNS: Turn[] = [
  { role: "assistant", content: "When did you last personally speak with Rosa when she seemed her usual self?" },
  { role: "user", content: "This morning, around eight-thirty." },
  { role: "assistant", content: "Can you check your recent calls for the exact time?" },
  { role: "user", content: "One second. It was 8:32 AM." },
  { role: "assistant", content: "During that call, what did you notice about her speech or behavior?" },
  { role: "user", content: SPOUSE_CLAIM.quote },
  { role: "assistant", content: composeReadback(SPOUSE_CLAIM) },
  { role: "user", content: "Yes, that's correct." },
];
const DAUGHTER_TURNS: Turn[] = [
  { role: "assistant", content: "Did you see when the symptoms began, or find Rosa with them already there?" },
  { role: "user", content: "I found her on the couch. Her face was drooping and her words came out all wrong. I didn't see it start." },
  { role: "assistant", content: "Could you check your recent calls for the exact time?" },
  { role: "user", content: "I called my dad right after I found her. That call says 9:08 AM." },
  { role: "assistant", content: composeReadback(DAUGHTER_CLAIM) },
  { role: "user", content: "Yes, that's correct." },
];

export type DemoWitnessKey = "spouse" | "daughter" | "neighbor" | "colleague" | "paramedic";
type Witness = {
  key: DemoWitnessKey; id: string; name: string; role: string; claim: ClaimPayload;
  turns: Turn[]; filedAt: number; finding: string;
};

const NEIGHBOR_CLAIM: ClaimPayload = {
  ...SPOUSE_CLAIM, callId: "call-neighbor-01", sourceId: "RelatedPerson/neighbor", sourceRole: "neighbor",
  time: time("08:46"), interaction: "in-person", observedDomains: ["speech", "movement"],
  anchor: { type: "camera", description: "Marisol checked the building camera timestamp" },
  quote: "She was speaking clearly and walking normally when I saw her in the hallway.",
};
const COLLEAGUE_CLAIM: ClaimPayload = {
  ...SPOUSE_CLAIM, callId: "call-colleague-01", sourceId: "RelatedPerson/colleague", sourceRole: "colleague",
  eventType: "last-contact", time: time("09:02"), interaction: "text", observedDomains: ["behavior"],
  anchor: { type: "text-timestamp", description: "Tomas checked Rosa’s message timestamp" },
  quote: "She replied that she would join our meeting later. I only saw her text, not her speech or movement.",
};
const PARAMEDIC_CLAIM: ClaimPayload = {
  ...SPOUSE_CLAIM, callId: "call-paramedic-01", sourceId: "RelatedPerson/paramedic", sourceRole: "paramedic",
  eventType: "symptom-discovery", time: time("09:14"), interaction: "in-person", observedDomains: ["speech"],
  anchor: { type: "phone-call-log", description: "Jules checked the call made to the receiving nurse on arrival" },
  quote: "Her speech was slurred when we arrived. The symptoms were already there.",
};
function scriptedTurns(claim: ClaimPayload, question: string, anchorQuestion: string, anchorReply: string): Turn[] {
  return [
    { role: "assistant", content: question }, { role: "user", content: claim.quote },
    { role: "assistant", content: anchorQuestion }, { role: "user", content: anchorReply },
    { role: "assistant", content: composeReadback(claim) }, { role: "user", content: "Yes, that's correct." },
  ];
}

export const DEMO_WITNESSES: Witness[] = [
  { key: "spouse", id: "demo-spouse", name: "Luis M.", role: "Husband", claim: SPOUSE_CLAIM, turns: SPOUSE_TURNS,
    filedAt: CONFIRMED_AT, finding: "Normal speech, talked about lunch" },
  { key: "daughter", id: "demo-daughter", name: "Ana M.", role: "Daughter", claim: DAUGHTER_CLAIM, turns: DAUGHTER_TURNS,
    filedAt: PARALLEL_REVEAL_AT + 0.6, finding: "Found Rosa with symptoms" },
  { key: "neighbor", id: "demo-neighbor", name: "Marisol R.", role: "Neighbor", claim: NEIGHBOR_CLAIM,
    turns: scriptedTurns(NEIGHBOR_CLAIM, "Did you personally see Rosa before she became unwell?",
      "Can you check the building camera record for the exact time?", "The camera timestamp says 8:46 AM."),
    filedAt: PARALLEL_REVEAL_AT + 1.5, finding: "Speech and walking normal" },
  { key: "colleague", id: "demo-colleague", name: "Tomas V.", role: "Colleague", claim: COLLEAGUE_CLAIM,
    turns: scriptedTurns(COLLEAGUE_CLAIM, "What contact did you personally have with Rosa this morning?",
      "Can you check the exact message timestamp?", "Her message says 9:02 AM."),
    filedAt: PARALLEL_REVEAL_AT + 2.5, finding: "Text contact, baseline unknown" },
  { key: "paramedic", id: "demo-paramedic", name: "Jules K.", role: "Paramedic", claim: PARAMEDIC_CLAIM,
    turns: scriptedTurns(PARAMEDIC_CLAIM, "What did you observe when you arrived?",
      "Can you check your recent calls to anchor the arrival time?", "I called the receiving nurse when we arrived. My call log says 9:14 AM."),
    filedAt: PARALLEL_REVEAL_AT + 3.5, finding: "Slurred speech on arrival" },
];
export function witnessClock(witness: Witness): string { return parseExactTime(witness.claim.time)!.spokenClock; }
export function witnessForEvent(id: string): Witness | undefined { return DEMO_WITNESSES.find((witness) => witness.id === id); }
export function witnessesAt(seconds: number): Witness[] { return DEMO_WITNESSES.filter((witness) => seconds >= witness.filedAt); }

export function demoSession(key: DemoWitnessKey, turnCount?: number): InterviewSession {
  const witness = DEMO_WITNESSES.find((item) => item.key === key)!;
  const { claim, turns } = witness;
  return {
    callId: claim.callId, encounterId: claim.encounterId, patientId: claim.patientId,
    sourceId: claim.sourceId, sourceRole: claim.sourceRole, witnessName: witness.name,
    brief: "Synthetic walkthrough: ask for personally observed history, check a time anchor, and confirm the full read-back.",
    status: "interviewing", gates: { disclosureBasisRecorded: true, recipientVerified: true, aiParticipationAgreed: true },
    transcript: turns.slice(0, turnCount).map((turn, i) => ({ ...turn, turnId: `${turn.role}-turn-${String(i + 1).padStart(2, "0")}`, at: time("12:30") })),
    recorded: {}, startedAt: time("12:30"),
  };
}

const INITIAL_EVENTS: EventView[] = [
  { id: "demo-relayed-baseline", eventType: "last-known-baseline", timeIso: time("06:00"), label: "Relayed baseline",
    sourceLine: "Daughter via EMS", noteText: "Last seen normal at 06:00; direct source not established.",
    flags: ["unanchored-time"], direct: false, anchored: false, confirmed: false, preliminary: true, acceptedBy: null, receipts: null, evidence: null },
  { id: "demo-relayed-discovery", eventType: "symptom-discovery", timeIso: time("09:10"), label: "Symptoms discovered",
    sourceLine: "EMS handoff", noteText: "Found with symptoms, reported as onset in the handoff.",
    flags: ["onset-unwitnessed"], direct: false, anchored: false, confirmed: false, preliminary: true, acceptedBy: null, receipts: null, evidence: null },
];

function confirmedEvent(witness: Witness, accepted: boolean): EventView {
  const { claim } = witness;
  const session = demoSession(witness.key);
  const outcome = validateClaim(claim, session);
  if (!outcome.ok || !outcome.evidence) throw new Error(`Demo claim rejected: ${outcome.result.reason}`);
  return {
    id: witness.id, eventType: claim.eventType, timeIso: claim.time, label: claim.eventType,
    sourceLine: `${witness.name} (${witness.role.toLowerCase()})`, noteText: claim.quote, flags: [],
    direct: true, anchored: true, confirmed: true, preliminary: true,
    acceptedBy: accepted ? "Dr. Priya Nair (demo)" : null,
    receipts: { sourceLinked: true, witnessConfirmed: true, preliminary: true, decisionPending: !accepted },
    evidence: { quote: claim.quote, anchorDescription: claim.anchor.description, fieldEvidence: outcome.evidence,
      observationId: `Observation/${witness.id}`, questionnaireResponseId: `QuestionnaireResponse/${witness.id}`,
      transcriptReference: `DocumentReference/${witness.id}` },
  };
}

export function demoPayloadAt(seconds: number, acceptedIds: string[] = []) {
  const events = [...INITIAL_EVENTS, ...witnessesAt(seconds).map((witness) => confirmedEvent(witness, acceptedIds.includes(witness.id)))];
  events.sort((a, b) => (a.timeIso ?? "").localeCompare(b.timeIso ?? ""));
  const reviewTasks = events.filter((event) => event.evidence).map((event) => ({
    id: `demo-review-${event.id}`, status: event.acceptedBy ? "completed" : "requested",
    description: "Review witness-confirmed time evidence", focusObservation: event.evidence!.observationId,
  }));
  return { timeline: { events,
    interval: computeInterval(events), reviewTasks, reviewTask: reviewTasks[0] ?? null,
    acceptedObservationId: acceptedIds[0] ?? null }, calls: [] } satisfies TimelinePayload;
}

export function chapterAt(seconds: number): number {
  return CHAPTERS.reduce((current, chapter, index) => seconds >= chapter.at ? index : current, 0);
}
