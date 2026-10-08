/**
 * FHIR mapper for an accepted claim (§13): one batch bundle — transcript
 * DocumentReference, QuestionnaireResponse, preliminary Observation with
 * field-evidence extensions, Provenance, review Task. Written under the
 * AGENT credential; nothing here can produce accepted clinical state.
 */
import type { MedplumClient } from "@medplum/core";
import type { Bundle, BundleEntry, Observation } from "@medplum/fhirtypes";
import type { ClaimPayload, ClaimResult } from "../claims/schema";
import type { FieldEvidence } from "../claims/validate";
import type { InterviewSession } from "../session/store";
import {
  DEMO_TAG,
  EVENT_DISPLAY,
  FIELD_EVIDENCE_URL,
  IDEMPOTENCY_SYSTEM,
  INTERVIEW_TAG,
  TIMELINE_EVENT_SYSTEM,
} from "./codes";

function uuidUrn(): string {
  return `urn:uuid:${crypto.randomUUID()}`;
}

const interviewMeta = { tag: [DEMO_TAG, INTERVIEW_TAG] };

export interface WrittenClaim {
  resourceIds: NonNullable<ClaimResult["resourceIds"]>;
  documentReference: string;
}

export async function writeClaimBundle(
  medplum: MedplumClient,
  claim: ClaimPayload,
  session: InterviewSession,
  evidence: FieldEvidence[],
  idempotencyKey: string,
  refs: { patientServerId: string; encounterServerId: string; sourceServerId: string }
): Promise<WrittenClaim> {
  const docRefUrn = uuidUrn();
  const qrUrn = uuidUrn();
  const obsUrn = uuidUrn();
  const provUrn = uuidUrn();
  const taskUrn = uuidUrn();
  const now = new Date().toISOString();

  const patientRef = { reference: `Patient/${refs.patientServerId}`, display: "Rosa M." };
  const encounterRef = { reference: `Encounter/${refs.encounterServerId}` };
  const sourceRef = {
    reference: `RelatedPerson/${refs.sourceServerId}`,
    display: `${session.witnessName} (${claim.sourceRole})`,
  };

  const transcriptText = session.transcript
    .map((t) => `[${t.turnId}] ${t.role === "assistant" ? "Before" : "Witness"}: ${t.content}`)
    .join("\n");

  const fieldEvidenceExtensions = evidence.map((e) => ({
    url: FIELD_EVIDENCE_URL,
    extension: [
      { url: "field", valueCode: e.field },
      { url: "questionnaireResponse", valueReference: { reference: qrUrn } },
      { url: "turnId", valueString: e.turnId },
      { url: "quote", valueString: e.quote },
    ],
  }));

  const entries: BundleEntry[] = [
    {
      fullUrl: docRefUrn,
      request: { method: "POST", url: "DocumentReference" },
      resource: {
        resourceType: "DocumentReference",
        meta: interviewMeta,
        status: "current",
        description: `Interview transcript — call ${claim.callId}`,
        subject: patientRef,
        context: { encounter: [encounterRef] },
        content: [
          {
            attachment: {
              contentType: "text/plain",
              data: Buffer.from(transcriptText, "utf8").toString("base64"),
              title: `transcript-${claim.callId}.txt`,
            },
          },
        ],
      },
    },
    {
      fullUrl: qrUrn,
      request: { method: "POST", url: "QuestionnaireResponse" },
      resource: {
        resourceType: "QuestionnaireResponse",
        meta: interviewMeta,
        questionnaire: "urn:before:Questionnaire:collateral-interview|v1",
        status: "completed",
        subject: patientRef,
        encounter: encounterRef,
        source: sourceRef,
        authored: now,
        item: [
          { linkId: "eventType", text: "Event type", answer: [{ valueCoding: { system: TIMELINE_EVENT_SYSTEM, code: claim.eventType } }] },
          { linkId: "timeKind", text: "Time precision", answer: [{ valueString: claim.timeKind }] },
          { linkId: "time", text: "Time", answer: [{ valueDateTime: claim.time }] },
          { linkId: "interaction", text: "Interaction modality", answer: [{ valueString: claim.interaction }] },
          { linkId: "directness", text: "Direct observation or hearsay", answer: [{ valueString: claim.directness }] },
          {
            linkId: "observedDomains",
            text: "Observed domains",
            answer: claim.observedDomains.map((d) => ({ valueString: d })),
          },
          { linkId: "anchorType", text: "Checkable anchor", answer: [{ valueString: claim.anchor.type }] },
          { linkId: "anchorDescription", text: "Anchor description", answer: [{ valueString: claim.anchor.description }] },
          { linkId: "quote", text: "Witness quote", answer: [{ valueString: claim.quote }] },
          { linkId: "confirmationMethod", text: "Confirmation method", answer: [{ valueString: claim.confirmation.method }] },
          { linkId: "confirmed", text: "Witness confirmed read-back", answer: [{ valueBoolean: claim.confirmation.confirmed }] },
          {
            linkId: "gates",
            text: "Transfer gates at time of claim",
            answer: [
              { valueString: `disclosureBasisRecorded=${session.gates.disclosureBasisRecorded};recipientVerified=${session.gates.recipientVerified};aiParticipationAgreed=${session.gates.aiParticipationAgreed}` },
            ],
          },
        ],
      },
    },
    {
      fullUrl: obsUrn,
      request: {
        method: "POST",
        url: "Observation",
        ifNoneExist: `identifier=${IDEMPOTENCY_SYSTEM}|${idempotencyKey}`,
      },
      resource: {
        resourceType: "Observation",
        meta: interviewMeta,
        identifier: [{ system: IDEMPOTENCY_SYSTEM, value: idempotencyKey }],
        status: "preliminary",
        code: {
          coding: [
            {
              system: TIMELINE_EVENT_SYSTEM,
              code: claim.eventType,
              display: EVENT_DISPLAY[claim.eventType] ?? claim.eventType,
            },
          ],
          text: EVENT_DISPLAY[claim.eventType] ?? claim.eventType,
        },
        subject: patientRef,
        encounter: encounterRef,
        effectiveDateTime: claim.time,
        issued: now,
        performer: [sourceRef],
        derivedFrom: [{ reference: docRefUrn }, { reference: qrUrn }],
        note: [
          {
            text: `Direct ${claim.interaction} observation. Witness checked ${claim.anchor.type.replace(/-/g, " ")} and confirmed via spoken read-back. Quote: "${claim.quote}"`,
          },
        ],
        extension: fieldEvidenceExtensions,
      } as Observation,
    },
    {
      fullUrl: provUrn,
      request: { method: "POST", url: "Provenance" },
      resource: {
        resourceType: "Provenance",
        meta: interviewMeta,
        target: [{ reference: obsUrn }],
        recorded: now,
        agent: [
          {
            type: {
              coding: [
                { system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "informant", display: "Informant" },
              ],
            },
            who: sourceRef,
          },
          {
            type: {
              coding: [
                { system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "assembler", display: "Assembler" },
              ],
            },
            who: { display: "Before voice agent (Deepgram Voice Agent session)" },
          },
          {
            type: {
              coding: [
                { system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "composer", display: "Composer" },
              ],
            },
            who: { display: "Before function server (deterministic validator)" },
          },
        ],
        entity: [{ role: "source", what: { reference: qrUrn } }],
      },
    },
    {
      fullUrl: taskUrn,
      request: { method: "POST", url: "Task" },
      resource: {
        resourceType: "Task",
        meta: interviewMeta,
        status: "requested",
        intent: "order",
        priority: "urgent",
        code: { text: "Collateral time evidence review" },
        description: "Time evidence changed — clinician review required",
        focus: { reference: obsUrn },
        for: patientRef,
        encounter: encounterRef,
        authoredOn: now,
        requester: { display: "Before function server" },
      },
    },
  ];

  const bundle: Bundle = { resourceType: "Bundle", type: "batch", entry: entries };
  const result = await medplum.executeBatch(bundle);

  const ids: string[] = [];
  for (const entry of result.entry ?? []) {
    const loc = entry.response?.location ?? "";
    ids.push(loc.split("/history")[0]);
  }
  const [docRef, qr, obs, prov, task] = ids;
  if (!obs || !obs.includes("Observation/")) {
    throw new Error(
      `Claim bundle write failed: ${JSON.stringify(result.entry?.map((e) => e.response?.status))}`
    );
  }
  return {
    resourceIds: { observation: obs, questionnaireResponse: qr, task, provenance: prov },
    documentReference: docRef,
  };
}
