/**
 * Vapi server webhook — the phone leg of the witness call.
 *
 * Vapi carries audio over PSTN with Deepgram nova-3-medical transcription and
 * an aura-2 voice; this endpoint is the same Before server the browser path
 * talks to. Transcript turns land in the session store (so the read-back gate
 * stays server-observable) and tool calls route into the identical validated
 * claim path. Nothing here bypasses the gates or the validator.
 */
import { NextResponse } from "next/server";
import { CANONICAL_CALL_ID } from "../../../../lib/medplum/codes";
import { appendTurn, getSession, setTranscript } from "../../../../lib/session/store";

export const dynamic = "force-dynamic";

interface VapiToolCall {
  id: string;
  name?: string;
  arguments?: Record<string, unknown> | string;
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

interface VapiArtifactMessage {
  role?: string;
  message?: string;
  content?: string;
}

interface VapiMessage {
  type?: string;
  role?: string;
  transcript?: string;
  transcriptType?: string;
  status?: string;
  endedReason?: string;
  toolCallList?: VapiToolCall[];
  artifact?: { messages?: VapiArtifactMessage[]; messagesOpenAIFormatted?: VapiArtifactMessage[] };
  call?: { metadata?: Record<string, unknown>; assistantOverrides?: { variableValues?: Record<string, unknown> } };
}

/**
 * Rebuild the session transcript from the webhook's own conversation record.
 * Tool-call webhooks can arrive before the final user transcript relays, and
 * an app restart wipes in-memory turns mid-call — the artifact is Vapi's
 * authoritative history, so syncing from it makes the read-back and origin
 * gates race-proof on the phone path.
 */
function syncTranscriptFromArtifact(callId: string, message: VapiMessage): void {
  const raw = message.artifact?.messages ?? message.artifact?.messagesOpenAIFormatted ?? [];
  const turns: { role: "assistant" | "user"; content: string }[] = [];
  for (const m of raw) {
    const role = m.role === "bot" || m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
    const content = (m.message ?? m.content ?? "").trim();
    if (role && content) turns.push({ role, content });
  }
  if (turns.length > 0) setTranscript(callId, turns);
}

function resolveCallId(message: VapiMessage): string {
  const meta = message.call?.metadata as { callId?: string } | undefined;
  const vars = message.call?.assistantOverrides?.variableValues as { callId?: string } | undefined;
  return meta?.callId ?? vars?.callId ?? CANONICAL_CALL_ID;
}

function toolName(tc: VapiToolCall): string {
  return tc.name ?? tc.function?.name ?? "";
}

function toolArgs(tc: VapiToolCall): Record<string, unknown> {
  const raw = tc.arguments ?? tc.function?.arguments ?? {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

async function callSelf(path: string, body: unknown): Promise<unknown> {
  const base = process.env.SELF_BASE_URL ?? "http://localhost:3200";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ accepted: false, reason: "server-error" }));
}

export async function POST(req: Request): Promise<NextResponse> {
  // Shared-secret check: the webhook is publicly reachable through the tunnel.
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (expected && req.headers.get("x-before-secret") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { message?: VapiMessage };
  const message = body.message ?? {};
  const callId = resolveCallId(message);

  switch (message.type) {
    case "transcript": {
      // Only final transcripts become evidence-bearing turns.
      if (message.transcriptType !== "final" || !message.transcript) break;
      const role = message.role === "assistant" ? "assistant" : "user";
      if (getSession(callId)) appendTurn(callId, { role, content: message.transcript });
      break;
    }

    case "tool-calls": {
      syncTranscriptFromArtifact(callId, message);
      const results = [];
      for (const tc of message.toolCallList ?? []) {
        const name = toolName(tc);
        const args = toolArgs(tc);
        let result: unknown;
        if (name === "recordWitnessConfirmedClaim") {
          result = await callSelf("/api/claims/record", { ...args, callId });
        } else if (name === "recordUnresolvedClaim") {
          result = await callSelf("/api/claims/unresolved", { ...args, callId });
        } else if (name === "requestHuman") {
          await callSelf("/api/session/status", {
            status: "handed-to-human",
            reason: (args.reason as string) ?? "witness asked for the coordinator",
            callId,
          });
          result = { ok: true, message: "The coordinator is rejoining. Say a brief goodbye." };
        } else if (name === "completeInterview") {
          await callSelf("/api/session/status", {
            status: "complete",
            reason: (args.summary as string) ?? "interview complete",
            callId,
          });
          result = { ok: true };
        } else {
          result = { ok: false, error: `unknown tool ${name}` };
        }
        results.push({ toolCallId: tc.id, result: JSON.stringify(result) });
      }
      return NextResponse.json({ results });
    }

    case "status-update":
    case "end-of-call-report": {
      const session = getSession(callId);
      if (session && message.status && message.status !== "ended") {
        session.callPhase = message.status;
      }
      if (session && message.status === "ended") {
        session.callPhase = undefined;
      }
      if (session && session.status === "interviewing" && message.status === "ended") {
        await callSelf("/api/session/status", {
          status: "handed-to-human",
          reason: `phone call ended (${message.endedReason ?? "unknown"})`,
          callId,
        });
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ ok: true });
}
