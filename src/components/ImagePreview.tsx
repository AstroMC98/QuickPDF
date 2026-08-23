"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconRotate,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from "./Icons";
import { formatBytes } from "@/lib/images";
import type { ImageItem } from "@/lib/types";

interface Props {
  image: ImageItem;
  /** 1-based position across every page on the board. */
  position: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRotate: (imageId: string) => void;
}

/**
 * Full-screen look at one page. Sizing is computed rather than left to CSS:
 * a rotated image's *layout* box does not change, so `object-contain` alone
 * would let a quarter-turned page overflow or float off-centre.
 */
export default function ImagePreview({
  image,
  position,
  total,
  onClose,
  onPrev,
  onNext,
  onRotate,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [actualSize, setActualSize] = useState(false);

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

  const swap = image.rotation % 180 === 90;
  // Footprint the rotated page occupies, in natural pixels.
  const spanW = swap ? image.height : image.width;
  const spanH = swap ? image.width : image.height;

  const fitScale = stage.w && stage.h ? Math.min(stage.w / spanW, stage.h / spanH, 1) : 0;
  const scale = actualSize ? 1 : fitScale;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${image.name}`}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 text-white">
        <span className="tabular-nums text-sm font-semibold">
          {position} / {total}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={image.name}>
          {image.name}
        </span>
        <span className="hidden text-xs text-white/60 sm:inline">
          {image.width}×{image.height}px · {formatBytes(image.bytesLength)}
          {image.rotation ? ` · rotated ${image.rotation}°` : ""}
          {fitScale > 0 && !actualSize ? ` · ${Math.round(fitScale * 100)}%` : ""}
        </span>

        <button
          type="button"
          onClick={() => setActualSize((v) => !v)}
          title={actualSize ? "Fit to window" : "View at full size"}
          className="rounded-md p-2 hover:bg-white/15"
        >
          {actualSize ? <IconZoomOut /> : <IconZoomIn />}
        </button>
        <button
          type="button"
          onClick={() => onRotate(image.id)}
          title="Rotate 90° clockwise"
          className="rounded-md p-2 hover:bg-white/15"
        >
          <IconRotate />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          className="rounded-md p-2 hover:bg-white/15"
        >
          <IconX />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center">
        {total > 1 && (
          <button
            type="button"
            onClick={onPrev}
            title="Previous page (←)"
            className="absolute left-2 z-10 rounded-full bg-black/50 p-3 text-white hover:bg-black/80"
          >
            <IconChevronLeft className="h-5 w-5" />
          </button>
        )}

        {/* Clicking the empty space around the page closes, as in any viewer. */}
        <div
          ref={stageRef}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className={`flex h-full w-full items-center justify-center p-4 ${
            actualSize ? "overflow-auto" : "overflow-hidden"
          }`}
        >
          {scale > 0 && (
            // Wrapper takes the rotated footprint so scrolling at full size
            // matches what is actually on screen.
            <div
              className="relative shrink-0"
              style={{ width: spanW * scale, height: spanH * scale }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.name}
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none bg-white shadow-2xl"
                style={{
                  width: image.width * scale,
                  height: image.height * scale,
                  transform: `translate(-50%, -50%) rotate(${image.rotation}deg)`,
                }}
              />
            </div>
          )}
        </div>

        {total > 1 && (
          <button
            type="button"
            onClick={onNext}
            title="Next page (→)"
            className="absolute right-2 z-10 rounded-full bg-black/50 p-3 text-white hover:bg-black/80"
          >
            <IconChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      <footer className="shrink-0 pb-3 text-center text-xs text-white/50">
        ← → to move between pages · Esc to close
      </footer>
    </div>
  );
}
