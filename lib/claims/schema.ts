/**
 * FROZEN TEAM INTERFACE — BEFORE-DESIGN.md §10.2, field names verbatim.
 *
 * This is the payload the Deepgram voice agent sends to
 * `recordWitnessConfirmedClaim`. Any change to this schema requires explicit
 * human sign-off from the team (BUILD-CARD.md §2 row 1). Do not extend,
 * rename, or "improve" it.
 */
import { z } from "zod";

export const EVENT_TYPES = [
  "last-known-baseline",
  "witnessed-onset",
  "symptom-discovery",
  "last-contact",
  "hearsay-report",
] as const;

export const TIME_KINDS = ["exact", "approximate", "range", "relative", "unknown"] as const;

export const INTERACTIONS = ["in-person", "phone", "video", "text", "other"] as const;

export const DIRECTNESS = ["direct", "hearsay"] as const;

export const OBSERVED_DOMAINS = [
  "speech",
  "behavior",
  "movement",
  "awareness",
  "other",
] as const;

/** Checkable anchors per §4 / §9.4 — memory and another person's account are not anchors. */
export const ANCHOR_TYPES = [
  "phone-call-log",
  "text-timestamp",
  "video-call-log",
  "calendar-entry",
  "receipt",
  "camera",
  "television-program",
  "none",
] as const;

export const CONFIRMATION_METHODS = ["spoken-readback"] as const;

export const claimPayloadSchema = z
  .object({
    encounterId: z.string().min(1),
    patientId: z.string().min(1),
    callId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceRole: z.string().min(1),
    eventType: z.enum(EVENT_TYPES),
    timeKind: z.enum(TIME_KINDS),
    time: z.string().min(1),
    interaction: z.enum(INTERACTIONS),
    directness: z.enum(DIRECTNESS),
    observedDomains: z.array(z.enum(OBSERVED_DOMAINS)).min(1),
    anchor: z.object({
      type: z.enum(ANCHOR_TYPES),
      description: z.string(),
    }),
    quote: z.string().min(1),
    confirmation: z.object({
      method: z.enum(CONFIRMATION_METHODS),
      confirmed: z.boolean(),
    }),
  })
  .strict();

export type ClaimPayload = z.infer<typeof claimPayloadSchema>;

/** Structured function result per §14.7 — the agent recovers conversationally from this. */
export interface ClaimResult {
  accepted: boolean;
  reason?: string;
  nextAction?: string;
  resourceIds?: {
    observation: string;
    questionnaireResponse: string;
    task: string;
    provenance: string;
  };
}
