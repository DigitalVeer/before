"use client";

/**
 * The projected stroke-code screen (DEMO.md). The timeline is the hero.
 *
 * This module holds only presentation. It takes a timeline payload and a `post`
 * function, so the live page can drive it from Medplum polls while a screenshot
 * harness can drive it from a fixture. Motion happens only when the caller
 * reports that chart state changed.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { layoutEvents, type CardGroup, type LayoutMetrics } from "../../lib/timeline/layout";
import Link from "next/link";
import { Icon } from "../components/icons";

export interface Receipts {
  sourceLinked: boolean;
  witnessConfirmed: boolean;
  preliminary: boolean;
  decisionPending: boolean;
}

export interface EventView {
  id: string;
  eventType: string;
  timeIso: string | null;
  label: string;
  sourceLine: string;
  noteText: string;
  flags: string[];
  direct: boolean;
  anchored: boolean;
  confirmed: boolean;
  preliminary: boolean;
  acceptedBy: string | null;
  receipts: Receipts | null;
  evidence: {
    quote: string;
    anchorDescription: string;
    fieldEvidence: { field: string; turnId: string; quote: string }[];
    observationId: string;
    questionnaireResponseId: string | null;
    transcriptReference: string | null;
  } | null;
}

export interface IntervalView {
  startIso: string;
  endIso: string;
  minutes: number;
}

export interface ReviewTaskView {
  id: string;
  status: string;
  description: string;
  focusObservation: string | null;
}

export interface CallView {
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

export interface TimelinePayload {
  timeline: {
    events: EventView[];
    interval: IntervalView | null;
    reviewTask: ReviewTaskView | null;
    reviewTasks: ReviewTaskView[];
    acceptedObservationId: string | null;
  };
  calls: CallView[];
}

export type Post = (path: string, body?: unknown) => Promise<Response>;

/** The two interviewable witnesses (labels only — briefs come from the server). */
const WITNESS_CARDS = [
  {
    key: "spouse",
    callId: "call-spouse-01",
    name: "Luis M.",
    relation: "spouse",
    line: "Spoke with Rosa this morning · mobile on file",
  },
  {
    key: "daughter",
    callId: "call-daughter-01",
    name: "Ana M.",
    relation: "daughter",
    line: "Found Rosa · account in chart only via EMS",
  },
] as const;

const DISCLOSURE_SCRIPT =
  "“We're treating Rosa for possible stroke. Our assistant Before can ask a few urgent questions — answers may enter her record. You may decline and speak only with me. Comfortable continuing?”";

/** Timeline x-scale: 05:30 → 09:45 local. */
const SCALE_START = 5.5;
const SCALE_END = 9.75;

/**
 * Card geometry. The stylesheet reads these through inline styles, so the
 * numbers that decide collisions live in one place.
 */
const CARD: Omit<LayoutMetrics, "canvasWidth"> = {
  cardWidth: 236,
  gutter: 12,
  corridor: 20,
};

function hourOf(iso: string | null): number | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

function xPct(iso: string | null): number {
  const h = hourOf(iso);
  if (h === null) return 50;
  return Math.min(97, Math.max(3, ((h - SCALE_START) / (SCALE_END - SCALE_START)) * 100));
}

/** Elapsed vs the synthetic 12:30 PM demo clock (§12.4: exact + relative). */
function agoLabel(iso: string | null): string | null {
  const h = hourOf(iso);
  if (h === null) return null;
  const mins = Math.round((12.5 - h) * 60);
  if (mins <= 0) return null;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} m ago`;
}

function clockLabel(iso: string | null): string {
  const h = hourOf(iso);
  if (h === null) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh > 12 ? hh - 12 : hh}:${String(mm).padStart(2, "0")}`;
}

function isClaim(ev: EventView): boolean {
  return ev.receipts !== null;
}

function isAbove(ev: EventView): boolean {
  return ev.eventType === "last-known-baseline";
}

/** Track the plot width so card collisions are decided in real pixels. */
function useCanvasWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function ClinicianScreen(props: {
  data: TimelinePayload | null;
  enteringIds: Set<string>;
  intervalEntering: boolean;
  post: Post;
  refresh: () => Promise<void>;
  mode?: "live" | "replay";
  aside?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { data, enteringIds, intervalEntering, post, refresh, mode = "live", aside, footer } = props;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [canvasRef, canvasWidth] = useCanvasWidth();

  function say(msg: string): void {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  const events = data?.timeline.events ?? [];
  const interval = data?.timeline.interval ?? null;
  const reviewTasks = data?.timeline.reviewTasks ?? [];
  const calls = data?.calls ?? [];
  const claims = events.filter(isClaim);
  const baselineEvents = events.filter((e) => e.eventType === "last-known-baseline");
  const latestBaseline = baselineEvents[baselineEvents.length - 1] ?? null;
  const symptomEvents = events.filter(
    (e) => e.eventType === "symptom-discovery" || e.eventType === "witnessed-onset"
  );
  const earliestSymptom = symptomEvents[0] ?? null;
  const baselineClaims = claims.filter((e) => isAbove(e) && e.direct && e.anchored);
  const latestBaselineClaim = baselineClaims[baselineClaims.length - 1] ?? null;
  const drawerClaim = claims.find((claim) => claim.id === selectedId) ?? claims[0] ?? null;

  function inspect(id: string): void {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  /* The window the new evidence replaced. Rendered under the interval bar, so
     the amber still showing is exactly the span that is no longer in play —
     the collapse the demo exists to produce, drawn instead of described. */
  const priorBaseline = baselineEvents[0] ?? null;
  const supersededFrom =
    interval && priorBaseline && latestBaselineClaim && priorBaseline.id !== latestBaselineClaim.id
      ? priorBaseline.timeIso
      : null;
  const narrowedBy =
    supersededFrom !== null
      ? Math.round(((hourOf(interval!.startIso) ?? 0) - (hourOf(supersededFrom) ?? 0)) * 60)
      : 0;

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const groups = useMemo(
    () =>
      canvasWidth === 0
        ? []
        : layoutEvents(
            events.map((e) => ({ id: e.id, side: isAbove(e) ? "above" : "below", xPct: xPct(e.timeIso) })),
            { ...CARD, canvasWidth }
          ),
    [events, canvasWidth]
  );

  return (
    <div className={`frame ${mode === "replay" ? "replay-frame" : "live-frame"}`}>
      <header className="banner product">
        <Link href="/" className="wordmark" aria-label="Before home">
          <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
            <line x1="1" y1="6" x2="25" y2="6" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
            <circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="19" cy="6" r="3.2" fill="currentColor" />
          </svg>
          Before
        </Link>
        <span className="b-divider" />
        <span className="b-patient">
          <span className="b-name">Rosa M.</span>
          <span className="b-mrn">Temp MRN TEMP-4471</span>
        </span>
        <span className="pill code">Stroke code · active</span>
        <span className="b-divider" />
        <span className="b-place">
          Mercy Hospital · Emergency Dept · <b>Bay 4</b>
        </span>
        <span className="spacer" />
        <span className="b-meta">Synthetic clock 12:30 PM PT</span>
        <span className="pill neuro dark">
          <span className="dot" /> Neurologist: with patient
        </span>
        <span className="pill synthetic dark">Synthetic demo data</span>
      </header>

      <div className="main">
        <section className="stage">
          <div className="establishing">
            <span className={`est-slot ${latestBaseline && latestBaseline.direct && latestBaseline.anchored ? "firm" : "soft"}`}>
              <span className="est-what">Last known well</span>
              <span className="est-value">
                {latestBaseline ? clockLabel(latestBaseline.timeIso) : "—"}
                <span className="est-basis">
                  {latestBaseline
                    ? latestBaseline.direct && latestBaseline.anchored
                      ? "direct · anchored"
                      : "relayed · unanchored"
                    : "unknown"}
                </span>
                {latestBaseline && agoLabel(latestBaseline.timeIso) && (
                  <span className="est-ago">{agoLabel(latestBaseline.timeIso)}</span>
                )}
              </span>
            </span>
            <span className="est-arrow">→</span>
            <span className={`est-slot ${earliestSymptom && earliestSymptom.direct ? "firm" : "soft"}`}>
              <span className="est-what">Symptoms discovered</span>
              <span className="est-value">
                {earliestSymptom ? clockLabel(earliestSymptom.timeIso) : "—"}
                <span className="est-basis">
                  {earliestSymptom ? (earliestSymptom.direct ? "direct account" : "relayed via EMS") : "unknown"}
                </span>
              </span>
            </span>
            {interval && (
              <span className="est-gap">{interval.minutes} min window</span>
            )}
          </div>
          {!latestBaselineClaim ? (
            <div className="headline">
              <h1 className="h-title">
                <span className="state-dot amber" /> Clinical time unresolved
              </h1>
              <div className="h-sub">
                Baseline is relayed and unanchored; the 09:10 &ldquo;onset&rdquo; is EMS wording for{" "}
                <b>found with symptoms</b>.
              </div>
            </div>
          ) : (
            <div className="headline">
              <h1 className="h-title">
                <span className="state-dot firm" /> A clearer timeline. A traceable source.
              </h1>
              <div className="h-shift">
                Latest source-linked baseline: 06:00{" "}
                <span className="arrow">→ {clockLabel(latestBaselineClaim.timeIso)}</span>
                <span className="h-note"> · Time evidence changed — clinician review required</span>
              </div>
            </div>
          )}

          <div className="timeline-region" aria-label="Timeline of baseline and symptom discovery">
            <div className="mobile-timeline">
              {interval && <div className="mobile-interval"><b>{interval.minutes}-minute interval</b><span>Direct baseline to symptom discovery</span></div>}
              {events.map((ev) => <EventCard key={ev.id} ev={ev} entering={enteringIds.has(ev.id)} leader={{ kind: "stem", offset: 0 }} onInspect={inspect} />)}
            </div>
            <div className="tl-canvas" ref={canvasRef}>
              <div className="tl-axis" />
              {[6, 7, 8, 9].map((h) => (
                <div key={h}>
                  <div className="tl-hour" style={{ left: `${xPct(`T0${h}:00`)}%` }} />
                  <div className="tl-tick-label" style={{ left: `${xPct(`T0${h}:00`)}%` }}>
                    {h}:00 AM
                  </div>
                </div>
              ))}

              {interval && supersededFrom && narrowedBy > 0 && (
                <>
                  <div
                    className={`superseded ${intervalEntering ? "entering" : ""}`}
                    style={{
                      left: `${xPct(supersededFrom)}%`,
                      width: `${xPct(interval.endIso) - xPct(supersededFrom)}%`,
                    }}
                  />
                  <div
                    className={`superseded-label ${intervalEntering ? "entering" : ""}`}
                    style={{ left: `${(xPct(supersededFrom) + xPct(interval.startIso)) / 2}%` }}
                  >
                    narrowed by {narrowedBy} min
                  </div>
                </>
              )}

              {interval && (
                <>
                  <div
                    className={`interval ${intervalEntering ? "entering" : ""}`}
                    style={{
                      left: `${xPct(interval.startIso)}%`,
                      width: `${xPct(interval.endIso) - xPct(interval.startIso)}%`,
                    }}
                  />
                  <div
                    className={`interval-label ${intervalEntering ? "entering" : ""}`}
                    style={{ left: `${Math.max(16, Math.min(82, (xPct(interval.startIso) + xPct(interval.endIso)) / 2))}%` }}
                  >
                    {interval.minutes}-minute interval <span className="il-sub">baseline → discovery</span>
                  </div>
                </>
              )}

              {events.map((ev) => (
                <div
                  key={`tick-${ev.id}`}
                  className={`tl-tick ${isClaim(ev) ? "claim" : "amber"} ${enteringIds.has(ev.id) ? "entering" : ""}`}
                  style={{ left: `${xPct(ev.timeIso)}%` }}
                />
              ))}

              {groups.map((group) => (
                <EventStack
                  key={group.key}
                  group={group}
                  byId={byId}
                  enteringIds={enteringIds}
                  onInspect={inspect}
                />
              ))}
            </div>
          </div>
        </section>

        <aside className="rail">
          {aside ?? <>
          <ReviewCard claims={claims} reviewTasks={reviewTasks} onAction={say} post={post} refresh={refresh} />
          <h2>Collateral calls</h2>
          {WITNESS_CARDS.map((w) => (
            <WitnessCallCard
              key={w.key}
              def={w}
              call={calls.find((c) => c.callId === w.callId) ?? null}
              onAction={say}
              post={post}
              refresh={refresh}
            />
          ))}
          </>}
        </aside>
      </div>

      {footer ?? <CallDock calls={calls} />}
      <EvidenceDrawer claims={claims} claim={drawerClaim} onSelect={setSelectedId} open={drawerOpen} setOpen={setDrawerOpen} mode={mode} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/**
 * One slot of the timeline. A lone event gets a card centred on its tick. Close
 * events share a stack: a flex column keeps them apart vertically, and a leader
 * spine in the empty corridor ties each card back to its own tick.
 */
function EventStack(props: {
  group: CardGroup;
  byId: Map<string, EventView>;
  enteringIds: Set<string>;
  onInspect: (id: string) => void;
}) {
  const { group, byId, enteringIds, onInspect } = props;
  const members = group.members.map((m) => ({ ...m, ev: byId.get(m.id) })).filter((m) => m.ev);

  return (
    <div
      className={`ev-stack ${group.side} ${group.stacked ? "stacked" : ""}`}
      style={{ left: group.left, width: CARD.cardWidth }}
    >
      {group.stacked && (
        <span className="spine" style={{ left: group.spineX - group.left }} aria-hidden />
      )}
      {members.map(({ id, tickX, ev }) => (
        <EventCard
          key={id}
          ev={ev as EventView}
          entering={enteringIds.has(id)}
          onInspect={onInspect}
          leader={
            group.stacked
              ? { kind: "elbow", side: group.leaderSide, length: CARD.corridor }
              : { kind: "stem", offset: tickX - group.left }
          }
        />
      ))}
    </div>
  );
}

function CallDock({ calls }: { calls: CallView[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (calls.length === 0) return null;

  function phase(c: CallView): { label: string; cls: string; timed: boolean } {
    if (c.status === "interviewing") {
      if (c.callPhase === "ringing") return { label: "Ringing", cls: "ring", timed: false };
      if (c.turnCount === 0 && !c.callPhase) return { label: "Connecting", cls: "ring", timed: false };
      return { label: "Live", cls: "live", timed: true };
    }
    if (c.status === "complete") return { label: "Complete", cls: "done", timed: false };
    if (c.status === "handed-to-human") return { label: "With coordinator", cls: "hand", timed: false };
    if (c.status === "refused") return { label: "Declined", cls: "hand", timed: false };
    return { label: "Preparing", cls: "prep", timed: false };
  }

  function elapsed(c: CallView): string {
    const secs = Math.max(0, Math.floor((now - Date.parse(c.startedAt)) / 1000));
    const m = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, "0");
    return `${m}:${ss}`;
  }

  return (
    <div className="call-dock">
      <span className="cd-label">Calls</span>
      {calls.map((c) => {
        const p = phase(c);
        const lastLine = c.lastTurns[c.lastTurns.length - 1];
        return (
          <div key={c.callId} className={`cd-tile ${p.cls}`}>
            <span className="cd-dot" />
            <span className="cd-who">
              <b>{c.witnessName}</b>
              <span className="cd-role">{c.sourceRole}</span>
            </span>
            <span className="cd-status">{p.label}</span>
            {p.timed && <span className="cd-time">{elapsed(c)}</span>}
            {p.cls === "live" && lastLine && (
              <span className="cd-snippet">
                {lastLine.role === "assistant" ? "Before: " : ""}
                {lastLine.content}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

type Leader =
  | { kind: "stem"; offset: number }
  | { kind: "elbow"; side: "left" | "right"; length: number };

/**
 * Card copy in three tiers. `what` is the substance a clinician reads to judge
 * the time; `provenance` is where it came from. `key` names the phrase inside
 * `what` that the whole case turns on — "onset" reported, but the narrative
 * says found with symptoms — so it can carry weight instead of hiding in a
 * dot-separated run.
 */
type CardCopy = { label: string; what: string; key?: string; provenance: string };

function emphasize(what: string, key?: string): React.ReactNode {
  if (!key) return what;
  const at = what.indexOf(key);
  if (at < 0) return what;
  return (
    <>
      {what.slice(0, at)}
      <em>{key}</em>
      {what.slice(at + key.length)}
    </>
  );
}

function EventCard(props: { ev: EventView; entering: boolean; leader: Leader; onInspect: (id: string) => void }) {
  const { ev, entering, leader, onInspect } = props;
  const claim = isClaim(ev);
  const above = isAbove(ev);
  const marker = above ? (claim && ev.direct && ev.anchored ? "●" : "?") : claim ? "◆" : "◇";
  const discovery: CardCopy = {
    label: "Symptoms discovered",
    what: "Reported as “onset” — EMS narrative says found with symptoms",
    key: "found with symptoms",
    provenance: "relayed · onset unwitnessed",
  };
  const labels: Record<string, CardCopy> = {
    "last-known-baseline": claim
      ? {
          label: "Direct baseline",
          what: "Normal speech and behavior",
          key: "Normal speech and behavior",
          provenance: "phone call · log-checked",
        }
      : {
          label: "Relayed baseline",
          what: "“Last seen normal”",
          key: "“Last seen normal”",
          provenance: "daughter via EMS · no source quote",
        },
    "symptom-discovery": claim
      ? {
          label: "Symptoms found — direct",
          what: "Found with symptoms present",
          key: "Found with symptoms present",
          provenance: "direct account · call-log anchored",
        }
      : discovery,
    "witnessed-onset": discovery,
    "last-contact": {
      label: "Contact — baseline not established",
      what: "Spoke, but how the patient seemed is unconfirmed",
      key: "how the patient seemed is unconfirmed",
      provenance: "contact only",
    },
    "hearsay-report": {
      label: "Secondhand report",
      what: "Relayed by another person",
      provenance: "not a direct observation",
    },
  };
  const copy = labels[ev.eventType] ?? {
    label: "Timeline event",
    what: ev.noteText.slice(0, 60),
    provenance: ev.sourceLine,
  };

  return (
    <article className={`ev ${above ? "above" : "below"} ${claim ? "claim" : "amber"} ${entering ? "entering" : ""}`}>
      {leader.kind === "stem" ? (
        <span className="connector" style={{ left: leader.offset }} aria-hidden />
      ) : (
        <span className={`connector elbow ${leader.side}`} style={{ width: leader.length }} aria-hidden />
      )}
      <div className="ev-time">
        <span className="marker">{marker}</span>
        {clockLabel(ev.timeIso)}
      </div>
      <div className="ev-label">{copy.label}</div>
      <div className="ev-what">{emphasize(copy.what, copy.key)}</div>
      <div className="ev-prov">{copy.provenance}</div>
      {ev.receipts && (
        <div className="chiprow">
          <span className={`chip ${ev.receipts.sourceLinked ? "on" : "warn"}`}>Source linked</span>
          <span className={`chip ${ev.receipts.witnessConfirmed ? "on" : "warn"}`}>Witness confirmed</span>
          <span className={`chip ${ev.receipts.preliminary ? "warn" : "ok"}`}>
            {ev.receipts.preliminary ? "Preliminary" : "Accepted"}
          </span>
          {ev.acceptedBy ? (
            <span className="chip ok">Accepted — {ev.acceptedBy.split(",")[0]}</span>
          ) : (
            <span className={`chip ${ev.receipts.decisionPending ? "warn" : "ok"}`}>Clinician decision pending</span>
          )}
        </div>
      )}
      {!ev.receipts && above && (
        <div className="chiprow">
          <span className="chip warn">No direct quote</span>
          <span className="chip warn">Unanchored</span>
        </div>
      )}
      {!ev.receipts && !above && (
        <div className="chiprow">
          <span className="chip warn">Onset vs discovery unresolved</span>
        </div>
      )}
      {ev.evidence && <button className="evidence-link" onClick={() => onInspect(ev.id)}>Inspect evidence <Icon name="arrow" size={14} /></button>}
    </article>
  );
}

function ReviewCard(props: {
  claims: EventView[];
  reviewTasks: ReviewTaskView[];
  onAction: (msg: string) => void;
  post: Post;
  refresh: () => Promise<void>;
}) {
  const { claims, reviewTasks, onAction, post, refresh } = props;
  const [busy, setBusy] = useState(false);
  if (claims.length === 0) return null;

  const openStatuses = ["requested", "received", "accepted", "in-progress"];
  const taskFor = (claim: EventView): ReviewTaskView | undefined =>
    reviewTasks.find((t) => t.focusObservation === claim.evidence?.observationId);
  const anyOpen = claims.some((c) => {
    const t = taskFor(c);
    return !c.acceptedBy && t && openStatuses.includes(t.status);
  });
  const latestOpenTask = reviewTasks.find((t) => openStatuses.includes(t.status));

  async function act(fn: () => Promise<Response>, okMsg: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        onAction(body.error ?? `Refused (${res.status})`);
      } else {
        onAction(okMsg);
        await refresh();
      }
    } catch {
      onAction("Connection failed. Try the action again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card review-card">
      <div className="c-title">Time evidence changed — clinician review required</div>

      {claims.map((claim) => {
        const t = taskFor(claim);
        const kind = isAbove(claim) ? "baseline" : "discovery";
        return (
          <div key={claim.id} className="review-row">
            <span className="rr-time">{clockLabel(claim.timeIso)}</span>
            <span className="rr-kind">
              {kind} · {claim.sourceLine.split("(")[0].trim()}
            </span>
            {claim.acceptedBy ? (
              <span className="rr-done">Accepted — {claim.acceptedBy.split(",")[0]}</span>
            ) : (
              <button
                className="btn primary rr-btn"
                disabled={busy || !t}
                onClick={() =>
                  act(
                    () =>
                      post("/api/review/accept", {
                        observationId: claim.evidence?.observationId,
                        taskId: t ? `Task/${t.id}` : undefined,
                      }),
                    "Accepted"
                  )
                }
              >
                Accept
              </button>
            )}
          </div>
        );
      })}
      {anyOpen && latestOpenTask && (
        <div className="review-secondary">
          <button className="btn quiet" disabled={busy} onClick={() => onAction("Correction flow: post-demo workflow")}>
            Correct…
          </button>
          <button
            className="btn quiet"
            disabled={busy}
            onClick={() =>
              act(
                () => post("/api/review/hold", { taskId: `Task/${latestOpenTask.id}`, action: "unresolved" }),
                "Left unresolved"
              )
            }
          >
            Leave unresolved
          </button>
          <button
            className="btn quiet"
            disabled={busy}
            onClick={() =>
              act(
                () => post("/api/review/hold", { taskId: `Task/${latestOpenTask.id}`, action: "another-interview" }),
                "Another interview requested"
              )
            }
          >
            Request another interview
          </button>
        </div>
      )}
    </div>
  );
}

function WitnessCallCard(props: {
  def: (typeof WITNESS_CARDS)[number];
  call: CallView | null;
  onAction: (msg: string) => void;
  post: Post;
  refresh: () => Promise<void>;
}) {
  const { def, call, onAction, post, refresh } = props;
  const [busy, setBusy] = useState(false);
  const [briefDraft, setBriefDraft] = useState<string | null>(null);

  async function act(fn: () => Promise<Response>, okMsg: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        onAction(body.error ?? `Refused (${res.status})`);
      } else {
        onAction(okMsg);
        await refresh();
      }
    } catch {
      onAction("Connection failed. Try the action again.");
    } finally {
      setBusy(false);
    }
  }

  if (!call) {
    return (
      <div className="card">
        <div className="c-title">
          {def.name} · {def.relation}
        </div>
        <div className="c-sub">{def.line}</div>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => act(() => post("/api/session", { witness: def.key }), "Call opened")}
        >
          Prepare interview
        </button>
      </div>
    );
  }

  const preStart = call.status === "ready";
  return (
    <div className="card">
      <div className="c-title">
        {call.witnessName} · {call.sourceRole} · {call.status === "interviewing" ? "AI interview live" : call.status}
      </div>

      {preStart && (
        <div className="kickoff">
          <span className="d-label">Briefing</span>
          <textarea
            className="brief-edit"
            aria-label={`Interview brief for ${call.witnessName}`}
            value={briefDraft ?? call.brief}
            onChange={(e) => setBriefDraft(e.target.value)}
            rows={5}
          />
          {briefDraft !== null && briefDraft !== call.brief && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => act(() => post("/api/session", { witness: def.key, brief: briefDraft }), "Brief saved")}
            >
              Save brief
            </button>
          )}
        </div>
      )}

      <GateRow
        label="Outreach basis recorded"
        sub="Attest: patient can't answer · contact involved in her care · best-interest basis (hospital policy)."
        done={call.gates.disclosureBasisRecorded}
        enabled={!busy && !call.gates.disclosureBasisRecorded}
        onClick={() =>
          act(() => post("/api/session/gates", { gate: "disclosureBasisRecorded", callId: call.callId }), "Basis recorded")
        }
      />
      <GateRow
        label="Recipient verified"
        sub="Confirm name + relationship before disclosing anything."
        done={call.gates.recipientVerified}
        enabled={!busy && call.gates.disclosureBasisRecorded && !call.gates.recipientVerified}
        onClick={() =>
          act(() => post("/api/session/gates", { gate: "recipientVerified", callId: call.callId }), "Recipient verified")
        }
      />
      <GateRow
        label="AI participation agreed"
        sub={`Read aloud: ${DISCLOSURE_SCRIPT}`}
        done={call.gates.aiParticipationAgreed}
        enabled={!busy && call.gates.recipientVerified && !call.gates.aiParticipationAgreed}
        onClick={() =>
          act(
            () => post("/api/session/gates", { gate: "aiParticipationAgreed", callId: call.callId }),
            "Participation agreed"
          )
        }
      />

      {call.status !== "interviewing" && call.status !== "complete" && (
        <button
          className="btn primary"
          disabled={busy || !Object.values(call.gates).every(Boolean)}
          onClick={() =>
            act(
              () => post("/api/session/start-interview", { callId: call.callId }),
              `Interview started — Before is speaking with ${call.witnessName.split(" ")[0]}`
            )
          }
        >
          Begin AI interview
        </button>
      )}
      {call.status === "interviewing" && (
        <>
          {call.lastTurns.length > 0 && (
            <div className="transcript">
              <span className="d-label">
                Live transcript <span className="t-live" aria-hidden />
              </span>
              <div className="captions">
                {call.lastTurns.map((turn, i) => (
                  <div key={turn.turnId} className="t-turn" data-role={turn.role === "assistant" ? "agent" : "witness"}>
                    <span className="who">
                      {turn.role === "assistant" ? "Before" : call.witnessName.split(" ")[0]}
                    </span>
                    <span className="t-text">
                      {turn.content}
                      {i === call.lastTurns.length - 1 && <span className="t-caret" aria-hidden />}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="review-secondary">
            <button
              className="btn quiet"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    post("/api/session/status", {
                      status: "handed-to-human",
                      reason: "coordinator took the call back",
                      callId: call.callId,
                    }),
                  "Assistant off the line"
                )
              }
            >
              Take over call
            </button>
            <button
              className="btn quiet"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    post("/api/session/status", {
                      status: "refused",
                      reason: "witness declined the assistant",
                      callId: call.callId,
                    }),
                  "Marked declined"
                )
              }
            >
              Witness declined
            </button>
          </div>
        </>
      )}
      {call.status === "complete" && (
        <div className="c-sub state-ok">Complete — {call.disposition ?? "evidence filed for review"}.</div>
      )}
      {call.status === "handed-to-human" && (
        <div className="c-sub state-amber">
          Back with coordinator — {call.disposition ?? "assistant left the line"}. Follow-up suggested.
        </div>
      )}
      {call.status === "refused" && (
        <div className="c-sub state-amber">Declined the assistant. Continue the call yourself.</div>
      )}
    </div>
  );
}

function GateRow(props: { label: string; sub: string; done: boolean; enabled: boolean; onClick: () => void }) {
  return (
    <div className={`gate-row tall ${props.done ? "done" : ""}`}>
      <span className="g-mark">{props.done ? "✓" : ""}</span>
      <span className="g-body">
        <span className="g-label">{props.label}</span>
        {!props.done && <span className="g-sub">{props.sub}</span>}
      </span>
      {!props.done && (
        <button className="btn" disabled={!props.enabled} onClick={props.onClick}>
          Record
        </button>
      )}
    </div>
  );
}

export function EvidenceDrawer(props: { claims: EventView[]; claim: EventView | null; onSelect: (id: string) => void; open: boolean; setOpen: (v: boolean) => void; mode: "live" | "replay" }) {
  const { claims, claim, onSelect, open, setOpen, mode } = props;
  const ev = claim?.evidence ?? null;
  const timeEvidence = ev?.fieldEvidence.find((f) => f.field === "time");
  const confirmEvidence = ev?.fieldEvidence.find((f) => f.field === "confirmation");
  const medplumBase = "http://localhost:3000";
  return (
    <div className={`drawer ${open ? "open" : ""}`}>
      <button className="drawer-bar" onClick={() => setOpen(!open)} disabled={!ev} aria-expanded={open && !!ev} aria-controls="evidence-panel">
        Evidence
        <span className="hint">{ev ? claim?.sourceLine : "Available after witness confirmation"}</span>
        <Icon name="chevron" style={{ marginLeft: "auto", transform: `rotate(${open ? 90 : -90}deg)` }} />
      </button>
      {ev && (
        <div id="evidence-panel" className="drawer-body">
          <div className="drawer-col grow">
            {claims.length > 1 && <div className="evidence-tabs" aria-label="Evidence source">{claims.map((source) => <button key={source.id} className={`btn ${source.id === claim?.id ? "selected" : "quiet"}`} aria-pressed={source.id === claim?.id} onClick={() => onSelect(source.id)}>{source.sourceLine.split(" (")[0]}</button>)}</div>}
            <span className="d-label">Exact witness quote</span>
            <span className="d-quote">{ev.quote}</span>
            <span className="d-line">
              <b>{claim?.sourceLine}</b> · direct observation
            </span>
          </div>
          <div className="drawer-col grow">
            <span className="d-label">Time anchor</span>
            <span className="d-line">
              <b>Checkable record:</b> {ev.anchorDescription || "checked during the interview"}
            </span>
            {timeEvidence && (
              <span className="d-line">
                Transcript {timeEvidence.turnId}: <b>&ldquo;{timeEvidence.quote}&rdquo;</b>
              </span>
            )}
            {confirmEvidence && (
              <span className="d-line">
                Read-back affirmed in {confirmEvidence.turnId}: &ldquo;{confirmEvidence.quote}&rdquo;
              </span>
            )}
          </div>
          <div className="drawer-col">
            <span className="d-label">{mode === "replay" ? "Illustrative FHIR references" : "Chart record"}</span>
            <div className="d-ids">
              {mode === "replay" ? <>
                <span>{ev.observationId}</span>
                <span>{ev.questionnaireResponseId}</span>
                <span>{ev.transcriptReference}</span>
                <span className="d-line">Local replay · no chart writes</span>
              </> : <>
              <a href={`${medplumBase}/${ev.observationId}`} target="_blank" rel="noreferrer">
                {ev.observationId}
              </a>
              {ev.questionnaireResponseId && (
                <a href={`${medplumBase}/${ev.questionnaireResponseId}`} target="_blank" rel="noreferrer">
                  {ev.questionnaireResponseId}
                </a>
              )}
              {ev.transcriptReference && (
                <a href={`${medplumBase}/${ev.transcriptReference}`} target="_blank" rel="noreferrer">
                  {ev.transcriptReference}
                </a>
              )}
              </>}
            </div>
            {claim?.receipts && (
              <div className="chiprow drawer-chips">
                <span className="chip on">Source linked</span>
                <span className="chip on">Witness confirmed</span>
                <span className="chip warn">Preliminary</span>
                <span className={`chip ${claim.acceptedBy ? "ok" : "warn"}`}>
                  {claim.acceptedBy ? `Accepted: ${claim.acceptedBy.split(",")[0]}` : "Clinician decision pending"}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
