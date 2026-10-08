/**
 * Preflight health report for the operator console (/test). Reports whether
 * each dependency is configured and reachable. Never returns secret values —
 * only whether they are present.
 */
import { NextResponse } from "next/server";
import { getAgentClient, getClinicianClient } from "../../../lib/medplum/client";
import { resolveSeedServerIds } from "../../../lib/medplum/refs";

export const dynamic = "force-dynamic";

interface Check {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export async function GET(): Promise<NextResponse> {
  const checks: Check[] = [];

  // Medplum: both identities authenticate and the canonical case is seeded.
  try {
    const clinician = await getClinicianClient();
    const ids = await resolveSeedServerIds(clinician);
    checks.push({
      key: "medplum-seed",
      label: "Medplum reachable, Rosa case seeded",
      ok: true,
      detail: `Patient/${ids.patient.slice(0, 8)}… Encounter/${ids.encounter.slice(0, 8)}…`,
    });
  } catch (err) {
    checks.push({
      key: "medplum-seed",
      label: "Medplum reachable, Rosa case seeded",
      ok: false,
      detail: String(err).slice(0, 120),
    });
  }

  try {
    await getAgentClient();
    checks.push({
      key: "medplum-agent",
      label: "Agent credential authenticates (policy-restricted)",
      ok: true,
      detail: "distinct from the clinician credential",
    });
  } catch (err) {
    checks.push({ key: "medplum-agent", label: "Agent credential authenticates", ok: false, detail: String(err).slice(0, 120) });
  }

  checks.push({
    key: "policy-proof",
    label: "Medplum policy rejections captured",
    ok: process.env.ENABLE_MEDPLUM_POLICY_PROOF === "true",
    detail:
      process.env.ENABLE_MEDPLUM_POLICY_PROOF === "true"
        ? "run-evidence/policy-rejections.json holds real forbidden responses"
        : "flag off — do not claim Medplum enforcement on stage",
  });

  checks.push({
    key: "deepgram",
    label: "Deepgram key present (browser witness path)",
    ok: !!process.env.DEEPGRAM_API_KEY,
    detail: process.env.DEEPGRAM_API_KEY ? "/witness can mint a session" : "DEEPGRAM_API_KEY missing",
  });

  // Phone leg is optional; report it as configured / not configured.
  const publicBase = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  const vapiReady = !!(process.env.VAPI_PRIVATE_KEY && process.env.VAPI_PHONE_NUMBER_ID && publicBase);
  checks.push({
    key: "vapi-config",
    label: "Phone leg configured (optional)",
    ok: vapiReady,
    detail: vapiReady ? `tunnel ${publicBase.replace("https://", "")}` : "browser witness works without this",
  });

  if (vapiReady) {
    try {
      const res = await fetch(`${publicBase}/api/vapi/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.VAPI_WEBHOOK_SECRET ? { "x-before-secret": process.env.VAPI_WEBHOOK_SECRET } : {}),
        },
        body: JSON.stringify({ message: { type: "status-update" } }),
        signal: AbortSignal.timeout(6000),
      });
      checks.push({
        key: "tunnel",
        label: "Public tunnel reaches this server",
        ok: res.ok,
        detail: res.ok ? "Vapi can deliver transcripts and tool calls" : `webhook returned ${res.status}`,
      });
    } catch (err) {
      checks.push({
        key: "tunnel",
        label: "Public tunnel reaches this server",
        ok: false,
        detail: `${String(err).slice(0, 80)} — restart: pnpm tunnel, then update PUBLIC_BASE_URL`,
      });
    }
  }

  return NextResponse.json({ checks, at: new Date().toISOString() });
}
