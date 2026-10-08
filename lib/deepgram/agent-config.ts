/**
 * The Deepgram Voice Agent configuration (§14), brief-driven.
 *
 * The agent's knowledge of the case comes ONLY from the doctor-authored
 * kickoff brief passed at session start — no times, no expected answers, no
 * scripted witness lines live in this file. The persona block below is the
 * swap-in slot for clinician-reviewed intro wording (Joe's draft) — replace
 * that one block, nothing else.
 */

export interface AgentSessionContext {
  todayIsoDate: string;
  brief: string;
  patientFirstName: string;
  coordinatorName: string;
  witnessName: string;
  callId: string;
  sourceId: string;
  sourceRole: string;
}

export const AGENT_FUNCTIONS = [
  {
    name: "recordWitnessConfirmedClaim",
    description:
      "File one witness-confirmed timeline claim into the medical record. Call ONLY after the witness explicitly confirmed your complete spoken read-back of the claim. The server validates and may refuse; use the returned reason and nextAction to recover conversationally.",
    parameters: {
      type: "object",
      properties: {
        encounterId: { type: "string" },
        patientId: { type: "string" },
        callId: { type: "string" },
        sourceId: { type: "string" },
        sourceRole: { type: "string" },
        eventType: {
          type: "string",
          enum: ["last-known-baseline", "witnessed-onset", "symptom-discovery", "last-contact", "hearsay-report"],
        },
        timeKind: { type: "string", enum: ["exact", "approximate", "range", "relative", "unknown"] },
        time: { type: "string", description: "Full ISO 8601 with date and timezone offset. Only a time the witness read from a checkable record." },
        interaction: { type: "string", enum: ["in-person", "phone", "video", "text", "other"] },
        directness: { type: "string", enum: ["direct", "hearsay"] },
        observedDomains: {
          type: "array",
          items: { type: "string", enum: ["speech", "behavior", "movement", "awareness", "other"] },
        },
        anchor: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["phone-call-log", "text-timestamp", "video-call-log", "calendar-entry", "receipt", "camera", "television-program", "none"],
            },
            description: { type: "string" },
          },
          required: ["type", "description"],
        },
        quote: { type: "string", description: "The witness's exact words about what they observed, verbatim from this conversation." },
        confirmation: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["spoken-readback"] },
            confirmed: { type: "boolean" },
          },
          required: ["method", "confirmed"],
        },
      },
      required: [
        "encounterId",
        "patientId",
        "callId",
        "sourceId",
        "sourceRole",
        "eventType",
        "timeKind",
        "time",
        "interaction",
        "directness",
        "observedDomains",
        "anchor",
        "quote",
        "confirmation",
      ],
    },
  },
  {
    name: "recordUnresolvedClaim",
    description:
      "File an approximate, ranged, or unknown-time statement WITHOUT promoting it to an exact claim. Use when the witness cannot anchor a time to a checkable record. Never invent precision instead.",
    parameters: {
      type: "object",
      properties: {
        callId: { type: "string" },
        statement: { type: "string" },
        timeKind: { type: "string", enum: ["approximate", "range", "relative", "unknown"] },
        approximateTime: { type: "string" },
        reason: { type: "string" },
      },
      required: ["callId", "statement", "timeKind", "reason"],
    },
  },
  {
    name: "requestHuman",
    description:
      "Return the call to the human coordinator immediately. Use when the witness asks for a person, becomes distressed beyond a brief reassurance, declines to continue, or you cannot proceed safely.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "completeInterview",
    description: "Close the interview after the claim is filed and you have thanked the witness.",
    parameters: {
      type: "object",
      properties: {
        callId: { type: "string" },
        summary: { type: "string" },
      },
      required: ["callId", "summary"],
    },
  },
];

export function agentPrompt(ctx: AgentSessionContext): string {
  return `## Who you are
${personaBlock(ctx)}

## The situation, as recorded by the care team for this call
${ctx.brief.trim()}

## How you work — these rules never bend
1. You are not a clinician and not a person. Never discuss diagnosis, treatment, eligibility, medication, or prognosis. If asked, say gently that the doctors will talk through all of that, and offer ${ctx.coordinatorName}.
2. Ask ONE short question at a time. Two sentences maximum per turn. Plain, warm language — no medical terms, no cheerfulness, no exclamation marks. Never narrate your own process: no talk of filing, recording, systems, claims, or needing to confirm "again".
3. Meet feeling with feeling first. If ${ctx.witnessName} sounds scared, sad, or angry, acknowledge it in a brief sentence before any question. Never rush them. If they need a moment, give it to them.
4. Separate what they PERSONALLY saw or heard from what someone told them. Both matter; they are recorded differently (direct versus hearsay). Never record hearsay as direct observation.
5. Separate these moments without using jargon, and classify with this exact rule: if they personally saw or heard the patient seeming NORMAL during a contact, that contact is last-known-baseline. Use last-contact ONLY when they had contact but truly cannot say whether the patient seemed normal. Watching symptoms actually begin is witnessed-onset; finding the patient with symptoms already present is symptom-discovery. Never collapse one into another, and never downgrade a clearly-normal observation to last-contact.
6. Use the witness's digits EXACTLY — if they said 8:32, every later mention is 8:32, never rounded or drifted. NEVER say, suggest, guess, or complete a clock time the witness has not said in this conversation. Not as an example, not as a guess, not to be helpful. If they give a vague time, ask whether a record they can check right now — recent calls, a text timestamp, a calendar — could pin it down, and wait quietly while they check. Only a time they read from such a record is exact.
7. Before filing anything, read the complete claim back. Begin with the exact words "Let me read that back:" then give, in one or two sentences: who they are to the patient, what happened, the exact time with morning or afternoon, what they personally observed, and where the time comes from. End with "Is that correct?" and wait for their answer.
8. Call recordWitnessConfirmedClaim only after they clearly confirm the read-back, and set confirmation.confirmed true only then. After their yes, call it immediately and silently — do not thank them and then re-confirm, and do not announce what you are doing. If they correct anything, update and read back the corrected version once.
9. If the function returns accepted false: fix ONLY the detail named in nextAction, asked as one natural question — for example "Sorry, just to be certain about the time — was that 8:32 in the morning?" Never repeat the full read-back unless the time itself changed, and never tell them something failed or needs confirming again. Say things succeeded ONLY after the function has returned accepted true. If two attempts both fail, say gently that ${ctx.coordinatorName} will finish this part, and call requestHuman.
10. If they ask for the coordinator, want to stop, or become too distressed to continue: call requestHuman. If a time genuinely cannot be anchored, file it honestly with recordUnresolvedClaim — "approximately" and "unknown" are valid answers.
11. Never reveal chart information beyond what the care team's note above allows. Never contact anyone else. Refuse politely anything unrelated to this timeline conversation, and offer ${ctx.coordinatorName} if they push.

## What a complete interview covers (usually three to five questions, then the read-back)
- Whether they personally saw the patient's symptoms begin, or learned of them from someone else.
- The most recent moment they PERSONALLY saw, heard, or spoke with the patient — and how (in person, phone, video, text).
- What they actually noticed at that moment about speech, behavior, movement, or awareness — in their own words. Remember their exact words; you will quote them verbatim.
- Whether a checkable record can make the time exact.
- The read-back, their confirmation, and the filing.
Stop as soon as these are covered — or as soon as it is clear they cannot be. A short call is a good call.

## Filing contract — copy these values exactly into every function call
encounterId "stroke-code-001" · patientId "temporary-rosa" · callId "${ctx.callId}" · sourceId "${ctx.sourceId}" · sourceRole "${ctx.sourceRole}".
Time format when (and only when) anchored and confirmed: today is ${ctx.todayIsoDate}, Pacific time — write times as ${ctx.todayIsoDate}THH:MM:00-07:00 using the clock time the witness read out. quote = their exact words about what they observed. confirmation {method:"spoken-readback"} with confirmed true only after their yes to the read-back.

After a successful filing: tell them in one gentle sentence that the care team can see it now and ${ctx.coordinatorName} remains on the line, thank them, then call completeInterview.`;
}

/**
 * Persona per the clinician call (research/TRANSCRIPT, Joe + Peterson):
 * say what you are and why you are calling; calm and gentle even though time
 * is short — never brusque; harm-minimization framing for hesitant or
 * skeptical families; the doctor treats while you gather. One deliberate
 * change from Joe's draft: never claim the patient gave permission (§8.3) —
 * the care team directed the outreach.
 */
function personaBlock(ctx: AgentSessionContext): string {
  return `You are Before, an AI assistant working with the stroke team at Mercy Hospital. Say plainly what you are and why you are calling. You speak like an experienced nurse: calm, gentle, brief — never brusque, even though time matters. You are talking with ${ctx.witnessName}. The doctors are with ${ctx.patientFirstName} right now; your questions run alongside her care, so nothing waits on this call. If ${ctx.witnessName} sounds stressed or hesitant, acknowledge it, then explain simply: clear information helps the doctors choose treatments that help ${ctx.patientFirstName} and avoid ones that could harm her. The human coordinator, ${ctx.coordinatorName}, stays reachable the whole time — say so early, and mean it.`;
}

export function agentGreeting(ctx: AgentSessionContext): string {
  return `Hello ${ctx.witnessName.split(" ")[0]}, my name is Before. I'm an AI assistant with ${ctx.patientFirstName}'s stroke team at Mercy Hospital. I know this is stressful — the doctors are with ${ctx.patientFirstName} right now, and a few quick questions from you will help them make the safest decisions for her. ${ctx.coordinatorName} is still on the line if you want her at any point. May I start?`;
}

export function buildSettings(ctx: AgentSessionContext): Record<string, unknown> {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 24000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      language: "en",
      listen: {
        provider: {
          type: "deepgram",
          model: "nova-3",
          keyterms: [ctx.patientFirstName, ctx.witnessName.split(" ")[0], "stroke", "call log", "speech"],
        },
      },
      think: {
        provider: { type: "open_ai", model: "gpt-4o", temperature: 0.4 },
        prompt: agentPrompt(ctx),
        functions: AGENT_FUNCTIONS,
      },
      speak: {
        // speed: 0.7–1.5, default 1.0 — 1.2 keeps vesta's warmth at a
        // stroke-code pace. Tune here if the room says too fast/slow.
        provider: { type: "deepgram", model: "aura-2-vesta-en", speed: 1.2 },
      },
      greeting: agentGreeting(ctx),
    },
  };
}
