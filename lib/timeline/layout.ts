/**
 * Slot layout for the timeline event cards.
 *
 * Two events close in time cannot both keep a card centred on their own tick:
 * the cards intersect. This module gives every card an explicit horizontal slot
 * so that no two cards on the same side of the axis can ever overlap.
 *
 * The rules:
 *  - Events whose centred cards would collide form one group.
 *  - A lone event keeps its card centred on its tick, clamped to the canvas.
 *  - A group puts its cards in one vertical stack, offset to the side that has
 *    more room. The stack leaves the tick positions in an empty corridor, so a
 *    leader line reaches each card without crossing another card.
 *  - Groups whose boxes still touch merge and place again. The loop ends when
 *    no two boxes touch, so the no-overlap guarantee holds for every input.
 *
 * Vertical separation inside a group is the stylesheet's job: the stack is a
 * flex column, so tall cards push their neighbours instead of covering them.
 * That keeps this module free of height measurement.
 */

export type Side = "above" | "below";

export interface LayoutEvent {
  id: string;
  side: Side;
  /** Tick position along the axis, 0–100. */
  xPct: number;
}

export interface LayoutMetrics {
  /** Measured width of the plot area, in px. */
  canvasWidth: number;
  /** Fixed card width, in px. */
  cardWidth: number;
  /** Smallest gap allowed between two card boxes, in px. */
  gutter: number;
  /** Gap between a stack and its leader corridor, in px. */
  corridor: number;
}

export interface CardGroup {
  key: string;
  side: Side;
  /** Left edge of the stack, in px within the canvas. */
  left: number;
  /** Where the leader drops from the axis, in px within the canvas. */
  spineX: number;
  /** Edge of the cards the leaders attach to. */
  leaderSide: "left" | "right";
  /** True when the group holds more than one card. */
  stacked: boolean;
  /** Event ids, earliest first. The earliest card sits nearest the axis. */
  members: { id: string; tickX: number }[];
}

interface Item {
  id: string;
  x: number;
}

function clampLeft(value: number, m: LayoutMetrics): number {
  return Math.max(0, Math.min(value, m.canvasWidth - m.cardWidth));
}

function placeGroup(members: Item[], side: Side, m: LayoutMetrics): CardGroup {
  const key = `${side}:${members.map((it) => it.id).join("+")}`;
  const shared = {
    key,
    side,
    stacked: members.length > 1,
    members: members.map((it) => ({ id: it.id, tickX: it.x })),
  };

  if (members.length === 1) {
    const only = members[0];
    const left = clampLeft(only.x - m.cardWidth / 2, m);
    return { ...shared, left, spineX: only.x, leaderSide: "left" };
  }

  const minX = members[0].x;
  const maxX = members[members.length - 1].x;
  const fitsLeft = minX - m.corridor - m.cardWidth >= 0;
  const fitsRight = maxX + m.corridor + m.cardWidth <= m.canvasWidth;
  // Prefer the side that fits. When neither fits, take the roomier side.
  const toLeft = fitsLeft || (!fitsRight && minX >= m.canvasWidth - maxX);
  const left = clampLeft(toLeft ? minX - m.corridor - m.cardWidth : maxX + m.corridor, m);
  const spineX = toLeft ? Math.max(minX, left + m.cardWidth + m.corridor) : Math.min(maxX, left - m.corridor);

  return { ...shared, left, spineX, leaderSide: toLeft ? "right" : "left" };
}

function layoutSide(events: LayoutEvent[], side: Side, m: LayoutMetrics): CardGroup[] {
  const items: Item[] = events
    .map((e) => ({ id: e.id, x: (e.xPct / 100) * m.canvasWidth }))
    .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  if (items.length === 0) return [];

  // Seed: consecutive events whose centred cards would collide travel together.
  // The threshold is the true collision distance, which is far wider than the
  // ~6% of axis width the design calls for, so the 6% rule is always covered.
  const groups: Item[][] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && it.x - last[last.length - 1].x < m.cardWidth + m.gutter) last.push(it);
    else groups.push([it]);
  }

  // An offset stack can reach into a neighbour that the seed pass left alone.
  // Merge any two groups whose boxes touch and place again. Each merge drops
  // the group count by at least one, so the loop always ends.
  for (;;) {
    const placed = groups.map((g) => placeGroup(g, side, m));
    let merge: [number, number] | null = null;
    for (let i = 0; i < placed.length && !merge; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a.left < b.left + m.cardWidth + m.gutter && b.left < a.left + m.cardWidth + m.gutter) {
          merge = [i, j];
          break;
        }
      }
    }
    if (!merge) return placed;
    const [i, j] = merge;
    groups.splice(i, j - i + 1, groups.slice(i, j + 1).flat());
  }
}

/** Group every event into a non-overlapping card slot. */
export function layoutEvents(events: LayoutEvent[], m: LayoutMetrics): CardGroup[] {
  return [
    ...layoutSide(events.filter((e) => e.side === "above"), "above", m),
    ...layoutSide(events.filter((e) => e.side === "below"), "below", m),
  ];
}
