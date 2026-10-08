/** Local code systems, identifiers, and tags (§13). Local codes are labeled as such — no standard-code claims. */

export const TIMELINE_EVENT_SYSTEM = "urn:before:CodeSystem:timeline-event-type";
export const FIELD_EVIDENCE_URL = "urn:before:StructureDefinition:field-evidence";
export const FLAG_EXTENSION_URL = "urn:before:StructureDefinition:timeline-flag";
export const DEMO_ID_SYSTEM = "urn:before:demo-id";
export const IDEMPOTENCY_SYSTEM = "urn:before:idempotency-key";
export const DEMO_TAG = { system: "urn:before:demo", code: "before-demo" };
export const INTERVIEW_TAG = { system: "urn:before:demo", code: "before-interview" };

export const EVENT_DISPLAY: Record<string, string> = {
  "last-known-baseline": "Witness-reported last known baseline",
  "witnessed-onset": "Witness-reported symptom onset",
  "symptom-discovery": "Symptoms discovered (already present)",
  "last-contact": "Last contact (baseline not established)",
  "hearsay-report": "Hearsay report",
  "accepted-baseline": "Clinician-accepted last known baseline",
};

/** Seed identifiers — stable business IDs for idempotent seeding. */
export const SEED = {
  patient: "patient-rosa",
  encounter: "encounter-stroke-code-001",
  spouse: "relatedperson-luis",
  daughter: "relatedperson-daughter",
  clinician: "practitioner-clinician",
  coordinator: "practitioner-coordinator",
  emsBaseline: "obs-ems-0600-baseline",
  emsOnset: "obs-ems-0910-onset",
  collateralTask: "task-collateral-interview",
  communication: "communication-call-spouse-01",
} as const;

/** The canonical demo call/session binding (§24). */
export const CANONICAL_CALL_ID = "call-spouse-01";
