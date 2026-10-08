/**
 * Server-side gate check before the voice interview can begin (done-bar:
 * an attempt with any gate missing is refused, server-side).
 */
import { NextResponse } from "next/server";
import { CANONICAL_CALL_ID } from "../../../../lib/medplum/codes";
import { allGatesSet, getSession } from "../../../../lib/session/store";
import { sessionView } from "../../../../lib/session/view";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { callId?: string };
  const callId = body.callId ?? CANONICAL_CALL_ID;
  const session = getSession(callId);
  if (!session) {
    return NextResponse.json({ error: "No active session — open the interview first" }, { status: 409 });
  }
  if (!allGatesSet(session.gates)) {
    const missing = Object.entries(session.gates)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    return NextResponse.json(
      { error: `Interview refused: transfer gates unset (${missing.join(", ")})`, missing },
      { status: 403 }
    );
  }
  if (session.status === "refused" || session.status === "cancelled") {
    return NextResponse.json({ error: `Session is ${session.status}` }, { status: 409 });
  }
  session.status = "interviewing";
  return NextResponse.json({ session: sessionView(callId) });
}
