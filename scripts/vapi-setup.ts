/**
 * Vapi phone leg — setup and dial.
 *
 * The witness answers a real phone instead of a browser tab. Everything else
 * is unchanged: same persona and prompt, same closed function set, same
 * server validation, same Medplum writes. Deepgram stays load-bearing inside
 * Vapi — nova-3-medical transcribes, aura-2 vesta speaks.
 *
 *   pnpm tsx scripts/vapi-setup.ts assistant        # create/update the assistant
 *   pnpm tsx scripts/vapi-setup.ts call +15551234567 [spouse|daughter]
 *
 * Requires in .env.local:
 *   VAPI_PRIVATE_KEY, VAPI_PHONE_NUMBER_ID, PUBLIC_BASE_URL (tunnel), VAPI_WEBHOOK_SECRET
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { readFileSync, writeFileSync } from "node:fs";
import { AGENT_FUNCTIONS, agentGreeting, agentPrompt } from "../lib/deepgram/agent-config";
import { WITNESSES } from "../lib/medplum/refs";

const API = "https://api.vapi.ai";
const KEY = process.env.VAPI_PRIVATE_KEY ?? "";
const PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID ?? "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
const WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET ?? "";
const APP = process.env.VERIFY_BASE_URL ?? "http://localhost:3200";
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const TWILIO_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? "";

function demoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.DEMO_TIMEZONE ?? "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function vapi(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Vapi ${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

/** Our Deepgram function set, in Vapi's tool shape, pointed at our webhook. */
function toolsForVapi() {
  return AGENT_FUNCTIONS.map((fn) => ({
    type: "function" as const,
    function: { name: fn.name, description: fn.description, parameters: fn.parameters },
    server: {
      url: `${PUBLIC_BASE_URL}/api/vapi/webhook`,
      headers: WEBHOOK_SECRET ? { "x-before-secret": WEBHOOK_SECRET } : undefined,
    },
  }));
}

function assistantBody(witnessKey: "spouse" | "daughter") {
  const w = WITNESSES[witnessKey];
  const ctx = {
    todayIsoDate: demoDate(),
    brief: w.defaultBrief,
    patientFirstName: "Rosa",
    coordinatorName: "Maya",
    witnessName: w.name,
    callId: w.callId,
    sourceId: w.sourceId,
    sourceRole: w.sourceRole,
  };
  return {
    name: `Before — ${witnessKey}`,
    firstMessage: agentGreeting(ctx),
    // Deepgram medical ASR on the phone leg; the same keyterms as the browser path.
    transcriber: {
      provider: "deepgram",
      model: "nova-3-medical",
      language: "en",
      keyterm: [ctx.patientFirstName, ctx.witnessName.split(" ")[0], "stroke", "call log"],
    },
    voice: { provider: "deepgram", model: "aura-2", voiceId: "vesta" },
    model: {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.4,
      messages: [{ role: "system", content: agentPrompt(ctx) }],
      tools: toolsForVapi(),
    },
    server: {
      url: `${PUBLIC_BASE_URL}/api/vapi/webhook`,
      headers: WEBHOOK_SECRET ? { "x-before-secret": WEBHOOK_SECRET } : undefined,
    },
    serverMessages: ["transcript[transcriptType=\"final\"]", "tool-calls", "status-update", "end-of-call-report"],
    metadata: { callId: w.callId, witness: witnessKey },
    endCallFunctionEnabled: true,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
  };
}

function saveAssistantId(witnessKey: string, id: string): void {
  const key = `VAPI_ASSISTANT_ID_${witnessKey.toUpperCase()}`;
  let env = readFileSync(".env.local", "utf8");
  env = env.match(new RegExp(`^${key}=`, "m"))
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${id}`)
    : `${env.trimEnd()}\n${key}=${id}\n`;
  writeFileSync(".env.local", env);
}

async function upsertAssistants(): Promise<void> {
  if (!PUBLIC_BASE_URL.startsWith("https://")) {
    throw new Error("PUBLIC_BASE_URL must be an https tunnel URL (cloudflared/ngrok) — Vapi cannot reach localhost");
  }
  const existing = (await vapi("/assistant", "GET")) as unknown as { id: string; name: string }[];
  for (const key of ["spouse", "daughter"] as const) {
    const body = assistantBody(key);
    const found = Array.isArray(existing) ? existing.find((a) => a.name === body.name) : undefined;
    const saved = found
      ? await vapi(`/assistant/${found.id}`, "PATCH", body)
      : await vapi("/assistant", "POST", body);
    const id = saved.id as string;
    saveAssistantId(key, id);
    console.log(`${found ? "updated" : "created"} assistant "${body.name}" → ${id}`);
  }
  console.log("Assistant IDs written to .env.local");
}

/**
 * Attach an assistant to the Vapi number so a witness (or a judge) can dial
 * IN. Numbers bought on Vapi cap daily OUTBOUND calls; inbound is uncapped,
 * and a call back to the hospital's published number is a trust path the
 * design already describes (§8.2).
 */
async function attachInbound(witnessKey: "spouse" | "daughter"): Promise<void> {
  const assistantId = process.env[`VAPI_ASSISTANT_ID_${witnessKey.toUpperCase()}`];
  if (!assistantId) throw new Error(`No assistant for ${witnessKey} — run: pnpm vapi:assistant`);
  if (!PHONE_NUMBER_ID) throw new Error("VAPI_PHONE_NUMBER_ID missing from .env.local");
  const updated = await vapi(`/phone-number/${PHONE_NUMBER_ID}`, "PATCH", { assistantId });
  console.log(`Inbound answers as "${WITNESSES[witnessKey].name}" assistant → ${updated.number ?? PHONE_NUMBER_ID}`);
  console.log("Open the session and its three gates, then call that number from any phone.");
}

/**
 * Import a Twilio number into Vapi. Numbers bought on Vapi cannot place
 * outbound calls on the pay-as-you-go tier (observed 2026-08-01: zero calls
 * made, still refused) — a BYO Twilio number lifts that. Saves the new
 * phoneNumberId to .env.local so `vapi:call` starts working.
 */
async function importTwilio(witnessKey: "spouse" | "daughter"): Promise<void> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_NUMBER) {
    throw new Error(
      "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER (E.164, e.g. +16505551234) in .env.local first"
    );
  }
  const assistantId = process.env[`VAPI_ASSISTANT_ID_${witnessKey.toUpperCase()}`];
  const created = await vapi("/phone-number", "POST", {
    provider: "twilio",
    number: TWILIO_NUMBER,
    twilioAccountSid: TWILIO_SID,
    twilioAuthToken: TWILIO_TOKEN,
    name: "Before — Twilio outbound",
    assistantId,
  });
  const id = created.id as string;
  let env = readFileSync(".env.local", "utf8");
  env = env.match(/^VAPI_PHONE_NUMBER_ID=/m)
    ? env.replace(/^VAPI_PHONE_NUMBER_ID=.*$/m, `VAPI_PHONE_NUMBER_ID=${id}`)
    : `${env.trimEnd()}\nVAPI_PHONE_NUMBER_ID=${id}\n`;
  writeFileSync(".env.local", env);
  console.log(`Imported ${TWILIO_NUMBER} → phoneNumberId ${id} (saved to .env.local)`);
  console.log("Outbound now runs through Twilio: pnpm vapi:call +1XXXXXXXXXX");
}

async function placeCall(toNumber: string, witnessKey: "spouse" | "daughter"): Promise<void> {
  const assistantId = process.env[`VAPI_ASSISTANT_ID_${witnessKey.toUpperCase()}`];
  if (!assistantId) throw new Error(`No assistant for ${witnessKey} — run: pnpm tsx scripts/vapi-setup.ts assistant`);
  if (!PHONE_NUMBER_ID) throw new Error("VAPI_PHONE_NUMBER_ID missing from .env.local");

  const w = WITNESSES[witnessKey];

  // The phone leg is behind the same gates as the browser leg: refuse to dial
  // unless the coordinator has recorded all three and started the interview.
  const sessionRes = await fetch(`${APP}/api/session?call=${w.callId}`);
  const { session } = (await sessionRes.json()) as { session: { status: string } | null };
  if (!session || session.status !== "interviewing") {
    throw new Error(
      `Refusing to dial: ${w.callId} is ${session?.status ?? "not open"}. Record the three gates and press Begin AI interview first.`
    );
  }

  const call = await vapi("/call", "POST", {
    assistantId,
    phoneNumberId: PHONE_NUMBER_ID,
    customer: { number: toNumber, name: w.name },
    name: `Before collateral — ${witnessKey}`,
  });
  console.log(`Dialing ${toNumber} as ${w.name} … call ${call.id as string}`);
  console.log("Answer the phone. The clinician screen updates from the same server path as the browser demo.");
}

/**
 * Download the most recent call's server-side recording — clean audio of BOTH
 * sides of the phone call, for the demo video edit. Saved to run-evidence/.
 */
async function pullRecording(): Promise<void> {
  const calls = (await vapi("/call?limit=5", "GET")) as unknown as Array<Record<string, unknown>>;
  const withAudio = calls.find((c) => {
    const a = c.artifact as { recordingUrl?: string; stereoRecordingUrl?: string } | undefined;
    return a?.stereoRecordingUrl || a?.recordingUrl || (c as { recordingUrl?: string }).recordingUrl;
  });
  if (!withAudio) throw new Error("No call with a recording found in the last 5 calls");
  const artifact = (withAudio.artifact ?? {}) as { recordingUrl?: string; stereoRecordingUrl?: string };
  const url =
    artifact.stereoRecordingUrl ?? artifact.recordingUrl ?? (withAudio as { recordingUrl?: string }).recordingUrl!;
  const startedAt = String(withAudio.startedAt ?? "call").replace(/[:.]/g, "-");
  const out = `run-evidence/call-audio-${startedAt}.wav`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `download failed ${res.status} — recording links expire ~1h after the call. ` +
        "Pull right after recording the demo call, or download from the Vapi dashboard (Observe → Calls)."
    );
  }
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`Saved both-sides call audio → ${out}`);
  console.log("Drop it under the screen recording in the edit; align on the greeting.");
}

async function main(): Promise<void> {
  if (!KEY) throw new Error("VAPI_PRIVATE_KEY missing from .env.local");
  const [cmd, arg1, arg2] = process.argv.slice(2);
  if (cmd === "assistant") return upsertAssistants();
  if (cmd === "inbound") return attachInbound((arg1 ?? "spouse") as "spouse" | "daughter");
  if (cmd === "import-twilio") return importTwilio((arg1 ?? "spouse") as "spouse" | "daughter");
  if (cmd === "recording") return pullRecording();
  if (cmd === "call") {
    if (!arg1) throw new Error("usage: vapi-setup.ts call +1XXXXXXXXXX [spouse|daughter]");
    return placeCall(arg1, (arg2 ?? "spouse") as "spouse" | "daughter");
  }
  console.log(
    "usage:\n  vapi-setup.ts assistant\n  vapi-setup.ts inbound [spouse|daughter]\n  vapi-setup.ts import-twilio [spouse|daughter]\n  vapi-setup.ts recording\n  vapi-setup.ts call +1XXXXXXXXXX [spouse|daughter]"
  );
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
