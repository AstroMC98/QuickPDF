"use client";

import { useCallback, useRef, useState } from "react";
import {
  annotationBounds,
  annotationId,
  hitTest,
  moveAnnotation,
  normaliseBox,
  resizeAnnotation,
  type Annotation,
  type AnnotationTool,
} from "@/lib/annotations";

export interface Style {
  color: string;
  width: number;
  fontSize: number;
  filled: boolean;
}

interface Props {
  /** Natural pixel size of the page this layer sits over. */
  imageWidth: number;
  imageHeight: number;
  annotations: Annotation[];
  tool: AnnotationTool;
  style: Style;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: Annotation[]) => void;
  /** Called when the text tool is used, so the shell can prompt for content. */
  onRequestText: (x: number, y: number) => void;
  /** Called when the stamp tool finishes a box, so the shell can supply an image. */
  onRequestStamp: (box: { x: number; y: number; w: number; h: number }) => void;
  /** Fired once at the start of each discrete edit, so undo can snapshot. */
  onBeginChange: () => void;
}

type Drag =
  | { mode: "draw"; startX: number; startY: number; draft: Annotation }
  | { mode: "move"; lastX: number; lastY: number; id: string }
  | { mode: "resize"; lastX: number; lastY: number; id: string }
  | null;

export default function AnnotationCanvas({
  imageWidth,
  imageHeight,
  annotations,
  tool,
  style,
  selectedId,
  onSelect,
  onChange,
  onRequestText,
  onRequestStamp,
  onBeginChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);

  /**
   * Screen point to page pixels. `getScreenCTM` already folds in the CSS
   * rotation and zoom applied to this SVG, so no manual maths is needed.
   */
  const toPage = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  // Thin strokes need a generous target, and the page may be shown small.
  const slack = Math.max(imageWidth, imageHeight) * 0.012;

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { x, y } = toPage(e.clientX, e.clientY);

    if (tool === "select") {
      const selected = annotations.find((a) => a.id === selectedId);
      if (selected) {
        const b = annotationBounds(selected);
        // Bottom-right handle wins over a plain move.
        if (Math.hypot(x - (b.x + b.w), y - (b.y + b.h)) <= slack * 1.6) {
          onBeginChange();
          setDrag({ mode: "resize", lastX: x, lastY: y, id: selected.id });
          return;
        }
      }
      // Topmost first, so recent work is easiest to grab.
      const hit = [...annotations].reverse().find((a) => hitTest(a, x, y, slack));
      onSelect(hit?.id ?? null);
      if (hit) {
        onBeginChange();
        setDrag({ mode: "move", lastX: x, lastY: y, id: hit.id });
      }
      return;
    }

    if (tool === "text") {
      onRequestText(x, y);
      return;
    }

    const id = annotationId();
    let draft: Annotation;
    if (tool === "pen") {
      draft = { id, kind: "ink", points: [[x, y]], color: style.color, width: style.width };
    } else if (tool === "arrow") {
      draft = { id, kind: "arrow", x1: x, y1: y, x2: x, y2: y, color: style.color, width: style.width };
    } else if (tool === "stamp") {
      draft = { id, kind: "rect", x, y, w: 0, h: 0, color: "#6366f1", width: style.width, fill: null };
    } else {
      draft = {
        id,
        kind: tool,
        x,
        y,
        w: 0,
        h: 0,
        color: style.color,
        width: style.width,
        fill: style.filled ? style.color : null,
      };
    }
    setDrag({ mode: "draw", startX: x, startY: y, draft });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const { x, y } = toPage(e.clientX, e.clientY);

    if (drag.mode === "move") {
      onChange(
        annotations.map((a) =>
          a.id === drag.id ? moveAnnotation(a, x - drag.lastX, y - drag.lastY) : a,
        ),
      );
      setDrag({ ...drag, lastX: x, lastY: y });
      return;
    }

    if (drag.mode === "resize") {
      onChange(
        annotations.map((a) =>
          a.id === drag.id ? resizeAnnotation(a, x - drag.lastX, y - drag.lastY) : a,
        ),
      );
      setDrag({ ...drag, lastX: x, lastY: y });
      return;
    }

    const draft = drag.draft;
    if (draft.kind === "ink") {
      setDrag({ ...drag, draft: { ...draft, points: [...draft.points, [x, y]] } });
    } else if (draft.kind === "arrow") {
      setDrag({ ...drag, draft: { ...draft, x2: x, y2: y } });
    } else {
      const box = normaliseBox(drag.startX, drag.startY, x, y);
      setDrag({ ...drag, draft: { ...draft, ...box } });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.mode !== "draw") {
      setDrag(null);
      return;
    }

    const draft = drag.draft;
    setDrag(null);

    if (tool === "stamp") {
      const b = draft as { x: number; y: number; w: number; h: number };
      // A tap rather than a drag: give the stamp a sensible default size.
      const box =
        b.w < 8 || b.h < 8
          ? { x: b.x, y: b.y, w: imageWidth * 0.25, h: imageWidth * 0.1 }
          : b;
      onRequestStamp(box);
      return;
    }

    // Discard accidental taps that produced nothing meaningful.
    if (draft.kind === "ink" && draft.points.length < 2) return;
    if (draft.kind === "arrow" && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 4) return;
    if ((draft.kind === "rect" || draft.kind === "ellipse") && (draft.w < 4 || draft.h < 4)) return;

    onBeginChange();
    onChange([...annotations, draft]);
    onSelect(draft.id);
  };

  const rendered = drag?.mode === "draw" ? [...annotations, drag.draft] : annotations;
  const selected = annotations.find((a) => a.id === selectedId) ?? null;
  const selectedBox = selected ? annotationBounds(selected) : null;
  const handle = slack * 1.2;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      className="absolute inset-0 h-full w-full"
      style={{
        cursor: tool === "select" ? "default" : "crosshair",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {rendered.map((a) => (
        <AnnotationShape key={a.id} annotation={a} />
      ))}

      {selectedBox && (
        <>
          <rect
            x={selectedBox.x - slack / 2}
            y={selectedBox.y - slack / 2}
            width={selectedBox.w + slack}
            height={selectedBox.h + slack}
            fill="none"
            stroke="#6366f1"
            strokeWidth={slack / 3}
            strokeDasharray={`${slack} ${slack / 2}`}
            pointerEvents="none"
          />
          <rect
            x={selectedBox.x + selectedBox.w - handle / 2}
            y={selectedBox.y + selectedBox.h - handle / 2}
            width={handle}
            height={handle}
            fill="#6366f1"
            pointerEvents="none"
          />
        </>
      )}
    </svg>
  );
}

function AnnotationShape({ annotation: a }: { annotation: Annotation }) {
  switch (a.kind) {
    case "ink":
      return (
        <polyline
          points={a.points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke={a.color}
          strokeWidth={a.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "rect":
      return (
        <rect
          x={a.x}
          y={a.y}
          width={a.w}
          height={a.h}
          fill={a.fill ?? "none"}
          stroke={a.color}
          strokeWidth={a.width}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={a.x + a.w / 2}
          cy={a.y + a.h / 2}
          rx={a.w / 2}
          ry={a.h / 2}
          fill={a.fill ?? "none"}
          stroke={a.color}
          strokeWidth={a.width}
        />
      );
    case "arrow": {
      const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const head = Math.max(a.width * 3.5, 8);
      const wing = Math.PI / 7;
      return (
        <g stroke={a.color} strokeWidth={a.width} strokeLinecap="round" fill="none">
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} />
          <polyline
            points={[
              `${a.x2 - head * Math.cos(angle - wing)},${a.y2 - head * Math.sin(angle - wing)}`,
              `${a.x2},${a.y2}`,
              `${a.x2 - head * Math.cos(angle + wing)},${a.y2 - head * Math.sin(angle + wing)}`,
            ].join(" ")}
            strokeLinejoin="round"
          />
        </g>
      );
    }
    case "text":
      return (
        <text
          x={a.x}
          y={a.y + a.size}
          fill={a.color}
          fontSize={a.size}
          fontFamily="Helvetica, Arial, sans-serif"
          style={{ whiteSpace: "pre" }}
        >
          {a.text}
        </text>
      );
    case "stamp":
      return (
        <image
          href={a.src}
          x={a.x}
          y={a.y}
          width={a.w}
          height={a.h}
          preserveAspectRatio="none"
        />
      );
  }
}
