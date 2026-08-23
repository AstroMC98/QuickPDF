import { makeId } from "./images";
import { DEFAULT_SETTINGS, type Board, type ImageItem, type PageSettings, type SortMode, type Template } from "./types";

const STORAGE_KEY = "quickpdf.templates.v1";

export function loadTemplates(): Template[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTemplate).map(normalise);
  } catch {
    return [];
  }
}

export function saveTemplates(templates: Template[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

function isTemplate(v: unknown): v is Template {
  const t = v as Partial<Template> | null;
  return !!t && typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.groups);
}

/** Fill in fields added by later versions so old saved templates keep working. */
function normalise(t: Template): Template {
  return {
    ...t,
    settings: { ...DEFAULT_SETTINGS, ...(t.settings ?? {}) },
    sortOnApply: t.sortOnApply ?? "none",
    createdAt: t.createdAt ?? Date.now(),
    updatedAt: t.updatedAt ?? t.createdAt ?? Date.now(),
    groups: t.groups.map((g) => ({
      name: typeof g.name === "string" ? g.name : "Document {i}",
      take: typeof g.take === "number" && g.take > 0 ? Math.floor(g.take) : null,
    })),
  };
}

/**
 * Freeze the current board into a reusable template. Image *counts* are kept,
 * image identities are not — that is what lets the template be replayed on a
 * completely different batch of uploads.
 *
 * The final group is stored with `take: null` ("everything remaining") so a
 * template built from 10 images still absorbs all 30 of the next batch.
 */
export function captureTemplate(
  name: string,
  board: Board,
  settings: PageSettings,
  sortOnApply: SortMode,
  openEndedLastGroup: boolean,
): Template {
  const now = Date.now();
  const groups = board.groups.map((g, i) => ({
    name: g.name,
    take:
      openEndedLastGroup && i === board.groups.length - 1
        ? null
        : g.imageIds.length || null,
  }));
  return {
    id: makeId("tpl"),
    name: name.trim() || "Untitled template",
    createdAt: now,
    updatedAt: now,
    settings: { ...settings },
    groups: groups.length ? groups : [{ name: "Document {i}", take: null }],
    sortOnApply,
  };
}

export function sortImages(images: ImageItem[], mode: SortMode): ImageItem[] {
  const copy = [...images];
  switch (mode) {
    case "name":
      // Natural sort: "page2" must come before "page10".
      return copy.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      );
    case "size":
      return copy.sort((a, b) => a.bytesLength - b.bytesLength);
    case "added":
      return copy.sort((a, b) => a.addedAt - b.addedAt);
    default:
      return copy;
  }
}

/**
 * Replay a template over a set of images.
 *
 * Groups with a fixed `take` are served first, in order. Whatever is left is
 * shared evenly between the open-ended (`take: null`) groups, with the earlier
 * ones taking the extra when it does not divide cleanly. If the template has no
 * open-ended group, surplus images land back in the staging tray rather than
 * being silently dropped.
 */
export function applyTemplate(template: Template, images: ImageItem[]): Board {
  const ordered = sortImages(images, template.sortOnApply);
  const ids = ordered.map((img) => img.id);

  const fixedTotal = template.groups.reduce((sum, g) => sum + (g.take ?? 0), 0);
  const openGroups = template.groups.filter((g) => g.take === null).length;
  const remainder = Math.max(0, ids.length - fixedTotal);

  const base = openGroups ? Math.floor(remainder / openGroups) : 0;
  let extra = openGroups ? remainder % openGroups : 0;

  let cursor = 0;
  const groups = template.groups.map((g) => {
    let take: number;
    if (g.take === null) {
      take = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
    } else {
      take = g.take;
    }
    const slice = ids.slice(cursor, cursor + take);
    cursor += slice.length;
    return { id: makeId("grp"), name: g.name, imageIds: slice };
  });

  return { unassigned: ids.slice(cursor), groups };
}

/**
 * Place newly arrived images into a template's documents, filling each up to
 * its declared page count before moving to the next.
 *
 * This is the incremental counterpart to `applyTemplate`: it never disturbs
 * pages already placed, which is what makes "apply the template, then scan"
 * work. One consequence of being incremental: an open-ended group has no
 * capacity to reach, so it keeps everything from the point it is reached
 * onwards — where a whole-batch apply would have split the remainder evenly
 * between several open-ended groups.
 */
export function fillTemplate(board: Board, template: Template, newIds: string[]): Board {
  const groups = board.groups.map((g) => ({ ...g, imageIds: [...g.imageIds] }));
  const leftovers: string[] = [];
  let cursor = 0;

  for (const id of newIds) {
    let placed = false;
    while (cursor < groups.length) {
      // Documents beyond the template's own list have no declared limit.
      const capacity = template.groups[cursor]?.take ?? Infinity;
      if (groups[cursor].imageIds.length < capacity) {
        groups[cursor].imageIds.push(id);
        placed = true;
        break;
      }
      cursor += 1;
    }
    if (!placed) leftovers.push(id);
  }

  return { unassigned: [...board.unassigned, ...leftovers], groups };
}

/* ---------------- external store ---------------- */

/**
 * localStorage is an external system, so templates are exposed through
 * `useSyncExternalStore` rather than being copied into React state by an
 * effect. Side benefit: the `storage` event keeps two open tabs in agreement.
 *
 * `getSnapshot` must return a referentially stable value between changes or
 * React re-renders forever — hence the cache.
 */
let cache: Template[] | null = null;
const EMPTY: Template[] = [];
const listeners = new Set<() => void>();

function handleStorage(e: StorageEvent) {
  if (e.key === STORAGE_KEY) {
    cache = null;
    listeners.forEach((l) => l());
  }
}

export function subscribeTemplates(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", handleStorage);
  };
}

export function templatesSnapshot(): Template[] {
  if (cache === null) cache = loadTemplates();
  return cache;
}

/** The server has no localStorage, so it always renders the empty list. */
export function templatesServerSnapshot(): Template[] {
  return EMPTY;
}

export function commitTemplates(next: Template[]): void {
  cache = next;
  saveTemplates(next);
  listeners.forEach((l) => l());
}
