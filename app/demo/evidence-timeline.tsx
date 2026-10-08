import { Icon } from "../components/icons";
import { parseExactTime } from "../../lib/claims/normalize";
import { witnessClock, witnessForEvent, type demoPayloadAt } from "../../lib/demo/scenario";

export function EvidenceTimeline({ data, anchored, direct, parallel, onInspect }: {
  data: ReturnType<typeof demoPayloadAt>; anchored: boolean; direct: boolean; parallel: boolean; onInspect: (id: string) => void;
}) {
  const { events, interval } = data.timeline;
  const claims = events.filter((event) => event.evidence);
  const baseline = claims.find((event) => event.id === "demo-spouse");
  const originalBaseline = events.find((event) => event.id === "demo-relayed-baseline")!.timeIso!;
  const originalDiscovery = events.find((event) => event.id === "demo-relayed-discovery")!.timeIso!;
  const startIso = interval?.startIso ?? originalBaseline;
  const endIso = interval?.endIso ?? originalDiscovery;
  const position = (iso: string) => (Date.parse(iso) - Date.parse(originalBaseline)) / (Date.parse(originalDiscovery) - Date.parse(originalBaseline)) * 100;
  const start = position(startIso);
  const end = position(endIso);
  return <section className={`evidence-timeline ${baseline ? "has-baseline" : ""} ${parallel ? "is-parallel" : ""}`} aria-labelledby="doctor-heading">
    <header className="panel-heading"><h2 id="doctor-heading">Doctor’s view</h2><p>{parallel ? `${claims.length} ${claims.length === 1 ? "source" : "sources"} in Rosa’s chart` : "Rosa’s timeline"}</p></header>
    <div className="timeline-window" aria-live="polite">
      <div className="window-clocks"><span>{parseExactTime(startIso)!.spokenClock}<small>Last known normal</small></span><Icon name="arrow" size={20} /><span>{parseExactTime(endIso)!.spokenClock}<small>Found with symptoms</small></span></div>
      <div className="window-axis" aria-hidden="true"><span className="interval-line" style={{ left: `${start}%`, width: `${end - start}%` }} /><i className="start-dot" style={{ left: `${start}%` }} /><i className="end-dot" style={{ left: `${end}%` }} /></div>
      <div className="window-caption"><b>{interval ? `${interval.minutes} minutes` : "190-minute gap"}</b><span>{interval ? "Preliminary evidence" : "Relayed history, still unresolved"}</span></div>
    </div>
    <div className="timeline-sources">
      {parallel ? claims.map((event) => {
        const witness = witnessForEvent(event.id)!;
        return <button key={event.id} className={`timeline-source ${event.id === interval?.startId || event.id === interval?.endId ? "bounds-window" : ""}`} onClick={() => onInspect(event.id)} aria-label={`Inspect ${witness.name.split(" ")[0]}’s evidence`}><span><span className="source-title"><b>{witness.name}</b><time>{witnessClock(witness)}</time></span><span>{witness.finding}</span></span><Icon name="arrow" size={18} /></button>;
      }) : anchored ? <div className={`call-observations ${baseline ? "is-confirmed" : ""}`} aria-live="polite"><div className="observations-heading"><b>Luis’s account</b><span>{baseline ? "Confirmed" : "Awaiting yes"}</span></div><div className="observation-phrases"><mark>8:32</mark>{direct && <><mark className="learned-phrase">normal</mark><mark className="learned-phrase">about lunch</mark></>}</div>{baseline && <button onClick={() => onInspect(baseline.id)} aria-label="Inspect Luis’s evidence">Inspect source <Icon name="arrow" size={16} /></button>}</div>
        : <p className="timeline-pending">Waiting for a direct witness.</p>}
    </div>
  </section>;
}
