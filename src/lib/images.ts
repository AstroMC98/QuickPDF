import type { ImageItem, ImageOrigin } from "./types";

export const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"];
export const ACCEPTED_EXT = /\.(png|jpe?g|webp)$/i;

export function isAcceptedFile(file: File): boolean {
  return ACCEPTED_MIME.includes(file.type) || ACCEPTED_EXT.test(file.name);
}

let counter = 0;
export function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/**
 * Read intrinsic pixel dimensions. `createImageBitmap` is the fast path
 * (decodes off the main thread); the <img> fallback covers older Safari.
 */
async function readDimensions(
  blob: Blob,
  url: string,
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dims;
    } catch {
      /* fall through to the <img> path */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = url;
  });
}

export async function fileToImageItem(
  file: File,
  origin: ImageOrigin = { kind: "upload" },
): Promise<ImageItem> {
  const buffer = await file.arrayBuffer();
  const url = URL.createObjectURL(file);
  const { width, height } = await readDimensions(file, url);
  return {
    id: makeId("img"),
    name: file.name,
    bytes: new Uint8Array(buffer),
    url,
    mime: file.type || (/\.png$/i.test(file.name) ? "image/png" : "image/jpeg"),
    width,
    height,
    bytesLength: file.size,
    addedAt: Date.now(),
    rotation: 0,
    origin,
    annotations: [],
  };
}

/** Walk a dropped directory tree; plain file drops resolve immediately. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .filter((item) => item.kind === "file")
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null));

  if (entries.some(Boolean)) {
    const out: File[] = [];
    await Promise.all(entries.map((entry) => entry && walkEntry(entry, out)));
    if (out.length) return out;
  }
  return Array.from(dt.files);
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
    );
    if (file) out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most 100 entries per call, so drain it in a loop.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      );
      if (!batch.length) break;
      await Promise.all(batch.map((child) => walkEntry(child, out)));
    }
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
