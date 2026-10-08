/**
 * Business-ID → server-ID resolution. The voice agent and the §10.2 payload
 * speak business IDs (temporary-rosa, stroke-code-001); only the server maps
 * them to hosted resource IDs. Cached after first resolution.
 */
import type { MedplumClient } from "@medplum/core";
import { DEMO_ID_SYSTEM, SEED } from "./codes";

/** Payload-facing business IDs (§10.2 examples are canonical). */
export const BUSINESS_IDS = {
  patientId: "temporary-rosa",
  encounterId: "stroke-code-001",
  sourceId: "RelatedPerson/spouse",
  sourceRole: "spouse",
} as const;

/** Interviewable witnesses — each gets its own parallel call session. */
export interface WitnessDef {
  key: "spouse" | "daughter";
  callId: string;
  sourceId: string;
  sourceRole: string;
  name: string;
  /** SeedServerIds field holding this witness's RelatedPerson server id. */
  seedField: "spouse" | "daughter";
  defaultBrief: string;
}

export const WITNESSES: Record<"spouse" | "daughter", WitnessDef> = {
  spouse: {
    key: "spouse",
    callId: "call-spouse-01",
    sourceId: "RelatedPerson/spouse",
    sourceRole: "spouse",
    name: "Luis M.",
    seedField: "spouse",
    defaultBrief:
      "Rosa M., 68, possible stroke, can't give a history. Chart has a relayed 'normal at 06:00' with no " +
      "quote, and a 09:10 'onset' that EMS wording says was her daughter finding her. Luis is her husband; " +
      "he knows she's here. Get what he directly observed: when he last saw or spoke with her, how her " +
      "speech and behavior seemed, and an exact time only from a record he can check. He is frightened.",
  },
  daughter: {
    key: "daughter",
    callId: "call-daughter-01",
    sourceId: "RelatedPerson/daughter",
    sourceRole: "daughter",
    name: "Ana M.",
    seedField: "daughter",
    defaultBrief:
      "Rosa M., 68, possible stroke, can't give a history. Ana is her daughter; she found Rosa with " +
      "symptoms this morning, and her account reached the chart only through EMS — onset versus found is " +
      "unclear. Get her direct account: when she found Rosa, what she saw, whether she watched anything " +
      "begin, any earlier normal contact today, and an exact time only from a record she can check. She " +
      "may blame herself. Do not press.",
  },
};

export function witnessByCallId(callId: string): WitnessDef | undefined {
  return Object.values(WITNESSES).find((w) => w.callId === callId);
}

export interface SeedServerIds {
  patient: string;
  encounter: string;
  spouse: string;
  daughter: string;
  clinician: string;
  coordinator: string;
  collateralTask: string;
  communication: string;
}

const g = globalThis as unknown as { __beforeSeedIds?: SeedServerIds };

export async function resolveSeedServerIds(medplum: MedplumClient): Promise<SeedServerIds> {
  if (g.__beforeSeedIds) return g.__beforeSeedIds;
  async function byId(resourceType: string, seedId: string): Promise<string> {
    const found = await medplum.searchOne(resourceType as never, `identifier=${DEMO_ID_SYSTEM}|${seedId}`);
    if (!found) throw new Error(`Seed resource missing: ${resourceType} ${seedId} — run pnpm seed`);
    return (found as { id: string }).id;
  }
  const ids: SeedServerIds = {
    patient: await byId("Patient", SEED.patient),
    encounter: await byId("Encounter", SEED.encounter),
    spouse: await byId("RelatedPerson", SEED.spouse),
    daughter: await byId("RelatedPerson", SEED.daughter),
    clinician: await byId("Practitioner", SEED.clinician),
    coordinator: await byId("Practitioner", SEED.coordinator),
    collateralTask: await byId("Task", SEED.collateralTask),
    communication: await byId("Communication", SEED.communication),
  };
  g.__beforeSeedIds = ids;
  return ids;
}

export function invalidateSeedCache(): void {
  g.__beforeSeedIds = undefined;
}
