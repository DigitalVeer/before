/**
 * Interview session lifecycle. POST opens (or returns) the call session for a
 * witness, carrying the doctor-authored kickoff brief that becomes the
 * agent's entire case context. One session per witness — sessions run in
 * parallel.
 */
import { NextResponse } from "next/server";
import { getClinicianClient } from "../../../lib/medplum/client";
import { DEMO_TAG, INTERVIEW_TAG } from "../../../lib/medplum/codes";
import { BUSINESS_IDS, resolveSeedServerIds, WITNESSES } from "../../../lib/medplum/refs";
import { createSession, getSession } from "../../../lib/session/store";
import { sessionsView, sessionView } from "../../../lib/session/view";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { witness?: string; brief?: string };
  const witness = WITNESSES[(body.witness ?? "spouse") as keyof typeof WITNESSES];
  if (!witness) {
    return NextResponse.json({ error: `Unknown witness: ${body.witness}` }, { status: 400 });
  }

  let session = getSession(witness.callId);
  if (!session) {
    session = createSession({
      callId: witness.callId,
      encounterId: BUSINESS_IDS.encounterId,
      patientId: BUSINESS_IDS.patientId,
      sourceId: witness.sourceId,
      sourceRole: witness.sourceRole,
      witnessName: witness.name,
      brief: (body.brief ?? "").trim() || witness.defaultBrief,
    });
    try {
      const clinician = await getClinicianClient();
      const ids = await resolveSeedServerIds(clinician);
      if (witness.key === "spouse") {
        // Seeded Communication belongs to the spouse call.
        const comm = await clinician.readResource("Communication", ids.communication);
        await clinician.updateResource({
          ...comm,
          status: "in-progress",
          note: [
            ...(comm.note ?? []),
            { text: `Call opened by coordinator at ${new Date().toISOString()}` },
            { text: `Kickoff brief recorded for the interview agent: ${session.brief}` },
          ],
        });
        session.communicationId = ids.communication;
      } else {
        const comm = await clinician.createResource({
          resourceType: "Communication",
          meta: { tag: [DEMO_TAG, INTERVIEW_TAG] },
          status: "in-progress",
          subject: { reference: `Patient/${ids.patient}`, display: "Rosa M." },
          encounter: { reference: `Encounter/${ids.encounter}` },
          recipient: [{ reference: `RelatedPerson/${ids[witness.seedField]}`, display: `${witness.name} (${witness.sourceRole})` }],
          sender: { reference: `Practitioner/${ids.coordinator}`, display: "Maya Torres, ED coordinator" },
          topic: { text: `Collateral stroke-timeline interview — ${witness.sourceRole}` },
          note: [
            { text: `Call opened by coordinator at ${new Date().toISOString()}` },
            { text: `Kickoff brief recorded for the interview agent: ${session.brief}` },
          ],
        } as never);
        session.communicationId = (comm as { id: string }).id;
      }
    } catch (err) {
      console.error("Communication write failed (session still created):", err);
    }
  } else if (body.brief && body.brief.trim() && session.status === "ready") {
    // Brief is editable until the interview starts.
    session.brief = body.brief.trim();
  }
  return NextResponse.json({ session: sessionView(witness.callId) });
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const callId = url.searchParams.get("call");
  if (callId) {
    return NextResponse.json({ session: sessionView(callId) });
  }
  return NextResponse.json({ sessions: sessionsView() });
}
