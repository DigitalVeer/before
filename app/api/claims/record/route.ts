/**
 * recordWitnessConfirmedClaim (§14.4) — the closed, idempotent function the
 * voice agent calls. Deterministic validation (§32.5) → FHIR batch under the
 * AGENT credential → structured §14.7 result. All attempts are logged to
 * run-evidence/claims-log.jsonl (accepted and rejected alike).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { NextResponse } from "next/server";
import { validateClaim } from "../../../../lib/claims/validate";
import { getAgentClient, getClinicianClient } from "../../../../lib/medplum/client";
import { resolveSeedServerIds, witnessByCallId } from "../../../../lib/medplum/refs";
import { writeClaimBundle } from "../../../../lib/medplum/writes";
import { getSession } from "../../../../lib/session/store";

export const dynamic = "force-dynamic";

function logAttempt(entry: Record<string, unknown>): void {
  try {
    mkdirSync("run-evidence", { recursive: true });
    appendFileSync("run-evidence/claims-log.jsonl", JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // evidence logging must never break the call path
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ accepted: false, reason: "malformed-payload", nextAction: "Send valid JSON." });
  }

  const callId = (payload as { callId?: string })?.callId ?? "";
  const session = getSession(callId);
  const outcome = validateClaim(payload, session);

  if (!outcome.ok || outcome.duplicateOf) {
    logAttempt({ kind: outcome.duplicateOf ? "duplicate" : "rejected", payload, result: outcome.result });
    return NextResponse.json(outcome.result);
  }

  try {
    const agent = await getAgentClient();
    // Server IDs resolve via the clinician client (read is fine either way).
    const clinician = await getClinicianClient();
    const ids = await resolveSeedServerIds(clinician);
    const witness = witnessByCallId(session!.callId);
    const written = await writeClaimBundle(
      agent,
      outcome.claim!,
      session!,
      outcome.evidence!,
      outcome.idempotencyKey!,
      {
        patientServerId: ids.patient,
        encounterServerId: ids.encounter,
        sourceServerId: ids[witness?.seedField ?? "spouse"],
      }
    );
    session!.recorded[outcome.idempotencyKey!] = written.resourceIds;
    logAttempt({ kind: "accepted", payload, resourceIds: written.resourceIds, transcriptTurns: session!.transcript.length });
    return NextResponse.json({ accepted: true, resourceIds: written.resourceIds });
  } catch (err) {
    console.error("Medplum write failed:", err);
    logAttempt({ kind: "write-failed", payload, error: String(err) });
    return NextResponse.json({
      accepted: false,
      reason: "medplum-write-failed",
      nextAction:
        "Tell the witness the information could not be filed yet and that the coordinator will follow up. Do not re-ask the questions.",
    });
  }
}
