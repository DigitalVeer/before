/**
 * Session disposition: refusal, cancellation, human-takeover, completion.
 * Refusal/cancellation permanently blocks claim writes for the call (§10.3).
 */
import { NextResponse } from "next/server";
import { getClinicianClient } from "../../../../lib/medplum/client";
import { CANONICAL_CALL_ID } from "../../../../lib/medplum/codes";
import { getSession } from "../../../../lib/session/store";
import { sessionView } from "../../../../lib/session/view";

export const dynamic = "force-dynamic";

const ALLOWED = ["refused", "cancelled", "handed-to-human", "complete"] as const;

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as { status?: string; reason?: string; callId?: string };
  if (!ALLOWED.includes(body.status as (typeof ALLOWED)[number])) {
    return NextResponse.json({ error: `status must be one of ${ALLOWED.join(", ")}` }, { status: 400 });
  }
  const callId = body.callId ?? CANONICAL_CALL_ID;
  const session = getSession(callId);
  if (!session) {
    return NextResponse.json({ error: "No active session" }, { status: 409 });
  }
  session.status = body.status as (typeof ALLOWED)[number];
  if (body.reason) session.disposition = body.reason;

  if (session.communicationId) {
    try {
      const clinician = await getClinicianClient();
      const comm = await clinician.readResource("Communication", session.communicationId);
      await clinician.updateResource({
        ...comm,
        status: body.status === "complete" ? "completed" : "stopped",
        note: [
          ...(comm.note ?? []),
          {
            text: `Call ${body.status}${body.reason ? ` — ${body.reason}` : ""} at ${new Date().toISOString()}`,
          },
        ],
      });
    } catch (err) {
      console.error("Communication disposition write failed:", err);
    }
  }
  return NextResponse.json({ session: sessionView(callId) });
}
