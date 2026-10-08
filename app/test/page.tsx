"use client";

/**
 * Operator console — pre-stage preflight and the full spine test, run from the
 * browser against the real endpoints. Same checks as scripts/verify-demo.ts,
 * clickable. Not part of the demo path; never projected.
 */
import { useCallback, useEffect, useState } from "react";

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const CANONICAL_CLAIM = {
  encounterId: "stroke-code-001",
  patientId: "temporary-rosa",
  callId: "call-spouse-01",
  sourceId: "RelatedPerson/spouse",
  sourceRole: "spouse",
  eventType: "last-known-baseline",
  timeKind: "exact",
  time: "2026-08-01T08:32:00-07:00",
  interaction: "phone",
  directness: "direct",
  observedDomains: ["speech", "behavior"],
  anchor: { type: "phone-call-log", description: "Witness checked recent calls during interview" },
  quote: "She sounded completely normal and we talked about lunch.",
  confirmation: { method: "spoken-readback", confirmed: true },
};

const TURNS = [
  ["assistant", "Did you personally see when Rosa's symptoms began, or did you learn about them afterward?"],
  ["user", "I did not see them start. Our daughter called me after she found her."],
  ["assistant", "When did you last personally speak with Rosa?"],
  ["user", "This morning, around eight-thirty."],
  ["assistant", "Can you check your recent calls for the exact time?"],
  ["user", "One second. It was 8:32 AM."],
  ["assistant", "What did you personally notice about her speech or behavior?"],
  ["user", "She sounded completely normal and we talked about lunch."],
  [
    "assistant",
    "Let me read that back: you spoke with Rosa by phone at 8:32 this morning, you personally heard normal speech and behavior, and the time comes from your phone call log. Is that correct?",
  ],
  ["user", "Yes, that is correct."],
] as const;

const ENDPOINTS: { method: string; path: string; what: string }[] = [
  { method: "GET", path: "/api/timeline", what: "What the projected screen polls every second — events, interval, review tasks, live calls" },
  { method: "GET", path: "/api/preflight", what: "Dependency health: Medplum, credentials, Deepgram, phone leg, tunnel" },
  { method: "POST", path: "/api/reset", what: "Scoped reset back to the 06:00 / 09:10 before-state" },
  { method: "POST", path: "/api/session", what: "Open a witness call: {witness:'spouse'|'daughter', brief?}" },
  { method: "POST", path: "/api/session/gates", what: "Record one transfer gate: {gate, callId} — order enforced" },
  { method: "POST", path: "/api/session/start-interview", what: "Start the interview; refuses 403 unless all three gates are set" },
  { method: "POST", path: "/api/session/transcript", what: "Relay one spoken turn: {role, content, callId}" },
  { method: "POST", path: "/api/session/status", what: "Disposition: refused / cancelled / handed-to-human / complete" },
  { method: "POST", path: "/api/claims/record", what: "recordWitnessConfirmedClaim — validated, idempotent, writes FHIR" },
  { method: "POST", path: "/api/claims/unresolved", what: "recordUnresolvedClaim — keeps an unanchored time honest" },
  { method: "POST", path: "/api/review/accept", what: "Clinician accepts under a separate credential and provenance" },
  { method: "POST", path: "/api/review/hold", what: "Leave unresolved / request another interview" },
  { method: "POST", path: "/api/deepgram-token", what: "Mints the browser voice session; refused until gates are set" },
  { method: "POST", path: "/api/vapi/webhook", what: "Phone leg: final transcripts, tool calls, call-ended dispositions" },
];

async function api(path: string, body?: unknown, method = "POST") {
  const res = await fetch(path, {
    method: body === undefined && method === "GET" ? "GET" : method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

export default function TestPage() {
  const [preflight, setPreflight] = useState<{ key: string; label: string; ok: boolean; detail: string }[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);

  const loadPreflight = useCallback(async () => {
    const { json } = await api("/api/preflight", undefined, "GET");
    setPreflight((json as { checks: typeof preflight })?.checks ?? []);
  }, []);

  useEffect(() => {
    void loadPreflight();
  }, [loadPreflight]);

  async function runSpine(): Promise<void> {
    setRunning(true);
    setResults([]);
    const out: Result[] = [];
    const push = (name: string, ok: boolean, detail: string) => {
      out.push({ name, ok, detail });
      setResults([...out]);
    };

    try {
      await api("/api/reset");
      const b0 = await api("/api/timeline", undefined, "GET");
      const t0 = (b0.json as { timeline: { events: unknown[]; interval: unknown } }).timeline;
      push("Reset restores the before-state", t0.events.length === 2 && t0.interval === null, `${t0.events.length} events, no interval`);

      await api("/api/session", { witness: "spouse" });
      const early = await api("/api/session/start-interview", { callId: "call-spouse-01" });
      push("Interview refused with gates unset", early.status === 403, `HTTP ${early.status}`);

      await api("/api/session/gates", { gate: "disclosureBasisRecorded", callId: "call-spouse-01" });
      const skip = await api("/api/session/gates", { gate: "aiParticipationAgreed", callId: "call-spouse-01" });
      push("Gates enforce their order", skip.status === 409, `HTTP ${skip.status}`);

      await api("/api/session/gates", { gate: "recipientVerified", callId: "call-spouse-01" });
      await api("/api/session/gates", { gate: "aiParticipationAgreed", callId: "call-spouse-01" });
      await api("/api/session/start-interview", { callId: "call-spouse-01" });

      const noReadback = await api("/api/claims/record", CANONICAL_CLAIM);
      push(
        "Claim refused before the read-back",
        (noReadback.json as { reason?: string })?.reason === "readback-not-observed",
        String((noReadback.json as { reason?: string })?.reason)
      );

      for (const [role, content] of TURNS) {
        await api("/api/session/transcript", { role, content, callId: "call-spouse-01" });
      }

      const accepted = await api("/api/claims/record", CANONICAL_CLAIM);
      const ids = (accepted.json as { resourceIds?: Record<string, string> })?.resourceIds;
      push("Claim accepted after the confirmed read-back", !!ids, ids ? ids.observation : String(accepted.json));

      const after = await api("/api/timeline", undefined, "GET");
      const t1 = (after.json as { timeline: { events: { timeIso: string; receipts: unknown }[]; interval: { minutes: number } | null; reviewTasks: unknown[] } }).timeline;
      push(
        "Screen shows 08:32, the interval and a review task",
        t1.events.some((e) => e.timeIso?.includes("08:32") && e.receipts) && t1.interval?.minutes === 38 && t1.reviewTasks.length > 0,
        `interval ${t1.interval?.minutes ?? "—"} min`
      );

      const dup = await api("/api/claims/record", CANONICAL_CLAIM);
      push(
        "Replay is idempotent (same resources, nothing new)",
        JSON.stringify((dup.json as { resourceIds?: unknown })?.resourceIds) === JSON.stringify(ids),
        "same resource IDs returned"
      );

      const rejects: [string, unknown, string][] = [
        ["Unconfirmed claim", { ...CANONICAL_CLAIM, confirmation: { method: "spoken-readback", confirmed: false } }, "exact-time-not-confirmed"],
        ["Exact time with no anchor", { ...CANONICAL_CLAIM, anchor: { type: "none", description: "remembered" } }, "exact-time-missing-anchor"],
        ["Time without date or zone", { ...CANONICAL_CLAIM, time: "08:32" }, "exact-time-missing-date-or-timezone"],
        ["Wrong patient", { ...CANONICAL_CLAIM, patientId: "someone-else" }, "wrong-patient-or-encounter"],
        ["Approximate sent as exact", { ...CANONICAL_CLAIM, timeKind: "approximate" }, "non-exact-time-on-confirmed-claim"],
      ];
      for (const [name, payload, reason] of rejects) {
        const r = await api("/api/claims/record", payload);
        push(`Rejected: ${name.toLowerCase()}`, (r.json as { reason?: string })?.reason === reason, String((r.json as { reason?: string })?.reason));
      }

      await api("/api/session/status", { status: "refused", reason: "console test", callId: "call-spouse-01" });
      const post = await api("/api/claims/record", CANONICAL_CLAIM);
      push(
        "Nothing files after a refusal",
        (post.json as { reason?: string })?.reason === "call-refused-or-cancelled",
        String((post.json as { reason?: string })?.reason)
      );

      await api("/api/reset");
      const end = await api("/api/timeline", undefined, "GET");
      const t2 = (end.json as { timeline: { events: unknown[] } }).timeline;
      push("Reset leaves the stage clean", t2.events.length === 2, `${t2.events.length} events`);
    } catch (err) {
      push("Runner error", false, String(err).slice(0, 160));
    }
    setRunning(false);
    void loadPreflight();
  }

  const passed = results.filter((r) => r.ok).length;

  return (
    <main className="console">
      <header>
        <h1>Before — operator console</h1>
        <p>Pre-stage checks against the running server. Not part of the demo; never project this page.</p>
      </header>

      <section>
        <div className="sec-head">
          <h2>Preflight</h2>
          <button className="btn" onClick={() => void loadPreflight()}>
            Re-check
          </button>
        </div>
        <ul className="checks">
          {preflight.map((c) => (
            <li key={c.key} className={c.ok ? "ok" : "bad"}>
              <span className="mark">{c.ok ? "✓" : "!"}</span>
              <span className="body">
                <b>{c.label}</b>
                <span className="detail">{c.detail}</span>
              </span>
            </li>
          ))}
          {preflight.length === 0 && <li className="bad"><span className="mark">…</span><span className="body">loading</span></li>}
        </ul>
      </section>

      <section>
        <div className="sec-head">
          <h2>Full spine test</h2>
          <button className="btn primary" disabled={running} onClick={() => void runSpine()}>
            {running ? "Running…" : "Run all checks"}
          </button>
        </div>
        <p className="note">
          Drives the real endpoints exactly as the voice agent does: gates, read-back, claim, snap,
          idempotency, every refusal. Ends with a clean reset. Takes about ten seconds.
        </p>
        {results.length > 0 && (
          <>
            <div className={`score ${passed === results.length ? "ok" : "bad"}`}>
              {passed} / {results.length} passing
            </div>
            <ul className="checks">
              {results.map((r) => (
                <li key={r.name} className={r.ok ? "ok" : "bad"}>
                  <span className="mark">{r.ok ? "✓" : "✗"}</span>
                  <span className="body">
                    <b>{r.name}</b>
                    <span className="detail">{r.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2>Endpoints</h2>
        <table className="eps">
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.path + e.method}>
                <td className="m">{e.method}</td>
                <td className="p">{e.path}</td>
                <td className="w">{e.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>What only a human can test</h2>
        <ul className="manual">
          <li>
            <b>Browser witness</b> — open <a href="/witness" target="_blank" rel="noreferrer">/witness</a> with a
            headset after starting an interview, and talk to it. Try refusing to check your phone; it must keep the
            time approximate rather than invent one.
          </li>
          <li>
            <b>Phone witness</b> — call your configured Vapi inbound number and play Luis through the read-back.
          </li>
          <li>
            <b>The projected screen</b> — <a href="/clinician" target="_blank" rel="noreferrer">/clinician</a> should
            move within a second of the witness saying yes.
          </li>
        </ul>
      </section>
    </main>
  );
}
