import { describe, expect, it } from "vitest";
import { layoutEvents, type CardGroup, type LayoutEvent, type LayoutMetrics } from "../../lib/timeline/layout";

const M: LayoutMetrics = { canvasWidth: 990, cardWidth: 240, gutter: 12, corridor: 18 };

/** Axis scale of the projected screen: 05:30 -> 09:45 local. */
function xPct(hh: number, mm: number): number {
  return ((hh + mm / 60 - 5.5) / (9.75 - 5.5)) * 100;
}

/** Every pair of stacks on one side must stay apart by at least the gutter. */
function overlappingPairs(groups: CardGroup[], m: LayoutMetrics): string[] {
  const bad: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      if (a.side !== b.side) continue;
      if (a.left < b.left + m.cardWidth + m.gutter && b.left < a.left + m.cardWidth + m.gutter) {
        bad.push(`${a.key} overlaps ${b.key}`);
      }
    }
  }
  return bad;
}

describe("timeline card layout", () => {
  it("stacks the 9:08 and 9:10 below-axis cards instead of overlapping them", () => {
    const events: LayoutEvent[] = [
      { id: "found-direct", side: "below", xPct: xPct(9, 8) },
      { id: "ems-discovery", side: "below", xPct: xPct(9, 10) },
    ];
    const groups = layoutEvents(events, M);

    expect(groups).toHaveLength(1);
    const [g] = groups;
    expect(g.stacked).toBe(true);
    expect(g.members.map((mem) => mem.id)).toEqual(["found-direct", "ems-discovery"]);
    // Both ticks sit near the right edge, so the stack offsets left and the
    // leader corridor stays clear of the cards.
    expect(g.leaderSide).toBe("right");
    expect(g.left + M.cardWidth).toBeLessThanOrEqual(g.spineX - M.corridor + 0.001);
    expect(g.left).toBeGreaterThanOrEqual(0);
    expect(g.left + M.cardWidth).toBeLessThanOrEqual(M.canvasWidth);
  });

  it("renders the full demo frame with no overlap on either side", () => {
    const events: LayoutEvent[] = [
      { id: "relayed", side: "above", xPct: xPct(6, 0) },
      { id: "direct-baseline", side: "above", xPct: xPct(8, 32) },
      { id: "found-direct", side: "below", xPct: xPct(9, 8) },
      { id: "ems-discovery", side: "below", xPct: xPct(9, 10) },
    ];
    const groups = layoutEvents(events, M);

    expect(overlappingPairs(groups, M)).toEqual([]);
    // The two baselines are hours apart, so each keeps its own centred card.
    expect(groups.filter((g) => g.side === "above")).toHaveLength(2);
    expect(groups.filter((g) => g.side === "above").every((g) => !g.stacked)).toBe(true);
  });

  it("keeps a lone card centred on its tick", () => {
    const groups = layoutEvents([{ id: "solo", side: "below", xPct: 50 }], M);
    expect(groups[0].stacked).toBe(false);
    expect(groups[0].left).toBeCloseTo(M.canvasWidth / 2 - M.cardWidth / 2, 5);
  });

  it("clamps a card at either edge of the canvas", () => {
    const groups = layoutEvents(
      [
        { id: "start", side: "above", xPct: 0 },
        { id: "end", side: "below", xPct: 100 },
      ],
      M
    );
    for (const g of groups) {
      expect(g.left).toBeGreaterThanOrEqual(0);
      expect(g.left + M.cardWidth).toBeLessThanOrEqual(M.canvasWidth);
    }
  });

  it("never overlaps for any arrangement of times", () => {
    let seed = 20260801;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 500; trial++) {
      const count = 1 + Math.floor(rand() * 6);
      const events: LayoutEvent[] = [];
      for (let i = 0; i < count; i++) {
        events.push({
          id: `e${i}`,
          side: rand() < 0.5 ? "above" : "below",
          xPct: rand() * 100,
        });
      }
      const groups = layoutEvents(events, M);
      expect(overlappingPairs(groups, M)).toEqual([]);
      // Nothing may leave the canvas, and every event must be placed once.
      const placed = groups.flatMap((g) => g.members.map((mem) => mem.id)).sort();
      expect(placed).toEqual(events.map((e) => e.id).sort());
      for (const g of groups) {
        expect(g.left).toBeGreaterThanOrEqual(0);
        expect(g.left + M.cardWidth).toBeLessThanOrEqual(M.canvasWidth);
      }
    }
  });

  it("offsets a crowded group to the right when the left edge has no room", () => {
    const groups = layoutEvents(
      [
        { id: "a", side: "below", xPct: 2 },
        { id: "b", side: "below", xPct: 3 },
      ],
      M
    );
    expect(groups[0].stacked).toBe(true);
    expect(groups[0].leaderSide).toBe("left");
    expect(groups[0].left).toBeGreaterThanOrEqual(groups[0].spineX + M.corridor - 0.001);
  });
});
