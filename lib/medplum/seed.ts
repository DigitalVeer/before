/**
 * Idempotent seed for the canonical Rosa case (§24.1). Every resource carries
 * a stable business identifier (DEMO_ID_SYSTEM) and the demo tag; seeding is
 * find-or-create, so re-running it never duplicates and never changes server
 * IDs of existing seeds. Reset = delete interview-tagged resources + re-seed.
 */
import type { MedplumClient } from "@medplum/core";
import type {
  Communication,
  Encounter,
  Observation,
  Patient,
  Practitioner,
  RelatedPerson,
  Resource,
  Task,
} from "@medplum/fhirtypes";
import {
  DEMO_ID_SYSTEM,
  DEMO_TAG,
  FLAG_EXTENSION_URL,
  SEED,
  TIMELINE_EVENT_SYSTEM,
} from "./codes";

/** Local calendar date in the demo timezone (America/Los_Angeles). */
export function demoDate(): string {
  const tz = process.env.DEMO_TIMEZONE ?? "America/Los_Angeles";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function findOrCreate<T extends Resource>(
  medplum: MedplumClient,
  seedId: string,
  build: () => T
): Promise<T> {
  const existing = await medplum.searchOne(
    build().resourceType as never,
    `identifier=${DEMO_ID_SYSTEM}|${seedId}`
  );
  if (existing) return existing as T;
  return medplum.createResource(build());
}

function seedMeta() {
  return { tag: [DEMO_TAG] };
}

function seedIdentifier(seedId: string) {
  return [{ system: DEMO_ID_SYSTEM, value: seedId }];
}

export interface SeededIds {
  patient: string;
  encounter: string;
  spouse: string;
  daughter: string;
  clinician: string;
  coordinator: string;
  emsBaseline: string;
  emsOnset: string;
  collateralTask: string;
  communication: string;
}

export async function seedCanonicalCase(medplum: MedplumClient): Promise<SeededIds> {
  const date = demoDate();

  const patient = await findOrCreate<Patient>(medplum, SEED.patient, () => ({
    resourceType: "Patient",
    meta: seedMeta(),
    identifier: [
      ...seedIdentifier(SEED.patient),
      { system: "urn:before:temporary-mrn", value: "TEMP-4471" },
    ],
    name: [{ given: ["Rosa"], family: "M." }],
    birthDate: "1958-03-14",
    gender: "female",
  }));

  const encounter = await findOrCreate<Encounter>(medplum, SEED.encounter, () => ({
    resourceType: "Encounter",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.encounter),
    status: "in-progress",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "EMER", display: "emergency" },
    type: [{ text: "Stroke code — possible acute ischemic stroke" }],
    subject: { reference: `Patient/${patient.id}`, display: "Rosa M." },
    period: { start: `${date}T11:52:00-07:00` },
  }));

  const spouse = await findOrCreate<RelatedPerson>(medplum, SEED.spouse, () => ({
    resourceType: "RelatedPerson",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.spouse),
    patient: { reference: `Patient/${patient.id}` },
    relationship: [
      {
        coding: [
          { system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: "SPS", display: "spouse" },
        ],
        text: "spouse",
      },
    ],
    name: [{ given: ["Luis"], family: "M." }],
    telecom: [{ system: "phone", value: "+1 415 555 0173", use: "mobile" }],
  }));

  const daughter = await findOrCreate<RelatedPerson>(medplum, SEED.daughter, () => ({
    resourceType: "RelatedPerson",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.daughter),
    patient: { reference: `Patient/${patient.id}` },
    relationship: [
      {
        coding: [
          { system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: "DAUC", display: "daughter" },
        ],
        text: "daughter",
      },
    ],
    name: [{ given: ["Ana"], family: "M." }],
  }));

  const clinician = await findOrCreate<Practitioner>(medplum, SEED.clinician, () => ({
    resourceType: "Practitioner",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.clinician),
    name: [{ prefix: ["Dr."], given: ["Priya"], family: "Nair" }],
  }));

  const coordinator = await findOrCreate<Practitioner>(medplum, SEED.coordinator, () => ({
    resourceType: "Practitioner",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.coordinator),
    name: [{ given: ["Maya"], family: "Torres" }],
  }));

  // 06:00 — "last seen normal", daughter via EMS, no underlying quote (§24.1).
  const emsBaseline = await findOrCreate<Observation>(medplum, SEED.emsBaseline, () => ({
    resourceType: "Observation",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.emsBaseline),
    status: "preliminary",
    code: {
      coding: [
        {
          system: TIMELINE_EVENT_SYSTEM,
          code: "last-known-baseline",
          display: "Witness-reported last known baseline",
        },
      ],
      text: "Last seen normal (relayed)",
    },
    subject: { reference: `Patient/${patient.id}`, display: "Rosa M." },
    encounter: { reference: `Encounter/${encounter.id}` },
    effectiveDateTime: `${date}T06:00:00-07:00`,
    performer: [{ reference: `RelatedPerson/${daughter.id}`, display: "Daughter, relayed through EMS" }],
    note: [
      {
        text: "EMS handoff: daughter reports Rosa 'last seen normal' around 06:00. No direct quote recorded; observation basis not established.",
      },
    ],
    extension: [
      { url: FLAG_EXTENSION_URL, valueCode: "relayed-through-ems" },
      { url: FLAG_EXTENSION_URL, valueCode: "no-source-quote" },
      { url: FLAG_EXTENSION_URL, valueCode: "unanchored-time" },
    ],
  }));

  // 09:10 — structured as "onset" while the EMS narrative says discovery (§24.1).
  const emsOnset = await findOrCreate<Observation>(medplum, SEED.emsOnset, () => ({
    resourceType: "Observation",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.emsOnset),
    status: "preliminary",
    code: {
      coding: [
        {
          system: TIMELINE_EVENT_SYSTEM,
          code: "witnessed-onset",
          display: "Witness-reported symptom onset",
        },
      ],
      text: "Reported 'onset' (EMS narrative describes discovery)",
    },
    subject: { reference: `Patient/${patient.id}`, display: "Rosa M." },
    encounter: { reference: `Encounter/${encounter.id}` },
    effectiveDateTime: `${date}T09:10:00-07:00`,
    performer: [{ reference: `RelatedPerson/${daughter.id}`, display: "Daughter, relayed through EMS" }],
    note: [
      {
        text: "EMS narrative: 'Daughter found patient with right-sided weakness and speech difficulty at 09:10.' Structured field recorded as onset; wording describes symptoms already present.",
      },
    ],
    extension: [
      { url: FLAG_EXTENSION_URL, valueCode: "relayed-through-ems" },
      { url: FLAG_EXTENSION_URL, valueCode: "onset-vs-discovery-not-established" },
    ],
  }));

  const collateralTask = await findOrCreate<Task>(medplum, SEED.collateralTask, () => ({
    resourceType: "Task",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.collateralTask),
    status: "requested",
    intent: "order",
    priority: "urgent",
    code: { text: "Collateral timeline interview" },
    description:
      "Clinical time unresolved: latest documented baseline is relayed and unanchored; 09:10 'onset' wording describes discovery. Interview reachable witness.",
    for: { reference: `Patient/${patient.id}`, display: "Rosa M." },
    encounter: { reference: `Encounter/${encounter.id}` },
    requester: { reference: `Practitioner/${coordinator.id}`, display: "Maya Torres, ED coordinator" },
    note: [
      {
        text: "Care-team determination on file: Rosa cannot answer; spouse is involved in her care; provider-directed outreach judged in her best interest under hospital policy. Basis recorded before any disclosure call.",
      },
    ],
    authoredOn: `${date}T12:05:00-07:00`,
  }));

  const communication = await findOrCreate<Communication>(medplum, SEED.communication, () => ({
    resourceType: "Communication",
    meta: seedMeta(),
    identifier: seedIdentifier(SEED.communication),
    status: "preparation",
    subject: { reference: `Patient/${patient.id}`, display: "Rosa M." },
    encounter: { reference: `Encounter/${encounter.id}` },
    recipient: [{ reference: `RelatedPerson/${spouse.id}`, display: "Luis M. (spouse)" }],
    sender: { reference: `Practitioner/${coordinator.id}`, display: "Maya Torres, ED coordinator" },
    topic: { text: "Collateral stroke-timeline interview — spouse" },
    note: [{ text: "Planned staff-initiated call. Gates pending: outreach basis, recipient verification, AI participation." }],
  }));

  return {
    patient: patient.id as string,
    encounter: encounter.id as string,
    spouse: spouse.id as string,
    daughter: daughter.id as string,
    clinician: clinician.id as string,
    coordinator: coordinator.id as string,
    emsBaseline: emsBaseline.id as string,
    emsOnset: emsOnset.id as string,
    collateralTask: collateralTask.id as string,
    communication: communication.id as string,
  };
}

/** Scoped reset (§26.5): delete interview-created resources only, then ensure seeds. */
export async function resetDemo(medplum: MedplumClient): Promise<SeededIds> {
  const types = ["Observation", "QuestionnaireResponse", "DocumentReference", "Provenance", "Task"];
  for (const resourceType of types) {
    const created = await medplum.searchResources(resourceType as never, {
      _tag: `${DEMO_TAG.system}|before-interview`,
      _count: "100",
    });
    for (const resource of created) {
      await medplum.deleteResource(resourceType as never, (resource as Resource).id as string);
    }
  }
  // Restore seeded mutable state: collateral task open, communication in preparation.
  const ids = await seedCanonicalCase(medplum);
  const task = await medplum.readResource("Task", ids.collateralTask);
  if (task.status !== "requested") {
    await medplum.updateResource({ ...task, status: "requested" });
  }
  const comm = await medplum.readResource("Communication", ids.communication);
  if (comm.status !== "preparation") {
    await medplum.updateResource({
      ...comm,
      status: "preparation",
      note: [{ text: "Planned staff-initiated call. Gates pending: outreach basis, recipient verification, AI participation." }],
    });
  }
  return ids;
}
