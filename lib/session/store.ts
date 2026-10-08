/**
 * Ephemeral interview-session state (§13.10): active-call state lives in
 * memory; durable clinical state lives in Medplum. Survives Next.js HMR via
 * globalThis.
 */
import type { ClaimResult } from "../claims/schema";

export interface TranscriptTurn {
  turnId: string;
  role: "assistant" | "user";
  content: string;
  at: string;
}

export interface TransferGates {
  disclosureBasisRecorded: boolean;
  recipientVerified: boolean;
  aiParticipationAgreed: boolean;
}

export type SessionStatus =
  | "ready"
  | "interviewing"
  | "refused"
  | "cancelled"
  | "handed-to-human"
  | "complete";

export interface InterviewSession {
  callId: string;
  encounterId: string;
  patientId: string;
  sourceId: string;
  sourceRole: string;
  witnessName: string;
  brief: string;
  status: SessionStatus;
  gates: TransferGates;
  transcript: TranscriptTurn[];
  /** idempotencyKey → resource IDs already written for that claim (§16). */
  recorded: Record<string, NonNullable<ClaimResult["resourceIds"]>>;
  communicationId?: string;
  disposition?: string;
  /** Phone-leg live phase from Vapi status updates: ringing | in-progress. */
  callPhase?: string;
  startedAt: string;
}

const g = globalThis as unknown as { __beforeSessions?: Map<string, InterviewSession> };
const sessions: Map<string, InterviewSession> = (g.__beforeSessions ??= new Map());

export function createSession(input: {
  callId: string;
  encounterId: string;
  patientId: string;
  sourceId: string;
  sourceRole: string;
  witnessName: string;
  brief: string;
  communicationId?: string;
}): InterviewSession {
  const session: InterviewSession = {
    ...input,
    status: "ready",
    gates: {
      disclosureBasisRecorded: false,
      recipientVerified: false,
      aiParticipationAgreed: false,
    },
    transcript: [],
    recorded: {},
    startedAt: new Date().toISOString(),
  };
  sessions.set(session.callId, session);
  return session;
}

export function getSession(callId: string): InterviewSession | undefined {
  return sessions.get(callId);
}

export function allSessions(): InterviewSession[] {
  return [...sessions.values()];
}

export function allGatesSet(gates: TransferGates): boolean {
  return gates.disclosureBasisRecorded && gates.recipientVerified && gates.aiParticipationAgreed;
}

export function appendTurn(callId: string, turn: Omit<TranscriptTurn, "turnId" | "at">): TranscriptTurn | undefined {
  const s = sessions.get(callId);
  if (!s) return undefined;
  const full: TranscriptTurn = {
    ...turn,
    turnId: `${turn.role}-turn-${String(s.transcript.length + 1).padStart(2, "0")}`,
    at: new Date().toISOString(),
  };
  s.transcript.push(full);
  return full;
}

/** Replace a session's transcript from an authoritative source (Vapi artifact). */
export function setTranscript(
  callId: string,
  turns: { role: "assistant" | "user"; content: string }[]
): void {
  const s = sessions.get(callId);
  if (!s) return;
  s.transcript = turns.map((t, i) => ({
    turnId: `${t.role}-turn-${String(i + 1).padStart(2, "0")}`,
    role: t.role,
    content: t.content,
    at: new Date().toISOString(),
  }));
}

export function clearSessions(): void {
  sessions.clear();
}
