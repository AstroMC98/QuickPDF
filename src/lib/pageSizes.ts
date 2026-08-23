import type { PageSizeKey } from "./types";

/** Page dimensions in PDF points, portrait orientation. 72pt = 1 inch. */
export const PAGE_SIZES: Record<Exclude<PageSizeKey, "auto">, [number, number]> = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
};

export const PAGE_SIZE_LABELS: Record<PageSizeKey, string> = {
  auto: "Match image",
  a4: "A4",
  letter: "Letter",
  legal: "Legal",
  a3: "A3",
  a5: "A5",
};
