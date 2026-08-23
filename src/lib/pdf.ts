import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
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

/* ---------------- annotations ---------------- */

/**
 * Annotations live in source-image pixels with y pointing down. Getting them
 * onto the page means walking the same transform pdf-lib applies to the image
 * itself: normalise, flip to PDF's y-up, scale to the drawn size, rotate about
 * the anchor, then translate. Doing it here keeps marks as real vector content
 * — crisp at any zoom, and selectable text stays text.
 */
function makeMapper(
  imgW: number,
  imgH: number,
  drawW: number,
  drawH: number,
  angle: number,
  anchorX: number,
  anchorY: number,
) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return (px: number, py: number): [number, number] => {
    const sx = (px / imgW) * drawW;
    const sy = (1 - py / imgH) * drawH;
    return [anchorX + sx * cos - sy * sin, anchorY + sx * sin + sy * cos];
  };
}

function hexToPdfColor(hex: string) {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0, 0, 0);
  const int = parseInt(m[1], 16);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}

async function drawAnnotations(
  pdf: PDFDocument,
  page: PDFPage,
  item: ImageItem,
  drawW: number,
  drawH: number,
  angle: number,
  anchorX: number,
  anchorY: number,
  font: PDFFont,
) {
  const annotations = item.annotations ?? [];
  if (!annotations.length) return;

  const map = makeMapper(item.width, item.height, drawW, drawH, angle, anchorX, anchorY);
  // Stroke widths and glyph sizes are lengths, not points, so they take the
  // page-to-image scale rather than the full transform.
  const unit = drawW / item.width;

  for (const a of annotations) {
    const color = "color" in a ? hexToPdfColor(a.color) : rgb(0, 0, 0);
    const thickness = "width" in a ? Math.max(0.2, a.width * unit) : 1;

    if (a.kind === "ink") {
      for (let i = 1; i < a.points.length; i += 1) {
        const [x1, y1] = map(a.points[i - 1][0], a.points[i - 1][1]);
        const [x2, y2] = map(a.points[i][0], a.points[i][1]);
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
      }
      continue;
    }

    if (a.kind === "arrow") {
      const [x1, y1] = map(a.x1, a.y1);
      const [x2, y2] = map(a.x2, a.y2);
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
      // Build the head in image space so it rotates with everything else.
      const heading = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const head = Math.max(a.width * 3.5, 8);
      const wing = Math.PI / 7;
      for (const side of [-wing, wing]) {
        const [hx, hy] = map(
          a.x2 - head * Math.cos(heading + side),
          a.y2 - head * Math.sin(heading + side),
        );
        page.drawLine({ start: { x: x2, y: y2 }, end: { x: hx, y: hy }, thickness, color });
      }
      continue;
    }

    if (a.kind === "text") {
      // The SVG anchors text by its top edge; PDF anchors by the baseline.
      const [x, y] = map(a.x, a.y + a.size * 0.82);
      page.drawText(a.text, {
        x,
        y,
        size: a.size * unit,
        font,
        color,
        rotate: degrees(angle),
      });
      continue;
    }

    if (a.kind === "stamp") {
      const bytes = dataUrlToBytes(a.src);
      if (!bytes) continue;
      const embedded = /^data:image\/jpe?g/i.test(a.src)
        ? await pdf.embedJpg(bytes)
        : await pdf.embedPng(bytes);
      // drawImage anchors at the bottom-left of the placed box.
      const [x, y] = map(a.x, a.y + a.h);
      page.drawImage(embedded, {
        x,
        y,
        width: a.w * unit,
        height: a.h * (drawH / item.height),
        rotate: degrees(angle),
      });
      continue;
    }

    // Rectangles and ellipses.
    const [x, y] = map(a.x, a.y + a.h);
    const boxW = a.w * unit;
    const boxH = a.h * (drawH / item.height);
    const shared = {
      x,
      y,
      width: boxW,
      height: boxH,
      rotate: degrees(angle),
      borderColor: color,
      borderWidth: thickness,
      ...(a.fill ? { color: hexToPdfColor(a.fill) } : {}),
    };
    if (a.kind === "rect") {
      page.drawRectangle(shared);
    } else {
      page.drawEllipse({
        ...shared,
        x: x + boxW / 2,
        y: y + boxH / 2,
        xScale: boxW / 2,
        yScale: boxH / 2,
      });
    }
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
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
  // Helvetica is one of the 14 standard faces, so it needs no embedding.
  let font: PDFFont | null = null;

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

    if (item.annotations?.length) {
      font ??= await pdf.embedFont(StandardFonts.Helvetica);
      await drawAnnotations(pdf, page, item, drawW, drawH, angle, x, y, font);
    }
  }

  return pdf.save();
}
