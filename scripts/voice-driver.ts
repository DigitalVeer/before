/**
 * Scripted witness driver — traverses the REAL Deepgram Voice Agent path with
 * synthesized witness audio (Deepgram TTS), exactly as the browser would:
 * same server-built Settings, same transcript relay, same client-side
 * function round-trip into hosted Medplum.
 *
 * Usage: pnpm tsx scripts/voice-driver.ts [spouse|daughter]
 * Run both concurrently for the parallel-agents proof.
 *
 * The witness audio is synthetic; the stage demo uses a human witness. This
 * driver is the rehearsal + fallback evidence, not a claim of a human run.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const APP = process.env.VERIFY_BASE_URL ?? "http://localhost:3200";
const DG_URL = "wss://agent.deepgram.com/v1/agent/converse";
const DG_KEY = process.env.DEEPGRAM_API_KEY ?? "";
const SAMPLE_RATE = 24000;

const WITNESS = (process.argv[2] ?? "spouse") as "spouse" | "daughter";

interface WitnessLine {
  key: string;
  trigger: RegExp;
  text: string;
  preDelayMs: number;
  once: boolean;
  spoken?: boolean;
}

/** Order matters: earlier entries win. Confirmation and consent first. */
const LINE_SETS: Record<"spouse" | "daughter", { callId: string; voice: string; lines: WitnessLine[] }> = {
  spouse: {
    callId: "call-spouse-01",
    voice: "aura-2-apollo-en",
    lines: [
      { key: "confirm", trigger: /is that correct|is that right|to confirm/i, text: "Yes, that's correct.", preDelayMs: 600, once: false },
      { key: "consent", trigger: /may i (start|ask)|(quick|brief) questions|are you ready|when you're ready/i, text: "Yes, go ahead.", preDelayMs: 700, once: true },
      {
        key: "hearsay",
        trigger: /symptoms began|symptoms started|learn about|someone else|see when/i,
        text: "No, I didn't see it start. Our daughter called me after she found her. I had spoken with Rosa earlier in the morning.",
        preDelayMs: 800,
        once: true,
      },
      {
        key: "approx-time",
        trigger: /last time|when was the last|last (personally )?(speak|spoke|talk|see|saw|hear)|when did you.*(speak|talk|see)|most recent/i,
        text: "We talked on the phone this morning, around eight thirty.",
        preDelayMs: 800,
        once: true,
      },
      {
        key: "anchor",
        trigger: /check|recent calls|call log|call history|exact time|record/i,
        text: "One second, let me look. Okay — it says 8:32 AM.",
        preDelayMs: 2200,
        once: true,
      },
      {
        key: "baseline",
        trigger: /notice|speech|behavior|sound|seem|how did she/i,
        text: "She sounded completely normal. We talked about lunch plans.",
        preDelayMs: 800,
        once: true,
      },
      {
        key: "baseline-repeat",
        trigger: /repeat|say (that )?again|exactly what you noticed|one more time/i,
        text: "She sounded completely normal. We talked about lunch plans.",
        preDelayMs: 800,
        once: false,
      },
      {
        key: "unsure",
        trigger: /\?\s*$/,
        text: "I'm not sure, sorry.",
        preDelayMs: 900,
        once: false,
      },
    ],
  },
  daughter: {
    callId: "call-daughter-01",
    voice: "aura-2-cora-en",
    lines: [
      { key: "confirm", trigger: /is that correct|is that right|to confirm/i, text: "Yes, that's right.", preDelayMs: 600, once: false },
      { key: "consent", trigger: /may i (start|ask)|(quick|brief) questions|are you ready|when you're ready/i, text: "Okay, yes.", preDelayMs: 700, once: true },
      {
        key: "discovery",
        trigger: /symptoms began|symptoms started|learn about|someone else|see when|what happened/i,
        text: "I went to check on her and found her on the couch. Her face was drooping and her words came out all wrong. I didn't see it start — she was already like that when I walked in.",
        preDelayMs: 900,
        once: true,
      },
      {
        key: "anchor",
        trigger: /check|recent calls|call log|call history|exact time|record|outgoing/i,
        text: "Let me look at my phone. I called my dad right after I found her — that call says 9:08 AM.",
        preDelayMs: 2200,
        once: true,
      },
      {
        key: "earlier-contact",
        trigger: /last time|when was the last|before you found|earlier|before that|normal contact|most recent|how did that contact/i,
        text: "No, I hadn't spoken to her since yesterday evening. She seemed fine then.",
        preDelayMs: 800,
        once: true,
      },
      {
        key: "observed",
        trigger: /notice|speech|behavior|sound|seem|what did you see|describe/i,
        text: "Her face was drooping on one side and she couldn't get her words out.",
        preDelayMs: 800,
        once: true,
      },
      {
        key: "observed-repeat",
        trigger: /repeat|say (that )?again|exactly what you (saw|noticed)|one more time/i,
        text: "Her face was drooping on one side and she couldn't get her words out.",
        preDelayMs: 800,
        once: false,
      },
      {
        key: "unsure",
        trigger: /\?\s*$/,
        text: "I'm not sure, sorry.",
        preDelayMs: 900,
        once: false,
      },
    ],
  },
};

async function api(path: string, body?: unknown, method = "POST"): Promise<unknown> {
  const res = await fetch(`${APP}${path}`, {
    method: body === undefined && method === "GET" ? "GET" : method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json().catch(() => null);
}

async function tts(text: string, voice: string, cacheName: string): Promise<Int16Array> {
  mkdirSync("fixtures/audio", { recursive: true });
  const path = `fixtures/audio/${cacheName}.pcm`;
  if (existsSync(path)) {
    const buf = readFileSync(path);
    return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  }
  const res = await fetch(
    `https://api.deepgram.com/v1/speak?model=${voice}&encoding=linear16&sample_rate=${SAMPLE_RATE}&container=none`,
    {
      method: "POST",
      headers: { Authorization: `Token ${DG_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }
  );
  if (!res.ok) throw new Error(`TTS failed ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

interface TimelineEventShape {
  timeIso: string | null;
  eventType: string;
  receipts: unknown;
}

async function main(): Promise<void> {
  const set = LINE_SETS[WITNESS];
  if (!set) throw new Error(`unknown witness ${WITNESS}`);
  const { callId, lines } = set;
  const tag = WITNESS.toUpperCase();

  console.log(`[${tag}] preparing session (gates, start)`);
  await api("/api/session", { witness: WITNESS });
  for (const gate of ["disclosureBasisRecorded", "recipientVerified", "aiParticipationAgreed"]) {
    await api("/api/session/gates", { gate, callId });
  }
  await api("/api/session/start-interview", { callId });

  console.log(`[${tag}] synthesizing witness lines (cached)`);
  const audio = new Map<string, Int16Array>();
  for (const line of lines) audio.set(line.key, await tts(line.text, set.voice, `${WITNESS}-${line.key}`));

  const tokenRes = (await api("/api/deepgram-token", { callId })) as {
    token: string;
    scheme: string;
    settings: Record<string, unknown>;
  };
  if (!tokenRes?.token) throw new Error(`token refused: ${JSON.stringify(tokenRes)}`);

  const transcript: { role: string; content: string }[] = [];
  let claimResult: Record<string, unknown> | null = null;
  let completed = false;

  const ws = new WebSocket(DG_URL, [tokenRes.scheme, tokenRes.token]);

  let speakQueue: Int16Array | null = null;
  let speakOffset = 0;
  let pendingLine: { line: WitnessLine; at: number } | null = null;
  const FRAME = (SAMPLE_RATE / 1000) * 20;
  const silence = new Int16Array(FRAME);

  const ticker = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (pendingLine && Date.now() >= pendingLine.at) {
      speakQueue = audio.get(pendingLine.line.key) ?? null;
      speakOffset = 0;
      console.log(`[${tag}]   (speaks) ${pendingLine.line.key}`);
      pendingLine = null;
    }
    if (speakQueue) {
      const chunk = speakQueue.subarray(speakOffset, speakOffset + FRAME);
      ws.send(chunk.slice().buffer);
      speakOffset += FRAME;
      if (speakOffset >= speakQueue.length) speakQueue = null;
    } else {
      ws.send(silence.slice().buffer);
    }
  }, 20);

  function scheduleReplyTo(assistantText: string): void {
    // Never preempt an answer that is already queued or playing — the agent
    // sometimes re-asks in fragments, and cutting our own audio mid-number
    // makes the witness incoherent.
    if (pendingLine || speakQueue) return;
    for (const line of lines) {
      if (line.once && line.spoken) continue;
      if (line.trigger.test(assistantText)) {
        line.spoken = true;
        pendingLine = { line, at: Date.now() + line.preDelayMs };
        return;
      }
    }
    console.log(`[${tag}]   (silent — no line for) "${assistantText.slice(0, 80)}"`);
  }

  async function handleFunction(fn: { id: string; name: string; arguments: string }): Promise<string> {
    const args = JSON.parse(fn.arguments || "{}");
    console.log(`[${tag}]   (function) ${fn.name}`);
    if (fn.name === "recordWitnessConfirmedClaim") {
      const result = (await api("/api/claims/record", args)) as Record<string, unknown>;
      claimResult = result;
      console.log(`[${tag}]   (server) ${JSON.stringify(result).slice(0, 160)}`);
      return JSON.stringify(result);
    }
    if (fn.name === "recordUnresolvedClaim") {
      return JSON.stringify(await api("/api/claims/unresolved", args));
    }
    if (fn.name === "completeInterview") {
      completed = true;
      await api("/api/session/status", { status: "complete", reason: args.summary ?? "interview complete", callId });
      return JSON.stringify({ ok: true });
    }
    if (fn.name === "requestHuman") {
      await api("/api/session/status", { status: "handed-to-human", reason: args.reason ?? "witness asked for the coordinator", callId });
      return JSON.stringify({ ok: true, message: "Coordinator rejoining." });
    }
    return JSON.stringify({ ok: false });
  }

  ws.addEventListener("open", () => {
    console.log(`[${tag}] connected; sending server-built Settings`);
    ws.send(JSON.stringify(tokenRes.settings));
  });

  ws.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    const msg = JSON.parse(event.data) as Record<string, unknown>;
    void (async () => {
      switch (msg.type) {
        case "Welcome":
          console.log(`[${tag}] agent session live`);
          break;
        case "ConversationText": {
          const role = String(msg.role);
          const content = String(msg.content ?? "");
          transcript.push({ role, content });
          console.log(`[${tag}] ${role === "assistant" ? "BEFORE " : "WITNESS"} | ${content}`);
          await api("/api/session/transcript", { role, content, callId });
          if (role === "assistant") scheduleReplyTo(content);
          break;
        }
        case "FunctionCallRequest": {
          const fns = (msg.functions ?? []) as { id: string; name: string; arguments: string; client_side?: boolean }[];
          for (const fn of fns) {
            if (fn.client_side === false) continue;
            const content = await handleFunction(fn);
            ws.send(JSON.stringify({ type: "FunctionCallResponse", id: fn.id, name: fn.name, content }));
          }
          break;
        }
        case "Error":
          console.error(`[${tag}] deepgram error`, JSON.stringify(msg));
          break;
        default:
          break;
      }
    })();
  });

  const successForWitness = (events: TimelineEventShape[]): boolean =>
    WITNESS === "spouse"
      ? events.some((e) => e.eventType === "last-known-baseline" && e.receipts !== null)
      : events.some((e) => e.eventType === "symptom-discovery" && e.receipts !== null);

  const outcome = await new Promise<string>((resolve) => {
    const deadline = setTimeout(() => resolve("timeout"), 300_000);
    const check = setInterval(async () => {
      if (claimResult && (claimResult as { accepted?: boolean }).accepted && (completed || transcript.length > 12)) {
        const tl = (await api("/api/timeline", undefined, "GET")) as {
          timeline: { events: TimelineEventShape[] };
        };
        if (successForWitness(tl.timeline.events)) {
          clearTimeout(deadline);
          clearInterval(check);
          // Linger so the agent can finish its closing and call
          // completeInterview — the disposition lands on the clinician rail.
          const lingerStart = Date.now();
          const linger = setInterval(() => {
            if (completed || Date.now() - lingerStart > 25_000) {
              clearInterval(linger);
              resolve("success");
            }
          }, 1000);
        }
      }
    }, 1500);
    ws.addEventListener("close", () => setTimeout(() => resolve(claimResult ? "closed-after-claim" : "closed-early"), 500));
    ws.addEventListener("error", (e) => console.error(`[${tag}] ws error`, String(e)));
  });

  clearInterval(ticker);
  try {
    ws.close();
  } catch {
    /* closed */
  }

  mkdirSync("run-evidence", { recursive: true });
  writeFileSync(
    `run-evidence/voice-run-${WITNESS}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        witness: WITNESS,
        outcome,
        note: "Synthetic witness audio (Deepgram TTS) through the real Voice Agent path; human-witness rehearsal still required on stage.",
        transcript,
        claimResult,
      },
      null,
      2
    )
  );
  console.log(`\n[${tag}] OUTCOME: ${outcome} — run-evidence/voice-run-${WITNESS}.json`);
  process.exit(outcome === "success" ? 0 : 1);
}

main().catch((err) => {
  console.error(`[${WITNESS}] voice-driver failed:`, err);
  process.exit(1);
});
