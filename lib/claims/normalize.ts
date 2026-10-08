/**
 * Deterministic normalization + read-back composition for claim payloads.
 * The server, not the language model, owns these rules (§32.5).
 */
import type { ClaimPayload } from "./schema";

/** Exact times must carry full date + time + explicit timezone offset (§10.3). */
const EXACT_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;

export interface NormalizedTime {
  iso: string;
  hour24: number;
  minute: number;
  /** How the time is spoken: "8:32". */
  spokenClock: string;
  /** "morning" | "afternoon" | "evening" — read-back must state it (§14.3 rule 8). */
  daySegment: "morning" | "afternoon" | "evening";
  /** Written variants that count as this time appearing in a transcript turn. */
  transcriptVariants: string[];
  /** Word-form variants ("eight thirty two") — ASR often writes numbers out. */
  wordVariants: string[];
}

const ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const TENS = ["","", "twenty","thirty","forty","fifty"];

function numberWords(n: number): string[] {
  if (n < 20) return [ONES[n]];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o === 0 ? [t] : [`${t} ${ONES[o]}`, `${t}${ONES[o]}`];
}

export function parseExactTime(time: string): NormalizedTime | null {
  const m = EXACT_TIME_RE.exec(time);
  if (!m) return null;
  const hour24 = Number(m[4]);
  const minute = Number(m[5]);
  if (hour24 > 23 || minute > 59) return null;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const mm = String(minute).padStart(2, "0");
  const spokenClock = `${hour12}:${mm}`;
  const wordVariants: string[] = [];
  for (const h of numberWords(hour12)) {
    if (minute === 0) {
      wordVariants.push(`${h} o clock`, `${h} oclock`, h);
    } else if (minute < 10) {
      for (const m of numberWords(minute)) wordVariants.push(`${h} o ${m}`, `${h} oh ${m}`, `${h} ${mm}`);
    } else {
      for (const m of numberWords(minute)) wordVariants.push(`${h} ${m}`);
    }
  }
  const daySegment = hour24 < 12 ? "morning" : hour24 < 18 ? "afternoon" : "evening";
  const meridiem = hour24 < 12 ? "AM" : "PM";
  return {
    iso: time,
    hour24,
    minute,
    spokenClock,
    daySegment,
    transcriptVariants: [
      spokenClock,
      `${String(hour24).padStart(2, "0")}:${mm}`,
      `${spokenClock} ${meridiem}`,
      `${spokenClock} ${meridiem.toLowerCase()}`,
      `${spokenClock}${meridiem.toLowerCase()}`,
      `${spokenClock} ${meridiem[0].toLowerCase()}.${meridiem[1].toLowerCase()}.`,
      // Phone ASR digit forms: "8 32", "832", "8 3 2", and 24h "20 32".
      `${hour12} ${mm}`,
      `${hour12}${mm}`,
      `${hour12} ${mm[0]} ${mm[1]}`,
      `${hour24} ${mm}`,
      `${hour24}${mm}`,
    ],
    wordVariants,
  };
}

const ANCHOR_SPOKEN: Record<string, string> = {
  "phone-call-log": "your phone's call log",
  "text-timestamp": "the message timestamp",
  "video-call-log": "the video call log",
  "calendar-entry": "your calendar",
  receipt: "the receipt",
  camera: "the camera record",
  "television-program": "the television schedule",
  none: "memory",
};

const INTERACTION_SPOKEN: Record<string, string> = {
  "in-person": "in person",
  phone: "by phone",
  video: "by video call",
  text: "by text message",
  other: "",
};

/**
 * The canonical read-back sentence for a claim. The agent is instructed to
 * speak exactly this composition; the validator checks the load-bearing parts
 * of it appeared in an assistant transcript turn before the function call.
 */
export function composeReadback(claim: ClaimPayload): string {
  const t = parseExactTime(claim.time);
  const clock = t ? `at ${t.spokenClock} this ${t.daySegment}` : `around the time you described`;
  const how = INTERACTION_SPOKEN[claim.interaction] ?? "";
  const domains = claim.observedDomains.join(" and ");
  const anchor =
    claim.anchor.type === "none" ? "" : `, and the time comes from ${ANCHOR_SPOKEN[claim.anchor.type]}`;
  const observations: Record<ClaimPayload["eventType"], string> = {
    "last-known-baseline": `you personally observed normal ${domains}`,
    "last-contact": `you personally observed her ${domains}`,
    "symptom-discovery": `you found the patient with symptoms already present, affecting ${domains}`,
    "witnessed-onset": `you personally witnessed symptoms begin, affecting ${domains}`,
    "hearsay-report": `you were told about her ${domains}, but did not observe it yourself`,
  };
  const observed = claim.directness === "direct" ? observations[claim.eventType]
    : `you were told about her ${domains}, but did not observe it yourself`;
  const account = claim.eventType === "symptom-discovery" || claim.eventType === "witnessed-onset"
    ? `${observed} ${how} ${clock}`
    : `you spoke with the patient ${how} ${clock}, ${observed}`;
  return `To confirm: ${account}${anchor}. Is that correct?`;
}

/** Stable idempotency key derived from the load-bearing identity of a claim (§16). */
export function idempotencyKey(claim: ClaimPayload): string {
  return [claim.encounterId, claim.callId, claim.sourceId, claim.eventType, claim.timeKind, claim.time]
    .join("|")
    .toLowerCase();
}
