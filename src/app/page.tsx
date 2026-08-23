"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import DocumentColumn from "@/components/DocumentColumn";
import ImagePreview from "@/components/ImagePreview";
import OutputPanel from "@/components/OutputPanel";
import ScanPanel from "@/components/ScanPanel";
import SelectionBar from "@/components/SelectionBar";
import SettingsPanel from "@/components/SettingsPanel";
import SortableImage from "@/components/SortableImage";
import TemplateManager from "@/components/TemplateManager";
import UploadZone from "@/components/UploadZone";
import { IconPlus } from "@/components/Icons";

import { downloadBlob, downloadBytes, toArrayBuffer } from "@/lib/download";
import { fileToImageItem, makeId } from "@/lib/images";
import {
  buildBatchMetadata,
  buildDocumentMetadata,
  toJsonBytes,
  type MetadataContext,
} from "@/lib/metadata";
import { dedupeNames, expandTokens, sanitiseFilename, stripExtension } from "@/lib/naming";
import {
  applyTemplate,
  captureTemplate,
  commitTemplates,
  fillTemplate,
  sortImages,
  subscribeTemplates,
  templatesServerSnapshot,
  templatesSnapshot,
} from "@/lib/templates";
import {
  DEFAULT_SETTINGS,
  type Board,
  type DeliveryMode,
  type DocGroup,
  type ImageItem,
  type ImageOrigin,
  type PageSettings,
  type SortMode,
  type Template,
} from "@/lib/types";

const UNASSIGNED = "unassigned";
const EMPTY_BOARD: Board = { unassigned: [], groups: [] };

/* ---------------- pure board helpers ---------------- */

/** Which container holds `id`? `id` may be a container id or an image id. */
function findContainer(board: Board, id: string): string | null {
  if (id === UNASSIGNED) return UNASSIGNED;
  if (board.groups.some((g) => g.id === id)) return id;
  if (board.unassigned.includes(id)) return UNASSIGNED;
  return board.groups.find((g) => g.imageIds.includes(id))?.id ?? null;
}

function getList(board: Board, containerId: string): string[] {
  if (containerId === UNASSIGNED) return board.unassigned;
  return board.groups.find((g) => g.id === containerId)?.imageIds ?? [];
}

function withList(board: Board, containerId: string, list: string[]): Board {
  if (containerId === UNASSIGNED) return { ...board, unassigned: list };
  return {
    ...board,
    groups: board.groups.map((g) => (g.id === containerId ? { ...g, imageIds: list } : g)),
  };
}

/**
 * Every image id in on-screen order: the Unsorted tray renders above the
 * documents, so this doubles as the reading order that Shift-click ranges and
 * bulk moves follow.
 */
function allIds(board: Board): string[] {
  return [...board.unassigned, ...board.groups.flatMap((g) => g.imageIds)];
}

/** Lift a set of ids out of every container, leaving the rest in place. */
function extractIds(board: Board, ids: Set<string>): Board {
  return {
    unassigned: board.unassigned.filter((i) => !ids.has(i)),
    groups: board.groups.map((g) => ({
      ...g,
      imageIds: g.imageIds.filter((i) => !ids.has(i)),
    })),
  };
}

/* ---------------- page ---------------- */

export default function Home() {
  const [images, setImages] = useState<Record<string, ImageItem>>({});
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [settings, setSettings] = useState<PageSettings>(DEFAULT_SETTINGS);
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [chunkSize, setChunkSize] = useState(2);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  /** Anchor for Shift-click range selection. */
  const [anchorId, setAnchorId] = useState<string | null>(null);
  /** Image currently open in the full-screen viewer, if any. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryMode>("files");
  /** Batch name as typed; empty means "use the suggested one". */
  const [batchName, setBatchName] = useState("");
  const [batchMetadata, setBatchMetadata] = useState(false);
  const [documentMetadata, setDocumentMetadata] = useState(false);

  // Object URLs leak until revoked; keep a live set so cleanup never misses one.
  const urlsRef = useRef<Set<string>>(new Set());

  /**
   * dnd-kit drags exactly one node. To drag a multi-selection we lift the other
   * selected pages out of the board on drag start and splice them back in behind
   * the dragged one on drop. The snapshot lets a cancelled drag put them back.
   */
  const dragStash = useRef<{
    /** The companions lifted out for the duration of the drag. */
    ids: string[];
    /** The whole selection in reading order, re-laid at the drop point. */
    ordered: string[];
    snapshot: Board;
  } | null>(null);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const templates = useSyncExternalStore(
    subscribeTemplates,
    templatesSnapshot,
    templatesServerSnapshot,
  );

  const persist = useCallback((next: Template[]) => commitTemplates(next), []);

  /* ---------------- selection ---------------- */

  const clearSelection = useCallback(() => {
    setSelection(new Set());
    setAnchorId(null);
  }, []);

  const order = useMemo(() => allIds(board), [board]);

  /** Move through every page on the board, wrapping at both ends. */
  const stepPreview = useCallback(
    (delta: number) => {
      setPreviewId((current) => {
        if (!current || order.length === 0) return current;
        const at = order.indexOf(current);
        if (at < 0) return order[0];
        return order[(at + delta + order.length) % order.length];
      });
    },
    [order],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // The viewer takes precedence: closing it should not also wipe a
        // selection the user is still working with.
        if (previewId) setPreviewId(null);
        else clearSelection();
        return;
      }
      if (!previewId) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepPreview(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepPreview(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection, previewId, stepPreview]);

  /**
   * Plain click toggles one page. Shift-click selects everything between the
   * anchor and the clicked page in reading order — across documents, so you can
   * sweep up a run that straddles a boundary.
   */
  const toggleSelect = useCallback(
    (imageId: string, extend: boolean) => {
      setSelection((prev) => {
        const next = new Set(prev);
        if (extend && anchorId && anchorId !== imageId) {
          const order = allIds(board);
          const from = order.indexOf(anchorId);
          const to = order.indexOf(imageId);
          if (from >= 0 && to >= 0) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            for (let i = lo; i <= hi; i += 1) next.add(order[i]);
            return next;
          }
        }
        if (next.has(imageId)) next.delete(imageId);
        else next.add(imageId);
        return next;
      });
      if (!extend) setAnchorId(imageId);
    },
    [anchorId, board],
  );

  const selectAllInGroup = useCallback(
    (groupId: string, select: boolean) => {
      const group = board.groups.find((g) => g.id === groupId);
      if (!group) return;
      setSelection((prev) => {
        const next = new Set(prev);
        group.imageIds.forEach((id) => (select ? next.add(id) : next.delete(id)));
        return next;
      });
      setAnchorId(select ? (group.imageIds.at(-1) ?? null) : null);
    },
    [board],
  );

  const selectEverything = useCallback(() => {
    setSelection(new Set(allIds(board)));
    setAnchorId(null);
  }, [board]);

  /** Selected pages, in reading order — the order they keep when moved. */
  const selectedInOrder = useCallback(
    (b: Board) => allIds(b).filter((id) => selection.has(id)),
    [selection],
  );

  /** Pull the selection out of wherever it lives and drop it into one document. */
  const moveSelectionTo = useCallback(
    (containerId: string) => {
      setBoard((prev) => {
        const ordered = selectedInOrder(prev);
        if (!ordered.length) return prev;
        const stripped = extractIds(prev, selection);
        return withList(stripped, containerId, [...getList(stripped, containerId), ...ordered]);
      });
    },
    [selection, selectedInOrder],
  );

  /**
   * Turn the selection into its own PDF. The new document is inserted right
   * after the one holding the first selected page, so a split lands where you
   * were working rather than at the bottom of a long board.
   */
  const newDocumentFromSelection = useCallback(() => {
    setBoard((prev) => {
      const ordered = selectedInOrder(prev);
      if (!ordered.length) return prev;
      const hostIndex = prev.groups.findIndex((g) => g.imageIds.includes(ordered[0]));
      const stripped = extractIds(prev, selection);
      const groups = [...stripped.groups];
      groups.splice(hostIndex >= 0 ? hostIndex + 1 : groups.length, 0, {
        id: makeId("grp"),
        name: "Document {i}",
        imageIds: ordered,
      });
      return { ...stripped, groups };
    });
  }, [selection, selectedInOrder]);

  /* ---------------- images ---------------- */

  const addFiles = useCallback(async (files: File[], origin: ImageOrigin = { kind: "upload" }) => {
    if (!files.length) return;
    const results = await Promise.allSettled(files.map((f) => fileToImageItem(f, origin)));
    const items = results
      .filter((r): r is PromiseFulfilledResult<ImageItem> => r.status === "fulfilled")
      .map((r) => r.value);
    const failed = results.length - items.length;

    if (!items.length) {
      setNotice({ kind: "error", text: "None of those files could be read as images." });
      return;
    }
    items.forEach((i) => urlsRef.current.add(i.url));

    setImages((prev) => {
      const next = { ...prev };
      items.forEach((i) => {
        next[i.id] = i;
      });
      return next;
    });

    setBoard((prev) => {
      const ids = items.map((i) => i.id);
      // The first drop goes straight into a document — that is the common case.
      if (prev.groups.length === 0) {
        return {
          unassigned: [],
          groups: [{ id: makeId("grp"), name: "Document {i}", imageIds: ids }],
        };
      }
      // With a template in play, pages flow into the documents it laid out.
      if (activeTemplate) return fillTemplate(prev, activeTemplate, ids);
      // Otherwise they wait in Unsorted rather than disturbing finished work.
      return { ...prev, unassigned: [...prev.unassigned, ...ids] };
    });

    if (failed > 0) {
      setNotice({
        kind: "error",
        text: `${failed} file${failed === 1 ? "" : "s"} could not be read and were skipped.`,
      });
    }
  }, [activeTemplate]);

  /** Forget a set of images entirely: board, lookup, object URLs and selection. */
  const dropImages = useCallback((ids: Set<string>) => {
    if (!ids.size) return;
    setBoard((prev) => extractIds(prev, ids));
    setImages((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        const target = next[id];
        if (target) {
          URL.revokeObjectURL(target.url);
          urlsRef.current.delete(target.url);
        }
        delete next[id];
      });
      return next;
    });
    setSelection((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setAnchorId((cur) => (cur && ids.has(cur) ? null : cur));
    setPreviewId((cur) => (cur && ids.has(cur) ? null : cur));
  }, []);

  const removeImage = useCallback(
    (imageId: string) => dropImages(new Set([imageId])),
    [dropImages],
  );

  const removeSelection = useCallback(() => dropImages(selection), [dropImages, selection]);

  /** Quarter-turn clockwise, matching the CSS convention the thumbnails use. */
  const rotateImages = useCallback((ids: Iterable<string>, delta = 90) => {
    const target = new Set(ids);
    if (!target.size) return;
    setImages((prev) => {
      const next = { ...prev };
      target.forEach((id) => {
        const image = next[id];
        if (image) next[id] = { ...image, rotation: (((image.rotation + delta) % 360) + 360) % 360 };
      });
      return next;
    });
  }, []);

  const rotateOne = useCallback((imageId: string) => rotateImages([imageId]), [rotateImages]);
  const rotateSelection = useCallback(() => rotateImages(selection), [rotateImages, selection]);

  const clearAll = useCallback(() => {
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current.clear();
    setImages({});
    setBoard(EMPTY_BOARD);
    setActiveTemplate(null);
    setPreviewId(null);
    clearSelection();
  }, [clearSelection]);

  /* ---------------- documents ---------------- */

  const addGroup = useCallback(() => {
    setBoard((prev) => ({
      ...prev,
      groups: [...prev.groups, { id: makeId("grp"), name: "Document {i}", imageIds: [] }],
    }));
  }, []);

  const renameGroup = useCallback((groupId: string, name: string) => {
    setBoard((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
    }));
  }, []);

  /** Deleting a document returns its images to Unsorted rather than binning them. */
  const deleteGroup = useCallback((groupId: string) => {
    setBoard((prev) => {
      const target = prev.groups.find((g) => g.id === groupId);
      if (!target) return prev;
      return {
        unassigned: [...prev.unassigned, ...target.imageIds],
        groups: prev.groups.filter((g) => g.id !== groupId),
      };
    });
  }, []);

  const mergeUp = useCallback((groupId: string) => {
    setBoard((prev) => {
      const i = prev.groups.findIndex((g) => g.id === groupId);
      if (i <= 0) return prev;
      const groups = [...prev.groups];
      groups[i - 1] = {
        ...groups[i - 1],
        imageIds: [...groups[i - 1].imageIds, ...groups[i].imageIds],
      };
      groups.splice(i, 1);
      return { ...prev, groups };
    });
  }, []);

  /** Cut a document in two at `imageId`, which becomes page 1 of the new one. */
  const splitAt = useCallback((groupId: string, imageId: string) => {
    setBoard((prev) => {
      const i = prev.groups.findIndex((g) => g.id === groupId);
      if (i < 0) return prev;
      const source = prev.groups[i];
      const cut = source.imageIds.indexOf(imageId);
      if (cut <= 0) return prev;
      const groups = [...prev.groups];
      groups[i] = { ...source, imageIds: source.imageIds.slice(0, cut) };
      groups.splice(i + 1, 0, {
        id: makeId("grp"),
        name: "Document {i}",
        imageIds: source.imageIds.slice(cut),
      });
      return { ...prev, groups };
    });
  }, []);

  /** Redistribute every image into fixed-size documents. */
  const autoSplit = useCallback((size: number) => {
    if (size < 1) return;
    setBoard((prev) => {
      const ids = allIds(prev);
      const groups: DocGroup[] = [];
      for (let i = 0; i < ids.length; i += size) {
        groups.push({
          id: makeId("grp"),
          name: "Document {ii}",
          imageIds: ids.slice(i, i + size),
        });
      }
      return { unassigned: [], groups };
    });
  }, []);

  const sortEverything = useCallback(
    (mode: SortMode) => {
      setBoard((prev) => {
        const ordered = sortImages(
          allIds(prev)
            .map((id) => images[id])
            .filter(Boolean),
          mode,
        );
        const rank = new Map(ordered.map((img, i) => [img.id, i]));
        const by = (a: string, b: string) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
        return {
          unassigned: [...prev.unassigned].sort(by),
          groups: prev.groups.map((g) => ({ ...g, imageIds: [...g.imageIds].sort(by) })),
        };
      });
    },
    [images],
  );

  /* ---------------- resolved output names ---------------- */

  const { outputs, outputNames, nameByGroup } = useMemo(() => {
    const nonEmpty = board.groups.filter((g) => g.imageIds.length > 0);
    if (!nonEmpty.length) {
      return {
        outputs: [] as DocGroup[],
        outputNames: [] as string[],
        nameByGroup: {} as Record<string, string>,
      };
    }
    const now = new Date();
    const raw = nonEmpty.map((g, i) =>
      sanitiseFilename(
        expandTokens(g.name, {
          index: i + 1,
          total: nonEmpty.length,
          count: g.imageIds.length,
          first: stripExtension(images[g.imageIds[0]]?.name ?? ""),
          template: activeTemplate?.name ?? "",
          date: now,
        }),
        `Document ${i + 1}`,
      ),
    );
    const names = dedupeNames(raw);
    const map: Record<string, string> = {};
    nonEmpty.forEach((g, i) => {
      map[g.id] = names[i];
    });
    return { outputs: nonEmpty, outputNames: names, nameByGroup: map };
  }, [board.groups, images, activeTemplate]);

  const totalPages = outputs.reduce((n, g) => n + g.imageIds.length, 0);

  /** Name for the zip. Falls back to the template name, then a dated default. */
  const resolvedBatchName = useMemo(() => {
    const now = new Date();
    const fallback = activeTemplate?.name ?? `QuickPDF ${now.toISOString().slice(0, 10)}`;
    const pattern = batchName.trim() || fallback;
    return sanitiseFilename(
      expandTokens(pattern, {
        index: 1,
        total: outputs.length,
        count: totalPages,
        first: stripExtension(images[outputs[0]?.imageIds[0]]?.name ?? ""),
        template: activeTemplate?.name ?? "",
        date: now,
      }),
      "QuickPDF",
    );
  }, [batchName, activeTemplate, outputs, totalPages, images]);

  /**
   * The batch sidecar shares a namespace with the per-document ones, so it steps
   * aside if a document happens to carry the same name.
   */
  const batchMetaName = useMemo(() => {
    const taken = new Set(outputNames.map((n) => n.toLowerCase()));
    return taken.has(resolvedBatchName.toLowerCase())
      ? `${resolvedBatchName} (batch)`
      : resolvedBatchName;
  }, [outputNames, resolvedBatchName]);

  /** Exactly what the export will produce, shown before the user commits. */
  const plannedFiles = useMemo(() => {
    const list: string[] = [];
    outputNames.forEach((name) => {
      list.push(`${name}.pdf`);
      if (documentMetadata) list.push(`${name}.json`);
    });
    if (batchMetadata) list.push(`${batchMetaName}.json`);
    return list;
  }, [outputNames, documentMetadata, batchMetadata, batchMetaName]);

  /* ---------------- templates ---------------- */

  const handleApply = useCallback(
    (template: Template) => {
      // A template describes structure, so it applies perfectly well to an
      // empty board: the documents appear ready, and pages fill them later.
      const pool = allIds(board)
        .map((id) => images[id])
        .filter(Boolean);
      setBoard(applyTemplate(template, pool));
      setSettings({ ...template.settings });
      setActiveTemplate(template);
      clearSelection();
      setNotice({
        kind: "ok",
        text: pool.length
          ? `Applied "${template.name}" to ${pool.length} images.`
          : `Applied "${template.name}" — ${template.groups.length} empty document${
              template.groups.length === 1 ? "" : "s"
            } ready. Pages will fill them as they arrive.`,
      });
    },
    [board, images, clearSelection],
  );

  const handleSave = useCallback(
    (name: string, openEnded: boolean, sortOnApply: SortMode) => {
      const tpl = captureTemplate(name, board, settings, sortOnApply, openEnded);
      persist([...templates, tpl]);
      setActiveTemplate(tpl);
      setNotice({ kind: "ok", text: `Saved template "${tpl.name}".` });
    },
    [board, settings, templates, persist],
  );

  const handleOverwrite = useCallback(
    (templateId: string, openEnded: boolean, sortOnApply: SortMode) => {
      const existing = templates.find((t) => t.id === templateId);
      if (!existing) return;
      const fresh = captureTemplate(existing.name, board, settings, sortOnApply, openEnded);
      const updated: Template = {
        ...fresh,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      persist(templates.map((t) => (t.id === templateId ? updated : t)));
      setActiveTemplate(updated);
      setNotice({ kind: "ok", text: `Updated template "${existing.name}".` });
    },
    [board, settings, templates, persist],
  );

  const handleDeleteTemplate = useCallback(
    (templateId: string) => {
      persist(templates.filter((t) => t.id !== templateId));
      setActiveTemplate((cur) => (cur?.id === templateId ? null : cur));
    },
    [templates, persist],
  );

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(templates, null, 2)], { type: "application/json" });
    downloadBlob(blob, "quickpdf-templates.json");
  }, [templates]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const parsed: unknown = JSON.parse(await file.text());
        const incoming = (Array.isArray(parsed) ? parsed : [parsed]) as Template[];
        // Re-key on import so a shared file can never clobber a local template.
        const rekeyed = incoming
          .filter((t) => t && typeof t.name === "string" && Array.isArray(t.groups))
          .map((t) => ({ ...t, id: makeId("tpl") }));
        if (!rekeyed.length) throw new Error("no templates found");
        persist([...templates, ...rekeyed]);
        setNotice({
          kind: "ok",
          text: `Imported ${rekeyed.length} template${rekeyed.length === 1 ? "" : "s"}.`,
        });
      } catch {
        setNotice({ kind: "error", text: "That file is not a QuickPDF template export." });
      }
    },
    [templates, persist],
  );

  /* ---------------- drag and drop ---------------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * If the grabbed page is part of a multi-selection, stash its companions out
   * of the board for the duration of the drag. dnd-kit then animates a single
   * node as usual and `onDragEnd` re-inserts the rest behind it.
   */
  /**
   * `closestCorners` alone cannot see an empty document: with no pages inside to
   * anchor against, a nearby populated document always wins and the drop
   * silently reverts. `pointerWithin` fixes that because the cursor is literally
   * inside the empty box. The catch is that it also reports the *container* when
   * you hover the gap between pages, which would turn every drop into an append
   * — so when a container wins, narrow to the nearest page within it.
   */
  const collisionDetection: CollisionDetection = (args) => {
    const pointerHits = pointerWithin(args);
    const hits = pointerHits.length ? pointerHits : rectIntersection(args);
    const overId = getFirstCollision(hits, "id");
    if (overId == null) return closestCorners(args);

    const key = String(overId);
    const items =
      key === UNASSIGNED
        ? board.unassigned
        : board.groups.find((g) => g.id === key)?.imageIds;

    if (items && items.length) {
      const inner = closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) => c.id !== overId && items.includes(String(c.id)),
        ),
      });
      const innerId = getFirstCollision(inner, "id");
      if (innerId != null) return [{ id: innerId }];
    }
    return hits;
  };

  const onDragStart = (e: DragStartEvent) => {
    const activeId = String(e.active.id);
    setDragId(activeId);
    if (selection.has(activeId) && selection.size > 1) {
      const ordered = allIds(board).filter((id) => selection.has(id));
      const others = ordered.filter((id) => id !== activeId);
      dragStash.current = { ids: others, ordered, snapshot: board };
      setBoard((prev) => extractIds(prev, new Set(others)));
    } else {
      dragStash.current = null;
    }
  };

  /**
   * Cross-container moves happen live during the drag, not on drop — that is
   * what makes the gap open up under the cursor as you hover a new document.
   * Containers are re-derived inside the updater because several dragover
   * events can queue up before React re-renders.
   */
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    setBoard((prev) => {
      const from = findContainer(prev, activeId);
      const to = findContainer(prev, overId);
      if (!from || !to || from === to) return prev;

      const fromList = getList(prev, from).filter((i) => i !== activeId);
      const toList = getList(prev, to);
      const overIndex = toList.indexOf(overId);
      const insertAt = overIndex >= 0 ? overIndex : toList.length;
      const nextTo = [...toList.slice(0, insertAt), activeId, ...toList.slice(insertAt)];

      return withList(withList(prev, from, fromList), to, nextTo);
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const activeId = String(active.id);
    const stash = dragStash.current;
    dragStash.current = null;
    setDragId(null);

    setBoard((prev) => {
      let next = prev;

      // Same-container reordering. Cross-container moves already happened live.
      if (over) {
        const overId = String(over.id);
        const container = findContainer(prev, activeId);
        if (container && container === findContainer(prev, overId)) {
          const list = getList(prev, container);
          const oldIndex = list.indexOf(activeId);
          const newIndex = list.indexOf(overId);
          if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
            next = withList(prev, container, arrayMove(list, oldIndex, newIndex));
          }
        }
      }

      // Re-lay the whole selection at the drop point, in reading order — so
      // grabbing page 2 of a 1-2-3 selection still delivers 1, 2, 3.
      if (stash?.ids.length) {
        const container = findContainer(next, activeId);
        if (container) {
          const list = getList(next, container);
          const at = list.indexOf(activeId);
          if (at >= 0) {
            const without = list.filter((id) => id !== activeId);
            next = withList(next, container, [
              ...without.slice(0, at),
              ...stash.ordered,
              ...without.slice(at),
            ]);
          }
        }
      }

      return next;
    });
  };

  const onDragCancel = () => {
    const stash = dragStash.current;
    dragStash.current = null;
    setDragId(null);
    if (stash) setBoard(stash.snapshot);
  };

  /* ---------------- generate ---------------- */

  const generate = useCallback(async () => {
    if (!outputs.length) {
      setNotice({ kind: "error", text: "Put at least one image into a document first." });
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: outputs.length });
    try {
      // pdf-lib and JSZip are ~500KB together; load them only on first use.
      const { buildPdf } = await import("@/lib/pdf");
      const built: { name: string; bytes: Uint8Array }[] = [];

      for (let i = 0; i < outputs.length; i += 1) {
        const items = outputs[i].imageIds.map((id) => images[id]).filter(Boolean);
        built.push({ name: outputNames[i], bytes: await buildPdf(items, settings) });
        setProgress({ done: i + 1, total: outputs.length });
        // Yield to the event loop so the progress counter actually repaints.
        await new Promise((r) => setTimeout(r, 0));
      }

      const metaCtx: MetadataContext = {
        batchName: resolvedBatchName,
        delivery,
        settings,
        template: activeTemplate,
        images,
        generatedAt: new Date(),
      };
      const docSidecar = (i: number) =>
        toJsonBytes(
          buildDocumentMetadata(outputs[i], outputNames[i], outputs.length, totalPages, metaCtx),
        );
      const batchSidecar = () =>
        toJsonBytes(buildBatchMetadata(outputs, outputNames, metaCtx));

      // Zipping is only worth it for a real batch; a lone document always comes
      // out as a plain file.
      if (built.length > 1 && delivery === "zip") {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        built.forEach((file, i) => {
          zip.file(`${file.name}.pdf`, toArrayBuffer(file.bytes));
          if (documentMetadata) zip.file(`${file.name}.json`, toArrayBuffer(docSidecar(i)));
        });
        if (batchMetadata) zip.file(`${batchMetaName}.json`, toArrayBuffer(batchSidecar()));
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `${resolvedBatchName}.zip`);
        setNotice({
          kind: "ok",
          text: `Saved ${resolvedBatchName}.zip with ${plannedFiles.length} files.`,
        });
      } else {
        // Browsers drop downloads fired in a tight loop, so they are spaced out.
        const pause = () => new Promise((r) => setTimeout(r, 300));
        for (let i = 0; i < built.length; i += 1) {
          downloadBytes(built[i].bytes, `${built[i].name}.pdf`, "application/pdf");
          await pause();
          if (documentMetadata) {
            downloadBytes(docSidecar(i), `${built[i].name}.json`, "application/json");
            await pause();
          }
        }
        if (batchMetadata) {
          downloadBytes(batchSidecar(), `${batchMetaName}.json`, "application/json");
        }
        setNotice({
          kind: "ok",
          text:
            plannedFiles.length === 1
              ? `Saved ${built[0].name}.pdf`
              : `Saved ${plannedFiles.length} files.`,
        });
      }
    } catch (err) {
      setNotice({
        kind: "error",
        text: `Could not build the PDFs: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
      setProgress({ done: 0, total: 0 });
    }
  }, [
    outputs,
    outputNames,
    images,
    settings,
    delivery,
    resolvedBatchName,
    batchMetaName,
    batchMetadata,
    documentMetadata,
    plannedFiles,
    totalPages,
    activeTemplate,
  ]);

  /* ---------------- render ---------------- */

  const hasImages = Object.keys(images).length > 0;
  // Documents can exist before any page does, once a template has been applied.
  const hasBoard = hasImages || board.groups.length > 0;
  const dragged = dragId ? images[dragId] : null;
  // A multi-selection drags as one stack, badged with how many pages travel.
  const draggingCount = dragId && selection.has(dragId) ? selection.size : 1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // Pages move between documents mid-drag, so rects measured once at drag
      // start go stale and drops land in the wrong place.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col gap-4 p-4 lg:p-6">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold tracking-tight">
            Quick<span className="text-indigo-600 dark:text-indigo-400">PDF</span>
          </h1>
          <p className="text-sm text-[var(--ink-soft)]">
            Arrange images, split them across as many PDFs as you need, then save the arrangement
            as a template.
          </p>
        </header>

        {notice && (
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-sm ${
              notice.kind === "error"
                ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="grid flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          {/* ---- board ---- */}
          <main className="flex min-w-0 flex-col gap-4">
            <UploadZone onFiles={addFiles} compact={hasImages} busy={busy} />

            {hasBoard && (
              <>
                <StagingTray
                  ids={board.unassigned}
                  images={images}
                  selection={selection}
                  onRemove={removeImage}
                  onToggleSelect={toggleSelect}
                  onRotate={rotateOne}
                  onPreview={setPreviewId}
                />

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={addGroup}
                    className="flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 font-medium hover:border-indigo-500 hover:text-indigo-600"
                  >
                    <IconPlus /> Add document
                  </button>

                  <span className="flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1">
                    <span className="text-[var(--ink-soft)]">Split every</span>
                    <input
                      type="number"
                      min={1}
                      value={chunkSize}
                      onChange={(e) => setChunkSize(Math.max(1, Number(e.target.value) || 1))}
                      className="w-12 rounded border border-[var(--line)] bg-[var(--surface)] px-1 py-0.5 text-center tabular-nums outline-none focus:border-indigo-500"
                    />
                    <span className="text-[var(--ink-soft)]">pages</span>
                    <button
                      type="button"
                      onClick={() => autoSplit(chunkSize)}
                      className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      Apply
                    </button>
                  </span>

                  <button
                    type="button"
                    onClick={() => sortEverything("name")}
                    title="Reorder every image by filename — page2 lands before page10"
                    className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 font-medium hover:border-indigo-500 hover:text-indigo-600"
                  >
                    Sort by name
                  </button>

                  <button
                    type="button"
                    onClick={selectEverything}
                    title="Select every page, then use the selection bar to assign them"
                    className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 font-medium hover:border-indigo-500 hover:text-indigo-600"
                  >
                    Select all
                  </button>

                  <button
                    type="button"
                    onClick={clearAll}
                    className="ml-auto rounded-md px-3 py-1.5 font-medium text-[var(--ink-soft)] hover:text-red-600"
                  >
                    Clear all
                  </button>
                </div>

                {selection.size > 0 && (
                  <SelectionBar
                    count={selection.size}
                    groups={board.groups}
                    nameByGroup={nameByGroup}
                    onNewDocument={newDocumentFromSelection}
                    onMoveTo={moveSelectionTo}
                    onRotate={rotateSelection}
                    onRemove={removeSelection}
                    onClear={clearSelection}
                  />
                )}

                <div className="flex flex-col gap-3">
                  {board.groups.map((group, i) => (
                    <DocumentColumn
                      key={group.id}
                      group={group}
                      index={i}
                      images={images}
                      resolvedName={nameByGroup[group.id] ?? null}
                      selection={selection}
                      canMergeUp={i > 0}
                      onRename={renameGroup}
                      onDelete={deleteGroup}
                      onMergeUp={mergeUp}
                      onRemoveImage={removeImage}
                      onSplitAt={splitAt}
                      onToggleSelect={toggleSelect}
                      onSelectAll={selectAllInGroup}
                      onRotate={rotateOne}
                      onPreview={setPreviewId}
                    />
                  ))}
                  {board.groups.length === 0 && (
                    <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
                      No documents yet. Add one, then drag images into it.
                    </p>
                  )}
                </div>
              </>
            )}
          </main>

          {/* ---- sidebar ---- */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
            <Panel title="Output">
              <OutputPanel
                documentCount={outputs.length}
                totalPages={totalPages}
                plannedFiles={plannedFiles}
                delivery={delivery}
                onDeliveryChange={setDelivery}
                batchName={batchName}
                onBatchNameChange={setBatchName}
                resolvedBatchName={resolvedBatchName}
                batchMetadata={batchMetadata}
                onBatchMetadataChange={setBatchMetadata}
                documentMetadata={documentMetadata}
                onDocumentMetadataChange={setDocumentMetadata}
                busy={busy}
                progress={progress}
                onGenerate={generate}
              />
            </Panel>

            <Panel title="Scan">
              <ScanPanel onPages={addFiles} disabled={busy} />
            </Panel>

            <Panel title="Page setup">
              <SettingsPanel
                settings={settings}
                onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
              />
            </Panel>

            <Panel title="Templates">
              <TemplateManager
                templates={templates}
                activeTemplateId={activeTemplate?.id ?? null}
                groupCount={board.groups.length}
                onApply={handleApply}
                onSave={handleSave}
                onOverwrite={handleOverwrite}
                onDelete={handleDeleteTemplate}
                onImport={handleImport}
                onExport={handleExport}
              />
            </Panel>
          </aside>
        </div>

        <footer className="pt-2 text-center text-xs text-[var(--ink-soft)]">
          Images are read, arranged and converted inside this browser tab. Nothing is uploaded.
        </footer>
      </div>

      {previewId && images[previewId] && (
        <ImagePreview
          image={images[previewId]}
          position={order.indexOf(previewId) + 1}
          total={order.length}
          onClose={() => setPreviewId(null)}
          onPrev={() => stepPreview(-1)}
          onNext={() => stepPreview(1)}
          onRotate={rotateOne}
        />
      )}

      <DragOverlay>
        {dragged && (
          <div className="relative w-[104px] rotate-2 rounded-lg border border-indigo-500 bg-[var(--panel)] p-1.5 shadow-xl">
            <div className="aspect-[3/4] overflow-hidden rounded">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={dragged.url}
                alt=""
                className="h-full w-full object-contain"
                style={{
                  transform: `rotate(${dragged.rotation}deg)${dragged.rotation % 180 === 90 ? " scale(0.75)" : ""}`,
                }}
              />
            </div>
            <p className="mt-1 truncate text-[10px] text-[var(--ink-soft)]">{dragged.name}</p>
            {draggingCount > 1 && (
              <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-xs font-bold tabular-nums text-white shadow">
                {draggingCount}
              </span>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/* ---------------- small local pieces ---------------- */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The parking bay for images that belong to no document yet. It stays visible
 * even when empty — otherwise there would be nowhere to drag an image *out* of
 * a document to.
 */
function StagingTray({
  ids,
  images,
  selection,
  onRemove,
  onToggleSelect,
  onRotate,
  onPreview,
}: {
  ids: string[];
  images: Record<string, ImageItem>;
  selection: Set<string>;
  onRemove: (id: string) => void;
  onToggleSelect: (imageId: string, extend: boolean) => void;
  onRotate: (imageId: string) => void;
  onPreview: (imageId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNASSIGNED });

  return (
    <section
      ref={setNodeRef}
      className={`rounded-xl border p-3 transition-colors ${
        isOver ? "border-indigo-500 bg-indigo-500/5" : "border-[var(--line)] bg-[var(--panel)]"
      }`}
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)]">
        Unsorted · {ids.length}
      </h2>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="tray flex min-h-[40px] gap-2 overflow-x-auto pb-1">
          {ids.map((id) =>
            images[id] ? (
              <SortableImage
                key={id}
                image={images[id]}
                canSplit={false}
                selected={selection.has(id)}
                onToggleSelect={onToggleSelect}
                onRemove={onRemove}
                onSplit={() => {}}
                onRotate={onRotate}
                onPreview={onPreview}
              />
            ) : null,
          )}
          {ids.length === 0 && (
            <p className="flex h-10 items-center text-xs text-[var(--ink-soft)]">
              Empty — drag an image here to pull it out of a document.
            </p>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
