/**
 * Server-observed transcript turns (from Deepgram ConversationText events).
 * The read-back gate in the validator checks THESE turns — confirmation is
 * server-observable, never model-asserted.
 */
import { NextResponse } from "next/server";
import { CANONICAL_CALL_ID } from "../../../../lib/medplum/codes";
import { appendTurn, getSession } from "../../../../lib/session/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as { role?: string; content?: string; callId?: string };
  if ((body.role !== "assistant" && body.role !== "user") || !body.content) {
    return NextResponse.json({ error: "role (assistant|user) and content required" }, { status: 400 });
  }
  const callId = body.callId ?? CANONICAL_CALL_ID;
  const session = getSession(callId);
  if (!session) {
    return NextResponse.json({ error: "No active session" }, { status: 409 });
  }
  const turn = appendTurn(callId, { role: body.role, content: body.content });
  return NextResponse.json({ turn });
}

export async function GET(req: Request): Promise<NextResponse> {
  const callId = new URL(req.url).searchParams.get("call") ?? CANONICAL_CALL_ID;
  const session = getSession(callId);
  return NextResponse.json({ transcript: session?.transcript ?? [] });
}
