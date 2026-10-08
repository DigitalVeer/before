/**
 * Deterministic interval logic (§11.5). The server, not the language model,
 * computes temporal relations.
 */

export interface TimelinePoint {
  id: string;
  eventType: string;
  timeIso: string | null;
  direct: boolean;
  anchored: boolean;
  confirmed: boolean;
}

export interface BoundedInterval {
  startIso: string;
  endIso: string;
  minutes: number;
  startId: string;
  endId: string;
}

/**
 * A bounded interval exists only when a direct, anchored, confirmed baseline
 * precedes the earliest symptom claim (§12.2). Relayed or unanchored
 * baselines never create one — that gap is the before-state.
 */
export function computeInterval(points: TimelinePoint[]): BoundedInterval | null {
  const baselines = points.filter(
    (p) =>
      p.eventType === "last-known-baseline" &&
      p.direct &&
      p.anchored &&
      p.confirmed &&
      p.timeIso !== null
  );
  const symptoms = points.filter(
    (p) =>
      (p.eventType === "witnessed-onset" || p.eventType === "symptom-discovery") &&
      p.timeIso !== null
  );
  if (baselines.length === 0 || symptoms.length === 0) return null;

  const latestBaseline = baselines.reduce((a, b) =>
    Date.parse(a.timeIso!) >= Date.parse(b.timeIso!) ? a : b
  );
  const earliestSymptom = symptoms.reduce((a, b) =>
    Date.parse(a.timeIso!) <= Date.parse(b.timeIso!) ? a : b
  );

  const start = Date.parse(latestBaseline.timeIso!);
  const end = Date.parse(earliestSymptom.timeIso!);
  if (!(start < end)) return null;

  return {
    startIso: latestBaseline.timeIso!,
    endIso: earliestSymptom.timeIso!,
    minutes: Math.round((end - start) / 60000),
    startId: latestBaseline.id,
    endId: earliestSymptom.id,
  };
}
