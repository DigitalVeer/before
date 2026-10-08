/**
 * Voice-session credentials + configuration, per call. Refused until that
 * call's transfer gates are recorded and the interview is started — the token
 * mint itself sits behind the gates. Returns the full Deepgram Settings built
 * server-side from the session's doctor-authored brief, so the browser and
 * any test driver speak from one config source.
 */
import { NextResponse } from "next/server";
import { buildSettings } from "../../../lib/deepgram/agent-config";
import { CANONICAL_CALL_ID } from "../../../lib/medplum/codes";
import { allGatesSet, getSession } from "../../../lib/session/store";

export const dynamic = "force-dynamic";

function demoDateLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.DEMO_TIMEZONE ?? "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { callId?: string };
  const callId = body.callId ?? CANONICAL_CALL_ID;
  const session = getSession(callId);
  if (!session || session.status !== "interviewing" || !allGatesSet(session.gates)) {
    return NextResponse.json(
      { error: "Interview not started or transfer gates unset — token refused" },
      { status: 403 }
    );
  }
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "DEEPGRAM_API_KEY not configured" }, { status: 500 });
  }

  const settings = buildSettings({
    todayIsoDate: demoDateLocal(),
    brief: session.brief,
    patientFirstName: "Rosa",
    coordinatorName: "Maya",
    witnessName: session.witnessName,
    callId: session.callId,
    sourceId: session.sourceId,
    sourceRole: session.sourceRole,
  });

  // Browser sessions receive only short-lived grants. Provider credentials
  // stay server-side even when the grant request fails.
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 600 }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Unable to grant a voice session. Check the server key's grant permissions." }, { status: 503 });
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token || typeof data.access_token !== "string") {
    return NextResponse.json({ error: "Voice provider returned an invalid session grant." }, { status: 502 });
  }
  return NextResponse.json({ token: data.access_token, scheme: "bearer", settings, expiresIn: data.expires_in ?? 600 });
}
