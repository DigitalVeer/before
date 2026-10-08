/**
 * The poll the clinician screen lives on (§13.9 baseline: 1–2s query
 * refresh). Everything rendered comes from hosted Medplum reads — the snap
 * is poll-observed, never client-optimistic.
 */
import { NextResponse } from "next/server";
import { getClinicianClient } from "../../../lib/medplum/client";
import { readTimeline } from "../../../lib/medplum/queries";
import { resolveSeedServerIds } from "../../../lib/medplum/refs";
import { sessionsView } from "../../../lib/session/view";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const clinician = await getClinicianClient();
    const ids = await resolveSeedServerIds(clinician);
    const timeline = await readTimeline(clinician, ids.encounter);
    return NextResponse.json({
      timeline,
      calls: sessionsView(),
      encounterServerId: ids.encounter,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
