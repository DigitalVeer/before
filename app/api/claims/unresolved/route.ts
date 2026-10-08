/**
 * recordUnresolvedClaim (§14.4): persist an approximate or incomplete
 * statement WITHOUT promoting it — a QuestionnaireResponse only, no timeline
 * Observation. "Unknown" is a valid result (§18.9).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentClient } from "../../../../lib/medplum/client";
import { DEMO_TAG, INTERVIEW_TAG } from "../../../../lib/medplum/codes";
import { getClinicianClient } from "../../../../lib/medplum/client";
import { resolveSeedServerIds } from "../../../../lib/medplum/refs";
import { allGatesSet, getSession } from "../../../../lib/session/store";

export const dynamic = "force-dynamic";

const unresolvedSchema = z
  .object({
    callId: z.string().min(1),
    statement: z.string().min(1),
    timeKind: z.enum(["approximate", "range", "relative", "unknown"]),
    approximateTime: z.string().optional(),
    reason: z.string().min(1),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = unresolvedSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ accepted: false, reason: "malformed-payload", nextAction: "Provide callId, statement, timeKind, reason." });
  }
  const session = getSession(parsed.data.callId);
  if (!session || session.status !== "interviewing" || !allGatesSet(session.gates)) {
    return NextResponse.json({ accepted: false, reason: "session-not-active", nextAction: "Hand back to the coordinator." });
  }
  try {
    const agent = await getAgentClient();
    const clinician = await getClinicianClient();
    const ids = await resolveSeedServerIds(clinician);
    const qr = await agent.createResource({
      resourceType: "QuestionnaireResponse",
      meta: { tag: [DEMO_TAG, INTERVIEW_TAG] },
      questionnaire: "urn:before:Questionnaire:collateral-interview|v1",
      status: "completed",
      subject: { reference: `Patient/${ids.patient}` },
      encounter: { reference: `Encounter/${ids.encounter}` },
      source: { reference: `RelatedPerson/${ids.spouse}` },
      authored: new Date().toISOString(),
      item: [
        { linkId: "unresolvedStatement", text: "Unresolved statement", answer: [{ valueString: parsed.data.statement }] },
        { linkId: "timeKind", text: "Time precision", answer: [{ valueString: parsed.data.timeKind }] },
        ...(parsed.data.approximateTime
          ? [{ linkId: "approximateTime", text: "Approximate time as spoken", answer: [{ valueString: parsed.data.approximateTime }] }]
          : []),
        { linkId: "unresolvedReason", text: "Why unresolved", answer: [{ valueString: parsed.data.reason }] },
      ],
    } as never);
    return NextResponse.json({ accepted: true, resourceIds: { questionnaireResponse: `QuestionnaireResponse/${(qr as { id: string }).id}` } });
  } catch (err) {
    console.error("Unresolved claim write failed:", err);
    return NextResponse.json({ accepted: false, reason: "medplum-write-failed", nextAction: "Continue the conversation; the coordinator will follow up." });
  }
}
