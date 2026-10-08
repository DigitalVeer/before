"use client";

/**
 * Live data for the projected stroke-code screen.
 *
 * The screen renders ONLY from /api/timeline polls (hosted Medplum reads).
 * Claims appear because a poll returned new server state, never from client
 * optimism. This module owns the poll and reports which ids are new, so the
 * screen can animate exactly when chart state changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ClinicianScreen, type TimelinePayload } from "./screen";
import Link from "next/link";
import { Wordmark, Icon } from "../components/icons";

function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export default function ClinicianPage() {
  const [data, setData] = useState<TimelinePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef(false);
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
  const [intervalEntering, setIntervalEntering] = useState(false);
  const seenIds = useRef<Set<string> | null>(null);
  const hadInterval = useRef(false);
  const anaScheduled = useRef(false);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const res = await fetch("/api/timeline", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("Chart connection unavailable");
      const payload = (await res.json()) as TimelinePayload;
      const ids = new Set(payload.timeline.events.map((e) => e.id));
      if (seenIds.current === null) {
        seenIds.current = ids;
      } else {
        const fresh = [...ids].filter((id) => !seenIds.current!.has(id));
        if (fresh.length > 0) {
          setEnteringIds(new Set(fresh));
          seenIds.current = ids;
        }
      }
      if (payload.timeline.interval && !hadInterval.current) {
        hadInterval.current = true;
        setIntervalEntering(true);
      }
      if (!payload.timeline.interval) hadInterval.current = false;
      // Stage-managed second witness: once Luis's claim is on screen, ask the
      // server to run Ana's fixture interview (no-op unless enabled).
      const spouseClaim = payload.timeline.events.some(
        (e) => e.receipts !== null && e.eventType === "last-known-baseline"
      );
      const anaClaim = payload.timeline.events.some(
        (e) => e.receipts !== null && e.eventType === "symptom-discovery"
      );
      if (spouseClaim && !anaClaim && !anaScheduled.current) {
        anaScheduled.current = true;
        setTimeout(() => {
          void post("/api/demo/stage-ana");
        }, 7000);
      }
      setData(payload);
      setError(null);
    } catch {
      setError("The live workspace cannot reach Medplum. Start the configured FHIR service and check your credentials.");
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), 1000);
    return () => clearInterval(t);
  }, [poll]);

  if (!data) return <main className="live-setup">
    <Link href="/" aria-label="Before home"><Wordmark /></Link>
    <div className="live-setup-body">
      <span className="live-status"><span className="state-dot amber" /> Live integration</span>
      <h1>{error ? "Connect your live workspace." : "Opening the clinical timeline…"}</h1>
      <p role="status">{error ?? "Connecting to the FHIR store and loading Rosa’s synthetic case."}</p>
      {error && <div className="setup-actions"><Link href="/demo" className="btn primary">Play the guided demo <Icon name="arrow" size={16} /></Link><Link href="/test" className="btn">Check integrations</Link><button className="btn quiet" onClick={() => { setError(null); void poll(); }}>Retry connection</button></div>}
      <div className="setup-instructions"><h2>To run a live interview</h2><p>Configure Medplum and Deepgram using <code>.env.example</code>, then run <code>pnpm demo:live --no-phone</code>. Open the witness endpoint after the coordinator records the three gates.</p><Link href="/witness">Open witness endpoint <Icon name="arrow" size={14} /></Link></div>
    </div>
  </main>;

  return <>
    {error && <div className="connection-warning" role="status">Connection interrupted. Showing the last received chart state. Retrying…</div>}
    <ClinicianScreen
      data={data}
      enteringIds={enteringIds}
      intervalEntering={intervalEntering}
      post={post}
      refresh={poll}
    />
  </>;
}
