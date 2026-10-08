/**
 * End-to-end readiness check (§32.2) against the RUNNING app + hosted
 * Medplum. Drives the real HTTP endpoints — no mocked clients. Produces
 * run-evidence/verify-report.json (generated, never hand-edited).
 *
 * Covers: reset determinism (twice), headless snap (ST-01 shape), duplicate
 * idempotency, the six done-bar rejection payloads, gate refusals.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3200";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: unknown): void {
  checks.push({ name, pass, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function api(path: string, body?: unknown, method = "POST"): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined && method === "GET" ? "GET" : method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const CANONICAL = {
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

const TURNS: { role: string; content: string }[] = [
  { role: "assistant", content: "Did you personally see when Rosa's symptoms began, or did you learn about them afterward?" },
  { role: "user", content: "I did not see them start. Our daughter called me after she found her. I had spoken with Rosa earlier." },
  { role: "assistant", content: "When did you last personally speak with Rosa?" },
  { role: "user", content: "This morning, around eight-thirty." },
  { role: "assistant", content: "Can you check your recent calls for the exact time? I will wait." },
  { role: "user", content: "One second. It was 8:32 AM." },
  { role: "assistant", content: "During that call, what did you personally notice about her speech or behavior?" },
  { role: "user", content: "She sounded completely normal and we talked about lunch." },
  {
    role: "assistant",
    content:
      "To confirm: you spoke with Rosa by phone at 8:32 this morning, you personally heard normal speech and behavior, and the time comes from your phone's call log. Is that correct?",
  },
  { role: "user", content: "Yes, that is correct." },
];

interface TimelineShape {
  events: { timeIso: string; eventType: string; receipts: unknown }[];
  interval: { minutes: number } | null;
  reviewTask: { status: string } | null;
}

async function timeline(): Promise<TimelineShape> {
  const { json } = await api("/api/timeline", undefined, "GET");
  return (json as { timeline: TimelineShape }).timeline;
}

async function main(): Promise<void> {
  // 1. reset twice — identical B0 both times
  const r1 = await api("/api/reset");
  const t1 = await timeline();
  const r2 = await api("/api/reset");
  const t2 = await timeline();
  const b0Shape = (t: TimelineShape) => ({
    events: t.events.map((e) => [e.timeIso, e.eventType, e.receipts !== null]),
    interval: t.interval,
    review: t.reviewTask?.status ?? null,
  });
  record("reset-1-succeeds", r1.status === 200, r1.json);
  record("reset-2-succeeds", r2.status === 200, r2.json);
  record(
    "reset-twice-identical-B0",
    JSON.stringify(b0Shape(t1)) === JSON.stringify(b0Shape(t2)) &&
      t1.events.length === 2 &&
      t1.interval === null,
    { first: b0Shape(t1), second: b0Shape(t2) }
  );

  // 2. gate refusals
  await api("/api/session");
  const early = await api("/api/session/start-interview");
  record("interview-refused-with-gates-unset", early.status === 403, early.json);
  await api("/api/session/gates", { gate: "disclosureBasisRecorded" });
  const outOfOrder = await api("/api/session/gates", { gate: "aiParticipationAgreed" });
  record("out-of-order-gate-refused", outOfOrder.status === 409, outOfOrder.json);

  // 3. claim before read-back exists
  await api("/api/session/gates", { gate: "recipientVerified" });
  await api("/api/session/gates", { gate: "aiParticipationAgreed" });
  await api("/api/session/start-interview");
  const noReadback = await api("/api/claims/record", CANONICAL);
  const preReadbackReason = (noReadback.json as { reason?: string }).reason ?? "";
  record(
    "claim-refused-before-readback",
    (noReadback.json as { accepted: boolean }).accepted === false &&
      ["readback-not-observed", "time-not-spoken-by-witness"].includes(preReadbackReason),
    noReadback.json
  );

  // 4. headless snap (ST-01 shape)
  for (const t of TURNS) await api("/api/session/transcript", t);
  const accepted = await api("/api/claims/record", CANONICAL);
  const acceptedIds = (accepted.json as { resourceIds?: Record<string, string> }).resourceIds;
  record("claim-accepted", (accepted.json as { accepted: boolean }).accepted === true && !!acceptedIds, accepted.json);
  const t3 = await timeline();
  record(
    "poll-shows-0832-interval-review",
    t3.events.some((e) => e.timeIso?.includes("08:32") && e.receipts !== null) &&
      t3.interval?.minutes === 38 &&
      t3.reviewTask?.status === "requested",
    { events: t3.events.length, interval: t3.interval, review: t3.reviewTask }
  );

  // 5. duplicate idempotency — same IDs, nothing new
  const dup = await api("/api/claims/record", CANONICAL);
  const dupIds = (dup.json as { resourceIds?: Record<string, string> }).resourceIds;
  const t4 = await timeline();
  record(
    "duplicate-returns-original-ids-creates-nothing",
    JSON.stringify(dupIds) === JSON.stringify(acceptedIds) && t4.events.length === t3.events.length,
    { dupIds, eventCount: t4.events.length }
  );

  // 6. remaining rejection payloads against the live endpoint
  const reject = async (name: string, payload: unknown, reason: string) => {
    const res = await api("/api/claims/record", payload);
    const body = res.json as { accepted: boolean; reason?: string };
    record(`reject-${name}`, body.accepted === false && body.reason === reason, body);
  };
  await reject("unconfirmed", { ...CANONICAL, confirmation: { method: "spoken-readback", confirmed: false } }, "exact-time-not-confirmed");
  await reject("no-anchor", { ...CANONICAL, anchor: { type: "none", description: "remembered" } }, "exact-time-missing-anchor");
  await reject("no-date-tz", { ...CANONICAL, time: "08:32" }, "exact-time-missing-date-or-timezone");
  await reject("wrong-patient", { ...CANONICAL, patientId: "someone-else" }, "wrong-patient-or-encounter");
  await reject("false-precision", { ...CANONICAL, timeKind: "approximate" }, "non-exact-time-on-confirmed-claim");

  // 7. post-refusal payload
  await api("/api/session/status", { status: "refused", reason: "witness asked for the coordinator" });
  await reject("after-refusal", CANONICAL, "call-refused-or-cancelled");

  // 8. reset restores B0 exactly
  await api("/api/reset");
  const t5 = await timeline();
  record(
    "reset-after-run-restores-B0",
    t5.events.length === 2 && t5.interval === null && t5.events.every((e) => e.receipts === null),
    b0Shape(t5)
  );

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  mkdirSync("run-evidence", { recursive: true });
  writeFileSync(
    "run-evidence/verify-report.json",
    JSON.stringify({ at: new Date().toISOString(), base: BASE, passed, total: checks.length, checks }, null, 2)
  );
  if (passed !== checks.length) process.exit(1);
}

main().catch((err) => {
  console.error("verify-demo failed to run:", err);
  process.exit(1);
});
