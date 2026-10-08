/**
 * "Leave unresolved" / "Request another interview" (§7.9). Both keep the
 * evidence preliminary; only the review Task state changes.
 */
import { NextResponse } from "next/server";
import { getClinicianClient } from "../../../../lib/medplum/client";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { taskId?: string; action?: string };
  if (!body.taskId || !["unresolved", "another-interview"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "taskId and action (unresolved|another-interview) required" }, { status: 400 });
  }
  try {
    const clinician = await getClinicianClient();
    const task = await clinician.readResource("Task", body.taskId.replace("Task/", ""));
    await clinician.updateResource({
      ...task,
      status: body.action === "unresolved" ? "on-hold" : "requested",
      note: [
        ...(task.note ?? []),
        {
          text:
            body.action === "unresolved"
              ? "Clinician left the evidence unresolved; claim remains preliminary."
              : "Clinician requested another collateral interview.",
        },
      ],
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
