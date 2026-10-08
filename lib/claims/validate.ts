/**
 * Deterministic server-side claim validation (§10.3, §32.5).
 * The language model is not trusted to enforce these invariants.
 */
import { claimPayloadSchema, type ClaimPayload, type ClaimResult } from "./schema";
import { idempotencyKey, parseExactTime } from "./normalize";
import { allGatesSet, type InterviewSession, type TranscriptTurn } from "../session/store";

export interface ValidationOutcome {
  ok: boolean;
  claim?: ClaimPayload;
  /** Set when a duplicate replay should return the original resources (§16). */
  duplicateOf?: NonNullable<ClaimResult["resourceIds"]>;
  idempotencyKey?: string;
  /** Transcript turns that evidence the load-bearing fields (§13.5). */
  evidence?: FieldEvidence[];
  result: ClaimResult;
}

export interface FieldEvidence {
  field: "time" | "eventType" | "directness" | "observedDomains" | "anchor" | "confirmation";
  turnId: string;
  quote: string;
}

function reject(reason: string, nextAction: string): ValidationOutcome {
  return { ok: false, result: { accepted: false, reason, nextAction } };
}

const AFFIRMATIVE_RE = /\b(yes|yeah|yep|correct|right|exactly|that's right|that is right)\b/i;
const NEGATIVE_RE = /\b(no\b|not correct|wrong|that's not|actually)\b/i;

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Find the spoken read-back and the witness affirmation that follows it.
 * Live voice splits one read-back across several ConversationText turns, and
 * a real witness may interject briefly mid-read-back — so the window is the
 * ASSISTANT turns within the last twelve turns before an affirmative user
 * turn (user interjections between them are tolerated). The gate still
 * requires: the assistant turn directly before the yes asks for
 * confirmation, and the assistant spoke the exact time and day segment
 * within the window. The model cannot satisfy this by inference; only a
 * spoken read-back observed by the server can.
 */
function findReadbackEvidence(
  transcript: TranscriptTurn[],
  claim: ClaimPayload
): { readback: TranscriptTurn; affirmation: TranscriptTurn } | null {
  const t = parseExactTime(claim.time);
  if (!t) return null;
  const variants = t.transcriptVariants.map(normalizeText);
  const segmentTokens = [t.daySegment, t.hour24 < 12 ? "am" : "pm"];
  const MAX_READBACK_TURNS = 8;

  for (let i = transcript.length - 1; i >= 0; i--) {
    const affirmation = transcript[i];
    if (affirmation.role !== "user") continue;
    if (!AFFIRMATIVE_RE.test(affirmation.content) || NEGATIVE_RE.test(affirmation.content)) continue;

    const prev = transcript[i - 1];
    if (!prev || prev.role !== "assistant" || !/confirm|correct/i.test(prev.content)) continue;

    // The read-back window is anchored by the agent's mandated opener phrase
    // ("Let me read that back" / "To confirm:", prompt rule 7). If an opener
    // exists within the last few turns, the window runs opener → yes and
    // witness interjections inside it are tolerated. Without an opener, only
    // the CONTIGUOUS assistant run before the yes counts. Either way, a time
    // mentioned earlier in conversation does not satisfy the gate — it must
    // be spoken inside this final read-back.
    const OPENER_RE = /read (that |it |this )?back|to confirm|let me confirm|make sure i have/i;
    let openerIdx = -1;
    for (let j = i - 1, scanned = 0; j >= 0 && scanned < MAX_READBACK_TURNS; j--) {
      if (transcript[j].role !== "assistant") continue;
      scanned += 1;
      if (OPENER_RE.test(transcript[j].content)) {
        openerIdx = j;
        break;
      }
    }
    const windowTurns: TranscriptTurn[] = [];
    if (openerIdx >= 0) {
      for (let j = openerIdx; j < i; j++) {
        if (transcript[j].role === "assistant") windowTurns.push(transcript[j]);
      }
    } else {
      for (let j = i - 1; j >= 0 && transcript[j].role === "assistant"; j--) {
        windowTurns.unshift(transcript[j]);
      }
    }
    const window = normalizeText(windowTurns.map((r) => r.content).join(" "));
    const hasTime = variants.some((v) => window.includes(v));
    const hasSegment = segmentTokens.some((s) => window.includes(s));
    if (hasTime && hasSegment) {
      const timeTurn =
        windowTurns.find((r) => variants.some((v) => normalizeText(r.content).includes(v))) ?? prev;
      return { readback: timeTurn, affirmation };
    }
  }
  return null;
}

/**
 * The witness turn that contains the claimed quote. Live ASR splits one
 * utterance across consecutive turns, so each CONTIGUOUS run of user turns is
 * also evaluated as one utterance (verbatim substring or ≥70% token overlap).
 * Returns the first turn of the matching run for the evidence link.
 */
function findQuoteTurn(transcript: TranscriptTurn[], quote: string): TranscriptTurn | null {
  const q = normalizeText(quote);
  const qTokens = q.split(" ").filter(Boolean);

  const runs: TranscriptTurn[][] = [];
  for (const turn of transcript) {
    if (turn.role !== "user") continue;
    const prev = runs[runs.length - 1];
    const prevIdx = prev ? transcript.indexOf(prev[prev.length - 1]) : -2;
    if (prev && transcript.slice(prevIdx + 1, transcript.indexOf(turn)).every((t) => t.role === "user")) {
      prev.push(turn);
    } else {
      runs.push([turn]);
    }
  }

  let best: { turn: TranscriptTurn; score: number } | null = null;
  for (const run of runs) {
    const text = normalizeText(run.map((t) => t.content).join(" "));
    if (text.includes(q)) return run[0];
    const tTokens = new Set(text.split(" "));
    const overlap = qTokens.filter((tok) => tTokens.has(tok)).length / Math.max(qTokens.length, 1);
    if (!best || overlap > best.score) best = { turn: run[0], score: overlap };
  }
  return best && best.score >= 0.7 ? best.turn : null;
}

/** The witness turn that mentions the anchor being checked. */
function findAnchorTurn(transcript: TranscriptTurn[], claim: ClaimPayload): TranscriptTurn | null {
  const t = parseExactTime(claim.time);
  const anchorWords = ["call", "log", "phone", "checked", "text", "calendar", "message"];
  for (let i = transcript.length - 1; i >= 0; i--) {
    const turn = transcript[i];
    if (turn.role !== "user") continue;
    const text = normalizeText(turn.content);
    const hasTime = t ? t.transcriptVariants.some((v) => text.includes(normalizeText(v))) : false;
    if (hasTime) return turn;
    if (anchorWords.some((w) => text.includes(w))) return turn;
  }
  return null;
}

export function validateClaim(
  rawPayload: unknown,
  session: InterviewSession | undefined
): ValidationOutcome {
  const parsed = claimPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return reject(
      "malformed-payload",
      `The claim payload is invalid (${issue?.path?.join(".")}: ${issue?.message}). Re-ask the missing detail and rebuild the claim.`
    );
  }
  const claim = parsed.data;

  if (!session) {
    return reject("unknown-call-session", "No active interview session matches this call. Hand back to the coordinator.");
  }
  if (session.status === "refused" || session.status === "cancelled") {
    return reject(
      "call-refused-or-cancelled",
      "The witness withdrew or the call was cancelled. Do not file evidence; hand back to the coordinator."
    );
  }
  if (session.status !== "interviewing") {
    return reject("session-not-active", "The interview has not started or is already complete.");
  }
  if (!allGatesSet(session.gates)) {
    return reject(
      "transfer-gates-not-satisfied",
      "Outreach basis, recipient verification, and AI participation must all be recorded before evidence can be filed."
    );
  }
  if (
    claim.encounterId !== session.encounterId ||
    claim.patientId !== session.patientId ||
    claim.callId !== session.callId ||
    claim.sourceId !== session.sourceId
  ) {
    return reject(
      "wrong-patient-or-encounter",
      "The claim identifiers do not match the active interview session. Do not write; confirm the session context."
    );
  }
  if (!claim.confirmation.confirmed || claim.confirmation.method !== "spoken-readback") {
    return reject(
      "exact-time-not-confirmed",
      "Read back the full source, time, modality, and observed baseline, and get an explicit yes before recording."
    );
  }
  if (claim.timeKind !== "exact") {
    return reject(
      "non-exact-time-on-confirmed-claim",
      "recordWitnessConfirmedClaim accepts only exact, anchored times. Use recordUnresolvedClaim for approximate or unknown times."
    );
  }
  const t = parseExactTime(claim.time);
  if (!t) {
    return reject(
      "exact-time-missing-date-or-timezone",
      "An exact time needs a full date and timezone offset (e.g. 2026-08-01T08:32:00-07:00). Confirm the date and rebuild the claim."
    );
  }
  if (claim.anchor.type === "none") {
    return reject(
      "exact-time-missing-anchor",
      "An exact time needs a checkable anchor. Ask the witness to check their call log, messages, or calendar; otherwise record the time as approximate."
    );
  }

  // The exact time must ORIGINATE from the witness's record read-out — not
  // from earlier approximate talk ("around eight-thirty") and never from the
  // agent's own mouth. Origin evidence is a witness run AFTER the agent asked
  // them to check a record, or a witness run that itself cites the record
  // ("it says…", "my call log shows…"). Tolerant of ASR splitting the number
  // across consecutive turns and of digits-vs-words. This is the gate that
  // catches a read-back drifting from the witness's 8:32 to a filed 8:30.
  {
    const ANCHOR_ASK_RE = /check|record|log|calendar|text message|recent calls|call history/i;
    const RECORD_CITE_RE = /it says|says|log shows|shows|reads|according to/i;
    const firstAskIdx = session.transcript.findIndex(
      (turn) => turn.role === "assistant" && ANCHOR_ASK_RE.test(turn.content)
    );

    const originRuns: string[] = [];
    let current: string[] = [];
    let runStart = -1;
    const flush = () => {
      if (current.length === 0) return;
      const text = normalizeText(current.join(" "));
      const afterAsk = firstAskIdx >= 0 && runStart > firstAskIdx;
      if (afterAsk || RECORD_CITE_RE.test(current.join(" "))) originRuns.push(text);
      current = [];
      runStart = -1;
    };
    session.transcript.forEach((turn, idx) => {
      if (turn.role === "user") {
        if (current.length === 0) runStart = idx;
        current.push(turn.content);
      } else {
        flush();
      }
    });
    flush();

    const spoken = [...t.transcriptVariants, ...t.wordVariants].map(normalizeText);
    const witnessReadItOut = originRuns.some((text) => spoken.some((s) => text.includes(s)));
    if (!witnessReadItOut) {
      return reject(
        "time-not-spoken-by-witness",
        "The witness has not read this exact time from their record. Ask them to check the record again, and use exactly the time they say."
      );
    }
  }

  const key = idempotencyKey(claim);
  const existing = session.recorded[key];
  if (existing) {
    return {
      ok: true,
      claim,
      duplicateOf: existing,
      idempotencyKey: key,
      result: {
        accepted: true,
        reason: "duplicate-idempotency-key-returned-existing",
        resourceIds: existing,
      },
    };
  }

  const readback = findReadbackEvidence(session.transcript, claim);
  if (!readback) {
    return reject(
      "readback-not-observed",
      "No spoken read-back of this exact time followed by the witness's yes was observed in the transcript. Read the complete claim back and wait for confirmation."
    );
  }
  const quoteTurn = findQuoteTurn(session.transcript, claim.quote);
  if (!quoteTurn) {
    return reject(
      "quote-not-in-transcript",
      "The supporting quote does not match anything the witness said. Quote the witness verbatim."
    );
  }
  const anchorTurn = findAnchorTurn(session.transcript, claim) ?? quoteTurn;

  const evidence: FieldEvidence[] = [
    { field: "time", turnId: anchorTurn.turnId, quote: anchorTurn.content },
    { field: "eventType", turnId: quoteTurn.turnId, quote: quoteTurn.content },
    { field: "directness", turnId: quoteTurn.turnId, quote: quoteTurn.content },
    { field: "observedDomains", turnId: quoteTurn.turnId, quote: quoteTurn.content },
    { field: "anchor", turnId: anchorTurn.turnId, quote: anchorTurn.content },
    { field: "confirmation", turnId: readback.affirmation.turnId, quote: readback.affirmation.content },
  ];

  return {
    ok: true,
    claim,
    idempotencyKey: key,
    evidence,
    result: { accepted: true },
  };
}
