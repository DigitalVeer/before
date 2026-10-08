/**
 * The three transfer gates (§12.6, §18.4) — recorded one at a time by the
 * coordinator, mirrored onto the call Communication. Server-owned state.
 */
import { NextResponse } from "next/server";
import { getClinicianClient } from "../../../../lib/medplum/client";
import { CANONICAL_CALL_ID } from "../../../../lib/medplum/codes";
import { getSession } from "../../../../lib/session/store";
import { sessionView } from "../../../../lib/session/view";

export const dynamic = "force-dynamic";

const GATE_LABELS: Record<string, string> = {
  disclosureBasisRecorded: "Care-team outreach basis recorded",
  recipientVerified: "Intended recipient verified",
  aiParticipationAgreed: "AI participation agreed",
};

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as { gate?: string; callId?: string };
  const gate = body.gate ?? "";
  if (!(gate in GATE_LABELS)) {
    return NextResponse.json({ error: `Unknown gate: ${gate}` }, { status: 400 });
  }
  const callId = body.callId ?? CANONICAL_CALL_ID;
  const session = getSession(callId);
  if (!session) {
    return NextResponse.json({ error: "No active session" }, { status: 409 });
  }
  // Gates are ordered: verification before disclosure, agreement last (§18.4).
  if (gate === "recipientVerified" && !session.gates.disclosureBasisRecorded) {
    return NextResponse.json({ error: "Record the outreach basis first" }, { status: 409 });
  }
  if (gate === "aiParticipationAgreed" && !session.gates.recipientVerified) {
    return NextResponse.json({ error: "Verify the recipient before asking for AI participation" }, { status: 409 });
  }
  session.gates[gate as keyof typeof session.gates] = true;

  if (session.communicationId) {
    try {
      const clinician = await getClinicianClient();
      const comm = await clinician.readResource("Communication", session.communicationId);
      await clinician.updateResource({
        ...comm,
        note: [
          ...(comm.note ?? []),
          { text: `${GATE_LABELS[gate]} — ${new Date().toISOString()}` },
        ],
      });
    } catch (err) {
      console.error("Gate note write failed:", err);
    }
  }
  return NextResponse.json({ session: sessionView(callId) });
}
