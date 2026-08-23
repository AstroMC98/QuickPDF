import type { Annotation } from "./annotations";

export type PageSizeKey = "auto" | "a4" | "letter" | "legal" | "a3" | "a5";
export type Orientation = "auto" | "portrait" | "landscape";
export type FitMode = "contain" | "cover" | "fill";
export type SortMode = "none" | "name" | "size" | "added";
/** How a multi-document batch reaches the user. */
export type DeliveryMode = "files" | "zip";

/** Where a page came from, recorded so exported metadata can say so. */
export type ImageOrigin =
  | { kind: "upload" }
  | {
      kind: "scan";
      scanner: string;
      source: string;
      resolution: number;
      colorMode: string;
      scannedAt: string;
    };

/** Page geometry applied to every generated PDF page. */
export interface PageSettings {
  pageSize: PageSizeKey;
  orientation: Orientation;
  /** Margin in PDF points (72pt = 1 inch). */
  marginPt: number;
  fit: FitMode;
  /** Hex colour painted behind each image (shows through PNG alpha). */
  background: string;
  /** Only used when pageSize === "auto": px -> pt conversion basis. */
  autoDpi: number;
}

export const DEFAULT_SETTINGS: PageSettings = {
  pageSize: "auto",
  orientation: "auto",
  marginPt: 0,
  fit: "contain",
  background: "#ffffff",
  autoDpi: 96,
};

/** A single uploaded image held entirely in memory. Never leaves the browser. */
export interface ImageItem {
  id: string;
  /** Original filename, e.g. "scan-01.png" */
  name: string;
  /** Raw file bytes, handed straight to pdf-lib. */
  bytes: Uint8Array;
  /** Blob URL for the thumbnail. Must be revoked on removal. */
  url: string;
  mime: string;
  width: number;
  height: number;
  bytesLength: number;
  addedAt: number;
  /** Clockwise degrees, matching CSS: 0, 90, 180 or 270. */
  rotation: number;
  origin: ImageOrigin;
  /** Vector marks laid over the page, in source-image pixel coordinates. */
  annotations: Annotation[];
}

/** One output PDF: a name plus an ordered list of image ids. */
export interface DocGroup {
  id: string;
  name: string;
  imageIds: string[];
}

/** The whole working board. `unassigned` is the staging tray. */
export interface Board {
  unassigned: string[];
  groups: DocGroup[];
}

/** Template group: a name pattern plus how many images it claims. */
export interface TemplateGroup {
  name: string;
  /** Number of images to take, or null for "everything remaining". */
  take: number | null;
}

/** A saved, reusable job shape. Contains no image data. */
export interface Template {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: PageSettings;
  groups: TemplateGroup[];
  /** How to order images before distributing them into groups. */
  sortOnApply: SortMode;
}
