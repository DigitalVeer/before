/** Session view model shared by the session/timeline routes. */
import { allSessions, getSession } from "./store";

export interface SessionView {
  callId: string;
  witnessName: string;
  brief: string;
  status: string;
  gates: { disclosureBasisRecorded: boolean; recipientVerified: boolean; aiParticipationAgreed: boolean };
  sourceRole: string;
  disposition: string | null;
  callPhase: string | null;
  startedAt: string;
  turnCount: number;
  lastTurns: { turnId: string; role: string; content: string }[];
}

export function sessionView(callId: string): SessionView | null {
  const s = getSession(callId);
  if (!s) return null;
  return {
    callId: s.callId,
    witnessName: s.witnessName,
    brief: s.brief,
    status: s.status,
    gates: s.gates,
    sourceRole: s.sourceRole,
    disposition: s.disposition ?? null,
    callPhase: s.callPhase ?? null,
    startedAt: s.startedAt,
    turnCount: s.transcript.length,
    lastTurns: s.transcript.slice(-6).map((t) => ({ turnId: t.turnId, role: t.role, content: t.content })),
  };
}

export function sessionsView(): SessionView[] {
  return allSessions()
    .map((s) => sessionView(s.callId))
    .filter((v): v is SessionView => v !== null);
}
