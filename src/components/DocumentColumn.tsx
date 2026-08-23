"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import SortableImage from "./SortableImage";
import { IconCheck, IconDash, IconMerge, IconTrash } from "./Icons";
import type { DocGroup, ImageItem } from "@/lib/types";

interface Props {
  group: DocGroup;
  index: number;
  images: Record<string, ImageItem>;
  /** Filename this document saves as, tokens resolved. null when it has no pages. */
  resolvedName: string | null;
  selection: Set<string>;
  canMergeUp: boolean;
  onRename: (groupId: string, name: string) => void;
  onDelete: (groupId: string) => void;
  onMergeUp: (groupId: string) => void;
  onRemoveImage: (imageId: string) => void;
  onSplitAt: (groupId: string, imageId: string) => void;
  onToggleSelect: (imageId: string, extend: boolean) => void;
  onSelectAll: (groupId: string, select: boolean) => void;
  onRotate: (imageId: string) => void;
  onPreview: (imageId: string) => void;
}

export default function DocumentColumn({
  group,
  index,
  images,
  resolvedName,
  selection,
  canMergeUp,
  onRename,
  onDelete,
  onMergeUp,
  onRemoveImage,
  onSplitAt,
  onToggleSelect,
  onSelectAll,
  onRotate,
  onPreview,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  const count = group.imageIds.length;
  const selectedHere = group.imageIds.filter((id) => selection.has(id)).length;
  const allSelected = count > 0 && selectedHere === count;

  return (
    <section
      className={`rounded-xl border bg-[var(--panel)] transition-colors ${
        isOver ? "border-indigo-500 ring-2 ring-indigo-500/25" : "border-[var(--line)]"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
          {index + 1}
        </span>

        <input
          value={group.name}
          onChange={(e) => onRename(group.id, e.target.value)}
          placeholder="Document name"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none hover:border-[var(--line)] focus:border-indigo-500 focus:bg-[var(--surface)]"
        />

        {resolvedName ? (
          <code
            className="max-w-[16rem] truncate rounded bg-[var(--surface)] px-2 py-1 font-mono text-[11px] text-[var(--ink-soft)]"
            title={`Saves as ${resolvedName}.pdf`}
          >
            {resolvedName}.pdf
          </code>
        ) : (
          <span className="rounded bg-[var(--surface)] px-2 py-1 text-[11px] italic text-[var(--ink-soft)]">
            empty — nothing will be generated
          </span>
        )}

        <span className="tabular-nums text-xs text-[var(--ink-soft)]">
          {selectedHere > 0 ? `${selectedHere}/${count} selected` : `${count} ${count === 1 ? "page" : "pages"}`}
        </span>

        {count > 0 && (
          <button
            type="button"
            role="checkbox"
            aria-checked={allSelected ? true : selectedHere > 0 ? "mixed" : false}
            onClick={() => onSelectAll(group.id, !allSelected)}
            title={allSelected ? "Deselect every page in this document" : "Select every page in this document"}
            className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
              selectedHere > 0
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-[var(--line)] text-transparent hover:border-indigo-500"
            }`}
          >
            {allSelected ? <IconCheck className="h-3 w-3" /> : <IconDash className="h-3 w-3" />}
          </button>
        )}

        {canMergeUp && (
          <button
            type="button"
            onClick={() => onMergeUp(group.id)}
            title="Merge into the document above"
            className="rounded-md p-1.5 text-[var(--ink-soft)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
          >
            <IconMerge />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(group.id)}
          title="Delete this document (its images return to Unsorted)"
          className="rounded-md p-1.5 text-[var(--ink-soft)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
        >
          <IconTrash />
        </button>
      </header>

      <div ref={setNodeRef} className="min-h-[132px] p-3">
        <SortableContext items={group.imageIds} strategy={rectSortingStrategy}>
          <div className="flex flex-wrap gap-2">
            {group.imageIds.map((id, i) => {
              const image = images[id];
              if (!image) return null;
              return (
                <SortableImage
                  key={id}
                  image={image}
                  pageLabel={String(i + 1)}
                  canSplit={i > 0}
                  selected={selection.has(id)}
                  onToggleSelect={onToggleSelect}
                  onRemove={onRemoveImage}
                  onSplit={(imageId) => onSplitAt(group.id, imageId)}
                  onRotate={onRotate}
                  onPreview={onPreview}
                />
              );
            })}
            {count === 0 && (
              <p className="flex h-[132px] w-full items-center justify-center rounded-lg border border-dashed border-[var(--line)] text-xs text-[var(--ink-soft)]">
                Drag images here, or select pages elsewhere and use “Move to”
              </p>
            )}
          </div>
        </SortableContext>
      </div>
    </section>
  );
}
