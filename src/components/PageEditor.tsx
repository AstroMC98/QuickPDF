"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AnnotationCanvas, { type Style } from "./AnnotationCanvas";
import {
  IconChevronLeft,
  IconChevronRight,
  IconRotate,
  IconTrash,
  IconUndo,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from "./Icons";
import {
  ANNOTATION_COLORS,
  annotationId,
  type Annotation,
  type AnnotationTool,
} from "@/lib/annotations";
import { formatBytes } from "@/lib/images";
import type { ImageItem } from "@/lib/types";

interface Props {
  image: ImageItem;
  position: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRotate: (imageId: string) => void;
  onAnnotationsChange: (imageId: string, annotations: Annotation[]) => void;
}

const TOOLS: { id: AnnotationTool; label: string; glyph: string }[] = [
  { id: "select", label: "Select and move (V)", glyph: "⌖" },
  { id: "pen", label: "Freehand pen (P)", glyph: "✎" },
  { id: "text", label: "Text (T)", glyph: "T" },
  { id: "rect", label: "Rectangle (R)", glyph: "▭" },
  { id: "ellipse", label: "Ellipse (O)", glyph: "◯" },
  { id: "arrow", label: "Arrow (A)", glyph: "↗" },
  { id: "stamp", label: "Place an image or signature (S)", glyph: "✍" },
];

const SHORTCUTS: Record<string, AnnotationTool> = {
  v: "select",
  p: "pen",
  t: "text",
  r: "rect",
  o: "ellipse",
  a: "arrow",
  s: "stamp",
};

/**
 * Full-screen page view that doubles as the annotation editor.
 *
 * The image and the annotation layer share one wrapper carrying the rotation
 * and zoom, so the two can never drift apart — and the SVG's own coordinate
 * system does all the pointer maths.
 */
export default function PageEditor({
  image,
  position,
  total,
  onClose,
  onPrev,
  onNext,
  onRotate,
  onAnnotationsChange,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const pendingStampBox = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [actualSize, setActualSize] = useState(false);
  const [tool, setTool] = useState<AnnotationTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [draftText, setDraftText] = useState("");
  const [style, setStyle] = useState<Style>({
    color: ANNOTATION_COLORS[0],
    width: 6,
    fontSize: 48,
    filled: false,
  });

  const annotations = image.annotations;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStage({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const commit = useCallback(
    (next: Annotation[]) => onAnnotationsChange(image.id, next),
    [image.id, onAnnotationsChange],
  );

  const markHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-40), annotations]);
  }, [annotations]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      commit(h[h.length - 1]);
      setSelectedId(null);
      return h.slice(0, -1);
    });
  }, [commit]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    markHistory();
    commit(annotations.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, annotations, commit, markHistory]);

  /* ---------------- text ---------------- */

  const placeText = useCallback(() => {
    const value = draftText.trim();
    const at = pendingText;
    setPendingText(null);
    setDraftText("");
    if (!value || !at) return;
    markHistory();
    commit([
      ...annotations,
      { id: annotationId(), kind: "text", x: at.x, y: at.y, text: value, size: style.fontSize, color: style.color },
    ]);
    setTool("select");
  }, [draftText, pendingText, annotations, commit, markHistory, style]);

  /* ---------------- stamps ---------------- */

  const onStampFile = useCallback(
    async (file: File) => {
      const box = pendingStampBox.current;
      pendingStampBox.current = null;
      if (!box) return;

      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read that image"));
        reader.readAsDataURL(file);
      });

      // Fit inside the drawn box, keeping the signature's own proportions.
      const natural = await new Promise<{ w: number; h: number }>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
        probe.onerror = () => resolve({ w: box.w, h: box.h });
        probe.src = src;
      });
      const scale = Math.min(box.w / natural.w, box.h / natural.h);
      const w = natural.w * scale;
      const h = natural.h * scale;

      markHistory();
      commit([
        ...annotations,
        { id: annotationId(), kind: "stamp", x: box.x, y: box.y, w, h, src, mime: file.type || "image/png" },
      ]);
      setTool("select");
    },
    [annotations, commit, markHistory],
  );

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      const next = SHORTCUTS[e.key.toLowerCase()];
      if (next && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setTool(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, deleteSelected, undo]);

  /* ---------------- layout ---------------- */

  const swap = image.rotation % 180 === 90;
  const spanW = swap ? image.height : image.width;
  const spanH = swap ? image.width : image.height;
  const fitScale = stage.w && stage.h ? Math.min(stage.w / spanW, stage.h / spanH, 1) : 0;
  const scale = actualSize ? 1 : fitScale;

  const toolButton = (active: boolean) =>
    `flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors ${
      active ? "bg-indigo-600 text-white" : "text-white/80 hover:bg-white/15"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Editing ${image.name}`}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-white">
        <span className="tabular-nums text-sm font-semibold">
          {position} / {total}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={image.name}>
          {image.name}
        </span>
        <span className="hidden text-xs text-white/50 lg:inline">
          {image.width}×{image.height}px · {formatBytes(image.bytesLength)}
          {image.rotation ? ` · ${image.rotation}°` : ""}
          {annotations.length ? ` · ${annotations.length} mark${annotations.length === 1 ? "" : "s"}` : ""}
        </span>
        <button type="button" onClick={() => setActualSize((v) => !v)} title={actualSize ? "Fit to window" : "Full size"} className="rounded-md p-2 hover:bg-white/15">
          {actualSize ? <IconZoomOut /> : <IconZoomIn />}
        </button>
        <button type="button" onClick={() => onRotate(image.id)} title="Rotate 90° clockwise" className="rounded-md p-2 hover:bg-white/15">
          <IconRotate />
        </button>
        <button type="button" onClick={onClose} title="Close (Esc)" className="rounded-md p-2 hover:bg-white/15">
          <IconX />
        </button>
      </header>

      {/* ---- toolbar ---- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-y border-white/10 px-3 py-1.5">
        <div className="flex items-center gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              className={toolButton(tool === t.id)}
            >
              <span aria-hidden>{t.glyph}</span>
            </button>
          ))}
        </div>

        <span className="mx-1 h-5 w-px bg-white/15" />

        <div className="flex items-center gap-1">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setStyle((s) => ({ ...s, color: c }))}
              className={`h-6 w-6 rounded-full border-2 transition-transform ${
                style.color === c ? "border-white scale-110" : "border-white/30"
              }`}
              style={{ background: c }}
            />
          ))}
        </div>

        <span className="mx-1 h-5 w-px bg-white/15" />

        <label className="flex items-center gap-1.5 text-xs text-white/70">
          Stroke
          <input
            type="range"
            min={1}
            max={40}
            value={style.width}
            onChange={(e) => setStyle((s) => ({ ...s, width: Number(e.target.value) }))}
            className="w-20 accent-indigo-500"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-white/70">
          Text
          <input
            type="range"
            min={10}
            max={200}
            step={2}
            value={style.fontSize}
            onChange={(e) => setStyle((s) => ({ ...s, fontSize: Number(e.target.value) }))}
            className="w-20 accent-indigo-500"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-white/70">
          <input
            type="checkbox"
            checked={style.filled}
            onChange={(e) => setStyle((s) => ({ ...s, filled: e.target.checked }))}
            className="accent-indigo-500"
          />
          Fill shapes
        </label>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={!history.length}
            title="Undo (Ctrl+Z)"
            className="rounded-md p-2 text-white/80 hover:bg-white/15 disabled:opacity-30"
          >
            <IconUndo />
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!selectedId}
            title="Delete selected (Del)"
            className="rounded-md p-2 text-white/80 hover:bg-red-500 disabled:opacity-30"
          >
            <IconTrash />
          </button>
        </div>
      </div>

      {/* ---- stage ---- */}
      <div className="relative flex min-h-0 flex-1 items-center">
        {total > 1 && (
          <button type="button" onClick={onPrev} title="Previous page (←)" className="absolute left-2 z-10 rounded-full bg-black/50 p-3 text-white hover:bg-black/80">
            <IconChevronLeft className="h-5 w-5" />
          </button>
        )}

        <div
          ref={stageRef}
          className={`flex h-full w-full items-center justify-center p-4 ${
            actualSize ? "overflow-auto" : "overflow-hidden"
          }`}
        >
          {scale > 0 && (
            <div className="relative shrink-0" style={{ width: spanW * scale, height: spanH * scale }}>
              {/* One wrapper carries the rotation, so image and marks move together. */}
              <div
                className="absolute left-1/2 top-1/2"
                style={{
                  width: image.width * scale,
                  height: image.height * scale,
                  transform: `translate(-50%, -50%) rotate(${image.rotation}deg)`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.name}
                  draggable={false}
                  className="block h-full w-full bg-white shadow-2xl"
                />
                <AnnotationCanvas
                  imageWidth={image.width}
                  imageHeight={image.height}
                  annotations={annotations}
                  tool={tool}
                  style={style}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onChange={commit}
                  onBeginChange={markHistory}
                  onRequestText={(x, y) => {
                    setPendingText({ x, y });
                    setDraftText("");
                  }}
                  onRequestStamp={(box) => {
                    pendingStampBox.current = box;
                    stampInput.current?.click();
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {total > 1 && (
          <button type="button" onClick={onNext} title="Next page (→)" className="absolute right-2 z-10 rounded-full bg-black/50 p-3 text-white hover:bg-black/80">
            <IconChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {pendingText && (
        <div className="absolute left-1/2 top-28 z-20 w-[min(28rem,90vw)] -translate-x-1/2 rounded-lg border border-white/20 bg-zinc-900 p-3 shadow-2xl">
          <label className="mb-1 block text-xs text-white/60">Text to place</label>
          <div className="flex gap-2">
            <input
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") placeText();
                if (e.key === "Escape") {
                  setPendingText(null);
                  setDraftText("");
                }
              }}
              placeholder="Type, then press Enter"
              className="flex-1 rounded-md border border-white/20 bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-indigo-400"
            />
            <button type="button" onClick={placeText} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
              Place
            </button>
          </div>
        </div>
      )}

      <input
        ref={stampInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onStampFile(file);
          e.target.value = "";
        }}
      />

      <footer className="shrink-0 pb-2 text-center text-[11px] text-white/40">
        {tool === "select"
          ? "Click a mark to select it · drag to move · corner handle resizes · Del removes"
          : tool === "stamp"
            ? "Drag a box where the signature should go, then choose an image file"
            : tool === "text"
              ? "Click where the text should start"
              : "Drag on the page to draw"}
        {" · "}← → pages · Esc closes
      </footer>
    </div>
  );
}
