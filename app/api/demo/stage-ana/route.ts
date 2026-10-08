/**
 * Trigger for the stage-managed second witness (see lib/demo/stage-ana.ts).
 * No-op unless DEMO_AUTOSTAGE_ANA=true. Idempotent.
 */
import { NextResponse } from "next/server";
import { stageAna } from "../../../../lib/demo/stage-ana";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  if (process.env.DEMO_AUTOSTAGE_ANA !== "true") {
    return NextResponse.json({ staged: false, reason: "disabled" });
  }
  try {
    return NextResponse.json(await stageAna());
  } catch (err) {
    return NextResponse.json({ staged: false, reason: String(err) }, { status: 500 });
  }
}
