/**
 * Scoped deterministic reset (§26.5): deletes only interview-tagged demo
 * resources, restores the canonical B0 state, clears in-memory sessions.
 */
import { NextResponse } from "next/server";
import { getClinicianClient } from "../../../lib/medplum/client";
import { resetDemo } from "../../../lib/medplum/seed";
import { invalidateSeedCache } from "../../../lib/medplum/refs";
import { clearSessions } from "../../../lib/session/store";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const clinician = await getClinicianClient();
    const ids = await resetDemo(clinician);
    clearSessions();
    invalidateSeedCache();
    return NextResponse.json({ reset: true, ids });
  } catch (err) {
    console.error("Reset failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
