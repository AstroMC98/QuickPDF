import type { DeliveryMode, DocGroup, ImageItem, PageSettings, Template } from "./types";

/**
 * Sidecar JSON describing what was exported.
 *
 * The point is that a JSON file found on its own, months later, still explains
 * itself: which PDF it belongs to, which pages went into it in what order,
 * where each page came from, and the settings used to build it. So the batch
 * header is repeated in every per-document file rather than only in the batch
 * summary.
 */

export const METADATA_SCHEMA_VERSION = 1;
export const QUICKPDF_VERSION = "1.0.0";

export interface PageMetadata {
  /** 1-based position within its document. */
  index: number;
  source: string;
  width: number;
  height: number;
  rotation: number;
  bytes: number;
  type: string;
  origin: ImageItem["origin"];
  /** Present only when the page carries marks. Stamp image data is omitted. */
  annotations?: { count: number; kinds: string[] };
}

export interface DocumentMetadata {
  file: string;
  /** The name as typed, before token expansion — useful for rebuilding. */
  namePattern: string;
  pageCount: number;
  pages: PageMetadata[];
}

interface Header {
  quickpdf: { version: string; schema: number };
  generatedAt: string;
  batch: {
    name: string;
    delivery: DeliveryMode;
    documentCount: number;
    pageCount: number;
  };
  template: { name: string; groups: number } | null;
  pageSetup: PageSettings;
}

export interface BatchMetadata extends Header {
  documents: DocumentMetadata[];
}

export interface SingleDocumentMetadata extends Header {
  document: DocumentMetadata;
}

export interface MetadataContext {
  batchName: string;
  delivery: DeliveryMode;
  settings: PageSettings;
  template: Template | null;
  images: Record<string, ImageItem>;
  generatedAt: Date;
}

function header(ctx: MetadataContext, documentCount: number, pageCount: number): Header {
  return {
    quickpdf: { version: QUICKPDF_VERSION, schema: METADATA_SCHEMA_VERSION },
    generatedAt: ctx.generatedAt.toISOString(),
    batch: {
      name: ctx.batchName,
      delivery: ctx.delivery,
      documentCount,
      pageCount,
    },
    template: ctx.template ? { name: ctx.template.name, groups: ctx.template.groups.length } : null,
    pageSetup: { ...ctx.settings },
  };
}

export function describeDocument(
  group: DocGroup,
  fileName: string,
  images: Record<string, ImageItem>,
): DocumentMetadata {
  const pages = group.imageIds
    .map((id) => images[id])
    .filter(Boolean)
    .map((image, i) => ({
      index: i + 1,
      source: image.name,
      width: image.width,
      height: image.height,
      rotation: image.rotation,
      bytes: image.bytesLength,
      type: image.mime,
      origin: image.origin,
      ...(image.annotations?.length
        ? {
            annotations: {
              count: image.annotations.length,
              kinds: [...new Set(image.annotations.map((a) => a.kind))].sort(),
            },
          }
        : {}),
    }));

  return {
    file: `${fileName}.pdf`,
    namePattern: group.name,
    pageCount: pages.length,
    pages,
  };
}

export function buildBatchMetadata(
  groups: DocGroup[],
  fileNames: string[],
  ctx: MetadataContext,
): BatchMetadata {
  const documents = groups.map((g, i) => describeDocument(g, fileNames[i], ctx.images));
  const pageCount = documents.reduce((n, d) => n + d.pageCount, 0);
  return { ...header(ctx, documents.length, pageCount), documents };
}

export function buildDocumentMetadata(
  group: DocGroup,
  fileName: string,
  totalDocuments: number,
  totalPages: number,
  ctx: MetadataContext,
): SingleDocumentMetadata {
  return {
    ...header(ctx, totalDocuments, totalPages),
    document: describeDocument(group, fileName, ctx.images),
  };
}

export function toJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}
