/**
 * Clinician Accept (§7.9, §13.3): a SEPARATE final Observation under the
 * CLINICIAN credential with its own Provenance. The agent's preliminary
 * evidence is never mutated — acceptance is a new, clinician-owned resource.
 */
import { NextResponse } from "next/server";
import { getClinicianClient } from "../../../../lib/medplum/client";
import {
  DEMO_TAG,
  INTERVIEW_TAG,
  TIMELINE_EVENT_SYSTEM,
} from "../../../../lib/medplum/codes";
import { resolveSeedServerIds } from "../../../../lib/medplum/refs";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { observationId?: string; taskId?: string };
  if (!body.observationId) {
    return NextResponse.json({ error: "observationId required" }, { status: 400 });
  }
  try {
    const clinician = await getClinicianClient();
    const ids = await resolveSeedServerIds(clinician);
    const preliminary = await clinician.readResource("Observation", body.observationId.replace("Observation/", ""));

    const accepted = await clinician.createResource({
      resourceType: "Observation",
      meta: { tag: [DEMO_TAG, INTERVIEW_TAG] },
      status: "final",
      code: {
        coding: [
          {
            system: TIMELINE_EVENT_SYSTEM,
            code: "accepted-baseline",
            display: "Clinician-accepted last known baseline",
          },
        ],
        text: "Clinician-accepted last known baseline",
      },
      subject: preliminary.subject,
      encounter: preliminary.encounter,
      effectiveDateTime: preliminary.effectiveDateTime,
      issued: new Date().toISOString(),
      performer: [{ reference: `Practitioner/${ids.clinician}`, display: "Dr. Priya Nair, stroke neurology" }],
      derivedFrom: [{ reference: `Observation/${preliminary.id}` }],
      note: [
        {
          text: "Accepted as working last-known-baseline for this encounter after review of source evidence. Original witness-reported claim retained unmodified.",
        },
      ],
    } as never);

    await clinician.createResource({
      resourceType: "Provenance",
      meta: { tag: [DEMO_TAG, INTERVIEW_TAG] },
      target: [{ reference: `Observation/${(accepted as { id: string }).id}` }],
      recorded: new Date().toISOString(),
      agent: [
        {
          type: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
                code: "verifier",
                display: "Verifier",
              },
            ],
          },
          who: { reference: `Practitioner/${ids.clinician}`, display: "Dr. Priya Nair, stroke neurology" },
        },
      ],
      entity: [{ role: "source", what: { reference: `Observation/${preliminary.id}` } }],
    } as never);

    if (body.taskId) {
      const task = await clinician.readResource("Task", body.taskId.replace("Task/", ""));
      await clinician.updateResource({
        ...task,
        status: "completed",
        output: [
          {
            type: { text: "disposition" },
            valueString: "accepted",
          },
        ],
      });
    }
    return NextResponse.json({ accepted: `Observation/${(accepted as { id: string }).id}` });
  } catch (err) {
    console.error("Accept failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
