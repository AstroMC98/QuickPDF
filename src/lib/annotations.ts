/**
 * Vector annotations laid over a page.
 *
 * Coordinates are in the source image's own pixels, with the origin at its
 * top-left and y pointing down — the same space as an SVG `viewBox` over that
 * image. That choice does a lot of work:
 *
 *  - the on-screen layer is just an <svg viewBox="0 0 w h"> sized and rotated
 *    exactly like the <img>, so display needs no maths at all;
 *  - pointer input maps back with the SVG's own `getScreenCTM().inverse()`,
 *    which already accounts for zoom and rotation;
 *  - nothing is stored in screen units, so annotations survive resizing the
 *    window, rotating the page, and zooming.
 */

export type AnnotationTool =
  | "select"
  | "pen"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "stamp";

interface Base {
  id: string;
}

export interface InkAnnotation extends Base {
  kind: "ink";
  points: [number, number][];
  color: string;
  width: number;
}

export interface BoxAnnotation extends Base {
  kind: "rect" | "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  /** null means outline only. */
  fill: string | null;
}

export interface ArrowAnnotation extends Base {
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface TextAnnotation extends Base {
  kind: "text";
  x: number;
  /** Baseline-ish anchor: the top of the first line. */
  y: number;
  text: string;
  size: number;
  color: string;
}

export interface StampAnnotation extends Base {
  kind: "stamp";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Data URL of the placed image — a signature, initials, a logo. */
  src: string;
  /** Kept so the PDF renderer can pick the right embed path. */
  mime: string;
}

export type Annotation =
  | InkAnnotation
  | BoxAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | StampAnnotation;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ANNOTATION_COLORS = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#7c3aed",
  "#18181b",
  "#ffffff",
];

let seq = 0;
export function annotationId(): string {
  seq += 1;
  return `ann_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** Axis-aligned bounds, used for hit testing and selection outlines. */
export function annotationBounds(a: Annotation): Bounds {
  switch (a.kind) {
    case "ink": {
      const xs = a.points.map((p) => p[0]);
      const ys = a.points.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case "arrow": {
      const x = Math.min(a.x1, a.x2);
      const y = Math.min(a.y1, a.y2);
      return { x, y, w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
    }
    case "text":
      // Rough: enough for hit testing without measuring glyphs.
      return { x: a.x, y: a.y, w: a.text.length * a.size * 0.55, h: a.size * 1.2 };
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

/** `slack` widens the target so thin strokes stay clickable. */
export function hitTest(a: Annotation, px: number, py: number, slack: number): boolean {
  if (a.kind === "ink") {
    // Distance to any segment, rather than the (often huge) stroke bounds.
    const reach = slack + a.width;
    for (let i = 1; i < a.points.length; i += 1) {
      if (distanceToSegment(px, py, a.points[i - 1], a.points[i]) <= reach) return true;
    }
    return a.points.length === 1
      ? distance(px, py, a.points[0][0], a.points[0][1]) <= reach
      : false;
  }
  if (a.kind === "arrow") {
    return distanceToSegment(px, py, [a.x1, a.y1], [a.x2, a.y2]) <= slack + a.width;
  }
  const b = annotationBounds(a);
  return (
    px >= b.x - slack && px <= b.x + b.w + slack && py >= b.y - slack && py <= b.y + b.h + slack
  );
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function distanceToSegment(
  px: number,
  py: number,
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return distance(px, py, ax + t * dx, ay + t * dy);
}

export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case "ink":
      return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    case "arrow":
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    default:
      return { ...a, x: a.x + dx, y: a.y + dy };
  }
}

/** Drag the bottom-right handle. Ink keeps its shape; only boxes truly resize. */
export function resizeAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.kind === "arrow") return { ...a, x2: a.x2 + dx, y2: a.y2 + dy };
  if (a.kind === "text") return { ...a, size: Math.max(6, a.size + dy) };
  if (a.kind === "ink") {
    const b = annotationBounds(a);
    if (b.w === 0 || b.h === 0) return a;
    const sx = Math.max(0.05, (b.w + dx) / b.w);
    const sy = Math.max(0.05, (b.h + dy) / b.h);
    return {
      ...a,
      points: a.points.map(
        ([x, y]) => [b.x + (x - b.x) * sx, b.y + (y - b.y) * sy] as [number, number],
      ),
    };
  }
  return { ...a, w: Math.max(4, a.w + dx), h: Math.max(4, a.h + dy) };
}

/** Normalise a dragged box so width and height are never negative. */
export function normaliseBox(x1: number, y1: number, x2: number, y2: number): Bounds {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}
