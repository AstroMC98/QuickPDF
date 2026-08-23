"use client";

import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconCheck, IconRotate, IconScissors, IconTrash } from "./Icons";
import { formatBytes } from "@/lib/images";
import type { ImageItem } from "@/lib/types";

interface Props {
  image: ImageItem;
  pageLabel?: string;
  canSplit: boolean;
  selected: boolean;
  /** `extend` is true when Shift was held — select the range, don't toggle one. */
  onToggleSelect: (imageId: string, extend: boolean) => void;
  onRemove: (imageId: string) => void;
  onSplit: (imageId: string) => void;
  onRotate: (imageId: string) => void;
  onPreview: (imageId: string) => void;
}

/** Controls live inside the drag handle, so their events must not start a drag. */
const swallow = (e: React.SyntheticEvent) => e.stopPropagation();

export default function SortableImage({
  image,
  pageLabel,
  canSplit,
  selected,
  onToggleSelect,
  onRemove,
  onSplit,
  onRotate,
  onPreview,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
  });

  // A drag ends in a click event too, so remember where the press started and
  // only open the preview when the pointer genuinely stayed put.
  const pressAt = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        pressAt.current = { x: e.clientX, y: e.clientY };
        listeners?.onPointerDown?.(e);
      }}
      onClick={(e) => {
        const from = pressAt.current;
        pressAt.current = null;
        if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) < 5) {
          onPreview(image.id);
        }
      }}
      className={`group relative w-[104px] shrink-0 cursor-grab touch-none rounded-lg border bg-[var(--panel)] p-1.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${
        selected
          ? "border-indigo-500 ring-2 ring-indigo-500/40"
          : "border-[var(--line)]"
      } ${isDragging ? "dragging-source" : ""}`}
      title={`${image.name} — ${image.width}×${image.height}px, ${formatBytes(image.bytesLength)}
Click to enlarge`}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded bg-[image:repeating-conic-gradient(#00000010_0_25%,transparent_0_50%)] bg-[length:14px_14px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={image.name}
          draggable={false}
          className="h-full w-full object-contain transition-transform"
          style={{
            // A quarter turn would overflow this 3:4 box, so scale back by the
            // box's own aspect ratio to bring it inside again.
            transform: `rotate(${image.rotation}deg)${
              image.rotation % 180 === 90 ? " scale(0.75)" : ""
            }`,
          }}
        />
        {pageLabel && (
          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
            {pageLabel}
          </span>
        )}
      </div>

      <p className="mt-1 truncate text-[10px] leading-tight text-[var(--ink-soft)]">{image.name}</p>

      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${image.name}`}
        onPointerDown={swallow}
        onKeyDown={swallow}
        onClick={(e) => {
          swallow(e);
          onToggleSelect(image.id, e.shiftKey);
        }}
        title="Select this page — hold Shift to select a range"
        className={`absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded border transition-opacity ${
          selected
            ? "border-indigo-600 bg-indigo-600 text-white opacity-100"
            : "border-white/70 bg-black/50 text-transparent opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        <IconCheck className="h-3 w-3" />
      </button>

      <button
        type="button"
        onPointerDown={swallow}
        onKeyDown={swallow}
        onClick={(e) => {
          swallow(e);
          onRotate(image.id);
        }}
        title="Rotate 90° clockwise"
        className="absolute bottom-6 right-1 rounded bg-black/70 p-1 text-white opacity-0 transition-opacity hover:bg-indigo-600 group-hover:opacity-100 focus:opacity-100"
      >
        <IconRotate className="h-3 w-3" />
      </button>

      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {canSplit && (
          <button
            type="button"
            onPointerDown={swallow}
            onKeyDown={swallow}
            onClick={(e) => {
              swallow(e);
              onSplit(image.id);
            }}
            title="Start a new document here — this image and everything after it move into a new PDF"
            className="rounded bg-black/70 p-1 text-white hover:bg-indigo-600"
          >
            <IconScissors className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onPointerDown={swallow}
          onKeyDown={swallow}
          onClick={(e) => {
            swallow(e);
            onRemove(image.id);
          }}
          title="Remove this image"
          className="rounded bg-black/70 p-1 text-white hover:bg-red-600"
        >
          <IconTrash className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
