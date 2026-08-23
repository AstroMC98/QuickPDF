"use client";

import { IconNewDoc, IconRotate, IconTrash, IconX } from "./Icons";
import type { DocGroup } from "@/lib/types";

interface Props {
  count: number;
  groups: DocGroup[];
  nameByGroup: Record<string, string>;
  onNewDocument: () => void;
  onMoveTo: (containerId: string) => void;
  onRotate: () => void;
  onRemove: () => void;
  onClear: () => void;
}

/**
 * Appears only while pages are selected. Sticky, because on a long board the
 * pages you selected are often scrolled far away from any fixed toolbar.
 */
export default function SelectionBar({
  count,
  groups,
  nameByGroup,
  onNewDocument,
  onMoveTo,
  onRotate,
  onRemove,
  onClear,
}: Props) {
  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500 bg-indigo-600 px-3 py-2 text-sm text-white shadow-lg">
      <span className="font-semibold tabular-nums">
        {count} page{count === 1 ? "" : "s"} selected
      </span>

      <button
        type="button"
        onClick={onNewDocument}
        title="Move the selected pages into a brand new PDF"
        className="flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 font-medium hover:bg-white/25"
      >
        <IconNewDoc /> New PDF from selection
      </button>

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Move selected pages to</span>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onMoveTo(e.target.value);
            e.target.value = "";
          }}
          className="rounded-md border border-white/30 bg-indigo-700 px-2 py-1.5 font-medium text-white outline-none hover:bg-indigo-800"
        >
          <option value="">Move to…</option>
          {groups.map((g, i) => (
            <option key={g.id} value={g.id}>
              {i + 1}. {nameByGroup[g.id] ?? g.name}
            </option>
          ))}
          <option value="unassigned">Unsorted</option>
        </select>
      </label>

      <button
        type="button"
        onClick={onRotate}
        title="Rotate every selected page 90° clockwise"
        className="flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 font-medium hover:bg-white/25"
      >
        <IconRotate /> Rotate
      </button>

      <button
        type="button"
        onClick={onRemove}
        title="Delete the selected images entirely"
        className="flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 font-medium hover:bg-red-500"
      >
        <IconTrash /> Remove
      </button>

      <button
        type="button"
        onClick={onClear}
        title="Clear the selection (Esc)"
        className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium hover:bg-white/15"
      >
        <IconX /> Clear
      </button>
    </div>
  );
}
