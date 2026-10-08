/**
 * Timeline read model (§12): the clinician screen renders ONLY from these
 * hosted-server reads — never from client optimism. Receipts derive from
 * resource data so changing the resource changes the chip.
 */
import type { MedplumClient } from "@medplum/core";
import type { Observation, QuestionnaireResponse, Task } from "@medplum/fhirtypes";
import { computeInterval, type BoundedInterval } from "../timeline/interval";
import { FIELD_EVIDENCE_URL, FLAG_EXTENSION_URL, TIMELINE_EVENT_SYSTEM } from "./codes";

export interface EventReceipts {
  sourceLinked: boolean;
  witnessConfirmed: boolean;
  preliminary: boolean;
  decisionPending: boolean;
}

export interface FieldEvidenceView {
  field: string;
  turnId: string;
  quote: string;
}

export interface TimelineEventView {
  id: string;
  eventType: string;
  timeIso: string | null;
  label: string;
  sourceLine: string;
  noteText: string;
  flags: string[];
  direct: boolean;
  anchored: boolean;
  confirmed: boolean;
  preliminary: boolean;
  acceptedBy: string | null;
  receipts: EventReceipts | null;
  evidence: {
    quote: string;
    anchorDescription: string;
    fieldEvidence: FieldEvidenceView[];
    observationId: string;
    questionnaireResponseId: string | null;
    transcriptReference: string | null;
  } | null;
}

export interface ReviewTaskView {
  id: string;
  status: string;
  description: string;
  focusObservation: string | null;
}

export interface TimelineViewModel {
  events: TimelineEventView[];
  interval: BoundedInterval | null;
  reviewTask: ReviewTaskView | null;
  reviewTasks: ReviewTaskView[];
  acceptedObservationId: string | null;
  fetchedAt: string;
}

function flagsOf(obs: Observation): string[] {
  return (obs.extension ?? [])
    .filter((e) => e.url === FLAG_EXTENSION_URL && e.valueCode)
    .map((e) => e.valueCode as string);
}

function fieldEvidenceOf(obs: Observation): FieldEvidenceView[] {
  return (obs.extension ?? [])
    .filter((e) => e.url === FIELD_EVIDENCE_URL)
    .map((e) => {
      const sub = (name: string) => e.extension?.find((x) => x.url === name);
      return {
        field: sub("field")?.valueCode ?? "",
        turnId: sub("turnId")?.valueString ?? "",
        quote: sub("quote")?.valueString ?? "",
      };
    });
}

function qrAnswer(qr: QuestionnaireResponse | undefined, linkId: string): string | boolean | null {
  const item = qr?.item?.find((i) => i.linkId === linkId);
  const a = item?.answer?.[0];
  if (!a) return null;
  return a.valueString ?? a.valueBoolean ?? a.valueDateTime ?? null;
}

export async function readTimeline(
  medplum: MedplumClient,
  encounterServerId: string
): Promise<TimelineViewModel> {
  const [observations, tasks] = await Promise.all([
    medplum.searchResources("Observation", {
      encounter: `Encounter/${encounterServerId}`,
      code: `${TIMELINE_EVENT_SYSTEM}|`,
      _count: "50",
      _sort: "date",
    }),
    medplum.searchResources("Task", {
      encounter: `Encounter/${encounterServerId}`,
      _count: "50",
      _sort: "-authored-on",
    }),
  ]);

  // QuestionnaireResponses referenced by interview observations (for receipts + drawer).
  const qrIds = new Set<string>();
  for (const obs of observations) {
    for (const ref of obs.derivedFrom ?? []) {
      const r = ref.reference ?? "";
      if (r.startsWith("QuestionnaireResponse/")) qrIds.add(r.split("/")[1]);
    }
  }
  const qrs = new Map<string, QuestionnaireResponse>();
  await Promise.all(
    [...qrIds].map(async (id) => {
      try {
        qrs.set(id, await medplum.readResource("QuestionnaireResponse", id));
      } catch {
        // drawer degrades gracefully if a QR read fails
      }
    })
  );

  const reviewTaskResources = tasks.filter(
    (t: Task) => t.code?.text === "Collateral time evidence review"
  );
  const reviewTaskResource = reviewTaskResources[0];
  const openStatuses = ["requested", "received", "accepted", "in-progress"];
  const reviewOpen = reviewTaskResources.some((t: Task) => openStatuses.includes(t.status ?? ""));

  // Clinician-accepted representations (separate resources; originals stay preliminary).
  const acceptedObs = observations.filter(
    (o: Observation) => o.code?.coding?.[0]?.code === "accepted-baseline"
  );
  const accepted = acceptedObs[0];
  const acceptedByFrom = new Map<string, string>();
  for (const a of acceptedObs) {
    const from = a.derivedFrom?.[0]?.reference;
    const by = a.performer?.[0]?.display;
    if (from && by) acceptedByFrom.set(from, by);
  }

  const events: TimelineEventView[] = [];
  for (const obs of observations) {
    if (obs.code?.coding?.[0]?.code === "accepted-baseline") continue;
    const flags = flagsOf(obs);
    const fieldEvidence = fieldEvidenceOf(obs);
    const isInterviewClaim = fieldEvidence.length > 0;
    const qrId =
      (obs.derivedFrom ?? [])
        .map((r) => r.reference ?? "")
        .find((r) => r.startsWith("QuestionnaireResponse/"))
        ?.split("/")[1] ?? null;
    const docRef =
      (obs.derivedFrom ?? [])
        .map((r) => r.reference ?? "")
        .find((r) => r.startsWith("DocumentReference/")) ?? null;
    const qr = qrId ? qrs.get(qrId) : undefined;

    const direct = isInterviewClaim
      ? qrAnswer(qr, "directness") === "direct" || fieldEvidence.some((f) => f.field === "directness")
      : false;
    const anchored = isInterviewClaim
      ? (qrAnswer(qr, "anchorType") ?? "none") !== "none"
      : !flags.includes("unanchored-time") && isInterviewClaim;
    const confirmed = isInterviewClaim ? qrAnswer(qr, "confirmed") === true : false;
    const acceptedByName = acceptedByFrom.get(`Observation/${obs.id}`) ?? null;
    const wasAccepted = acceptedByName !== null;

    events.push({
      id: obs.id as string,
      eventType: obs.code?.coding?.[0]?.code ?? "unknown",
      timeIso: obs.effectiveDateTime ?? null,
      label: obs.code?.text ?? obs.code?.coding?.[0]?.display ?? "Timeline event",
      sourceLine: obs.performer?.[0]?.display ?? "Unknown source",
      noteText: obs.note?.[0]?.text ?? "",
      flags,
      direct,
      anchored,
      confirmed,
      preliminary: obs.status === "preliminary",
      acceptedBy: acceptedByName,
      receipts: isInterviewClaim
        ? {
            sourceLinked: (obs.derivedFrom ?? []).length > 0 && fieldEvidence.length > 0,
            witnessConfirmed: confirmed,
            preliminary: obs.status === "preliminary",
            decisionPending: reviewOpen && !wasAccepted,
          }
        : null,
      evidence: isInterviewClaim
        ? {
            quote: (qrAnswer(qr, "quote") as string) ?? "",
            anchorDescription: (qrAnswer(qr, "anchorDescription") as string) ?? "",
            fieldEvidence,
            observationId: `Observation/${obs.id}`,
            questionnaireResponseId: qrId ? `QuestionnaireResponse/${qrId}` : null,
            transcriptReference: docRef,
          }
        : null,
    });
  }

  const interval = computeInterval(
    events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      timeIso: e.timeIso,
      direct: e.direct,
      anchored: e.anchored,
      confirmed: e.confirmed,
    }))
  );

  return {
    events,
    interval,
    reviewTask: reviewTaskResource
      ? {
          id: reviewTaskResource.id as string,
          status: reviewTaskResource.status as string,
          description: reviewTaskResource.description ?? "",
          focusObservation: reviewTaskResource.focus?.reference ?? null,
        }
      : null,
    reviewTasks: reviewTaskResources.map((t: Task) => ({
      id: t.id as string,
      status: t.status as string,
      description: t.description ?? "",
      focusObservation: t.focus?.reference ?? null,
    })),
    acceptedObservationId: accepted ? `Observation/${accepted.id}` : null,
    fetchedAt: new Date().toISOString(),
  };
}
