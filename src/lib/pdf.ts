import { PDFDocument, degrees, rgb, type PDFImage } from "pdf-lib";
import { PAGE_SIZES } from "./pageSizes";
import { toArrayBuffer } from "./download";
import type { ImageItem, PageSettings } from "./types";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 1, g: 1, b: 1 };
  const int = parseInt(m[1], 16);
  return {
    r: ((int >> 16) & 255) / 255,
    g: ((int >> 8) & 255) / 255,
    b: (int & 255) / 255,
  };
}

/**
 * pdf-lib only decodes a subset of PNG (no 16-bit, no interlace). When it
 * refuses, round-trip the pixels through a canvas to get a plain 8-bit RGBA
 * PNG it will accept. Costs a decode, but only on the images that need it.
 */
async function recodeViaCanvas(item: ImageItem): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(
    new Blob([toArrayBuffer(item.bytes)], { type: item.mime }),
  );
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Canvas re-encode failed");
  return new Uint8Array(await blob.arrayBuffer());
}

async function embedImage(pdf: PDFDocument, item: ImageItem): Promise<PDFImage> {
  const isJpeg = item.mime === "image/jpeg" || /\.jpe?g$/i.test(item.name);
  try {
    return isJpeg ? await pdf.embedJpg(item.bytes) : await pdf.embedPng(item.bytes);
  } catch {
    return pdf.embedPng(await recodeViaCanvas(item));
  }
}

/**
 * Rotation is stored clockwise (CSS convention, so the thumbnail and the PDF
 * agree). PDF rotates counter-clockwise, hence the mirror.
 */
function pdfAngle(rotation: number): number {
  return (360 - (((rotation % 360) + 360) % 360)) % 360;
}

function pageDimensions(
  settings: PageSettings,
  imgW: number,
  imgH: number,
): [number, number] {
  if (settings.pageSize === "auto") {
    // The page becomes exactly as large as the image at the chosen DPI, plus
    // margins — so nothing is ever resampled or letterboxed.
    const scale = 72 / (settings.autoDpi || 96);
    const w = imgW * scale + settings.marginPt * 2;
    const h = imgH * scale + settings.marginPt * 2;
    if (settings.orientation === "landscape" && h > w) return [h, w];
    if (settings.orientation === "portrait" && w > h) return [h, w];
    return [w, h];
  }
  const [shortSide, longSide] = PAGE_SIZES[settings.pageSize];
  const landscape =
    settings.orientation === "landscape" ||
    (settings.orientation === "auto" && imgW > imgH);
  return landscape ? [longSide, shortSide] : [shortSide, longSide];
}

/** Build one PDF from an ordered list of images. Returns raw PDF bytes. */
export async function buildPdf(
  images: ImageItem[],
  settings: PageSettings,
): Promise<Uint8Array> {
  // Without updateMetadata:false, pdf-lib overwrites Producer/Creator on save.
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setProducer("QuickPDF");
  pdf.setCreator("QuickPDF");

  const bg = hexToRgb(settings.background);

  for (const item of images) {
    const embedded = await embedImage(pdf, item);
    const imgW = embedded.width;
    const imgH = embedded.height;

    const angle = pdfAngle(item.rotation ?? 0);
    const swap = angle === 90 || angle === 270;
    // Everything about layout uses the rotated footprint; only drawImage
    // itself works in the image's own unrotated axes.
    const rotW = swap ? imgH : imgW;
    const rotH = swap ? imgW : imgH;

    const [pageW, pageH] = pageDimensions(settings, rotW, rotH);
    const page = pdf.addPage([pageW, pageH]);

    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageW,
      height: pageH,
      color: rgb(bg.r, bg.g, bg.b),
    });

    const m = settings.marginPt;
    const boxW = Math.max(1, pageW - m * 2);
    const boxH = Math.max(1, pageH - m * 2);

    let drawW: number;
    let drawH: number;
    if (settings.fit === "fill") {
      // Stretch so the *rotated* footprint fills the box exactly.
      drawW = swap ? boxH : boxW;
      drawH = swap ? boxW : boxH;
    } else {
      // contain -> largest scale that fits inside; cover -> smallest that covers.
      const scale =
        settings.fit === "cover"
          ? Math.max(boxW / rotW, boxH / rotH)
          : Math.min(boxW / rotW, boxH / rotH);
      drawW = imgW * scale;
      drawH = imgH * scale;
    }

    // Footprint the rotated image actually occupies on the page.
    const spanW = swap ? drawH : drawW;
    const spanH = swap ? drawW : drawH;
    const originX = m + (boxW - spanW) / 2;
    const originY = m + (boxH - spanH) / 2;

    // drawImage rotates about its own (x, y) anchor, so the anchor moves to a
    // different corner of the footprint for each quarter turn.
    let x = originX;
    let y = originY;
    if (angle === 90) {
      x = originX + spanW;
    } else if (angle === 180) {
      x = originX + spanW;
      y = originY + spanH;
    } else if (angle === 270) {
      y = originY + spanH;
    }

    page.drawImage(embedded, {
      x,
      y,
      width: drawW,
      height: drawH,
      rotate: degrees(angle),
    });
  }

  return pdf.save();
}
