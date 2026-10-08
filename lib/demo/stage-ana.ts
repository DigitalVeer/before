/**
 * Stage-managed second witness for the live demo.
 *
 * When enabled (DEMO_AUTOSTAGE_ANA=true), Ana's interview is executed
 * server-side from the canonical fixture transcript the first time Luis's
 * claim lands: same session gates, same deterministic validator, same agent
 * credential, same Medplum writes. Nothing on screen is painted — every
 * receipt renders from hosted resources. What is skipped is the voice leg.
 *
 * STAGE RULE (README): the presenter may say "a second interview has
 * completed in parallel" but must never claim a live human call happened for
 * Ana. The synthetic-data banner frames the whole scenario.
 */
import { validateClaim } from "../claims/validate";
import { getAgentClient, getClinicianClient } from "../medplum/client";
import { resolveSeedServerIds, WITNESSES } from "../medplum/refs";
import { writeClaimBundle } from "../medplum/writes";
import { demoDate } from "../medplum/seed";
import { appendTurn, createSession, getSession } from "../session/store";

const TURNS: { role: "assistant" | "user"; content: string }[] = [
  { role: "assistant", content: "Hello Ana, my name is Before. I'm an AI assistant with Rosa's stroke team. May I ask you a few quick questions?" },
  { role: "user", content: "Okay, yes." },
  { role: "assistant", content: "Did you personally see when Rosa's symptoms began, or did you find her with them already there?" },
  { role: "user", content: "I went to check on her and found her on the couch. Her face was drooping and her words came out all wrong. I didn't see it start." },
  { role: "assistant", content: "I'm sorry, Ana. Could you check a record, like your recent calls, for the exact time you found her?" },
  { role: "user", content: "I called my dad right after I found her. That call says 9:08 AM." },
  { role: "assistant", content: "Let me read that back: you found Rosa with symptoms already present at 9:08 this morning, her face drooping and her speech garbled, and the time comes from your phone call log. Is that correct?" },
  { role: "user", content: "Yes, that's right." },
];

export interface StageAnaResult {
  staged: boolean;
  reason?: string;
  observation?: string;
}

export async function stageAna(): Promise<StageAnaResult> {
  const w = WITNESSES.daughter;
  let session = getSession(w.callId);
  if (session && Object.keys(session.recorded).length > 0) {
    return { staged: false, reason: "already-recorded" };
  }
  if (!session) {
    session = createSession({
      callId: w.callId,
      encounterId: "stroke-code-001",
      patientId: "temporary-rosa",
      sourceId: w.sourceId,
      sourceRole: w.sourceRole,
      witnessName: w.name,
      brief: w.defaultBrief,
    });
  }
  session.gates = { disclosureBasisRecorded: true, recipientVerified: true, aiParticipationAgreed: true };
  session.status = "interviewing";
  if (session.transcript.length === 0) {
    for (const t of TURNS) appendTurn(w.callId, t);
  }

  const claim = {
    encounterId: "stroke-code-001",
    patientId: "temporary-rosa",
    callId: w.callId,
    sourceId: w.sourceId,
    sourceRole: w.sourceRole,
    eventType: "symptom-discovery",
    timeKind: "exact",
    time: `${demoDate()}T09:08:00-07:00`,
    interaction: "in-person",
    directness: "direct",
    observedDomains: ["speech", "movement"],
    anchor: { type: "phone-call-log", description: "Witness checked her outgoing calls during interview" },
    quote: "Her face was drooping and her words came out all wrong.",
    confirmation: { method: "spoken-readback", confirmed: true },
  };

  const outcome = validateClaim(claim, session);
  if (!outcome.ok) {
    return { staged: false, reason: outcome.result.reason };
  }
  const agent = await getAgentClient();
  const clinician = await getClinicianClient();
  const ids = await resolveSeedServerIds(clinician);
  const written = await writeClaimBundle(agent, outcome.claim!, session, outcome.evidence!, outcome.idempotencyKey!, {
    patientServerId: ids.patient,
    encounterServerId: ids.encounter,
    sourceServerId: ids.daughter,
  });
  session.recorded[outcome.idempotencyKey!] = written.resourceIds;
  session.status = "complete";
  session.disposition = "interview complete";
  return { staged: true, observation: written.resourceIds.observation };
}
