"use client";

import * as pdfjs from "pdfjs-dist";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

const PLAN_NUM_RE = /\b[A-Z]{2,4}(?:[-_][A-Z0-9]+){4,}\b/g;
const WBS_RE = /^WBS\b/i;
// Greedy on the right side so 200/500/1000 don't get truncated to 2/5/1.
const SCALE_RE = /\b1\s*[:/]\s*\d{2,4}(?:\s*[/\\]\s*\d{2,4})?\b/;
const SCALE_HEB_RE = /(כמסומן|לפי\s*הסימון|מסומן)/;
const DATE_RE = /\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/;

export function pickPlanNumber(text: string): string {
  const matches = text.match(PLAN_NUM_RE) ?? [];
  const ok = matches
    .map((m) => m.replace(/\.(pdf|dwg).*$/i, ""))
    .filter((m) => !WBS_RE.test(m));
  if (ok.length === 0) return "";
  return ok.sort((a, b) => b.length - a.length)[0];
}

export type StripResult = {
  /** Full title-block crop at OCR-ready DPI. */
  stripCanvas: HTMLCanvasElement;
  /** Compact preview of the title-block (data URL), shown in the UI. */
  stripPreview: string;
  planNumber: string;
  scale: string;
  /** Date directly from the text layer if present (avoids OCR). */
  date: string;
};

type TI = { str: string; tx: number; ty: number };

/** Render two narrow cell crops from the bottom-left Glotan title block. */
export async function renderStripCells(buf: ArrayBuffer): Promise<StripResult> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(1);
  // Use the document's natural orientation (rotation applied) so the bottom-left
  // title block sits at the bottom-left of the viewport, matching the physical layout.
  const baseVp = page.getViewport({ scale: 1 });

  const content = await page.getTextContent();
  const items: TI[] = content.items
    .map((it) => {
      const s = "str" in it ? (it as { str: string }).str : "";
      const t = (it as { transform: number[] }).transform;
      return { str: s, tx: t[4], ty: t[5] };
    })
    .filter((i) => i.str && i.str.trim());

  // Pulls from the (clean) text layer
  const allText = items.map((i) => i.str).join("\n");
  const planNumber = pickPlanNumber(allText);
  const numScale = allText.match(SCALE_RE)?.[0];
  const heb = allText.match(SCALE_HEB_RE)?.[0];
  const scale = (numScale ?? heb ?? "").replace(/\s+/g, "");
  const date = allText.match(DATE_RE)?.[0] ?? "";

  // Find the title-block corner via the plan number's display position
  let cornerX = 0, cornerY = baseVp.height; // default = bottom-left
  if (planNumber) {
    const anchor = items.find((it) => it.str.includes(planNumber.slice(0, 12)));
    if (anchor) {
      const [vx, vy] = baseVp.convertToViewportPoint(anchor.tx, anchor.ty);
      // Determine which corner this anchor sits in; "corner" = the corner closest to it.
      cornerX = vx < baseVp.width / 2 ? 0 : baseVp.width;
      cornerY = vy < baseVp.height / 2 ? 0 : baseVp.height;
    }
  }

  // Strip box (full title-block, the same one we cropped & verified by eye)
  const STRIP_W = baseVp.width * 0.11;
  const STRIP_H = baseVp.height * 0.17;
  const stripX = cornerX === 0 ? 0 : cornerX - STRIP_W;
  const stripY = cornerY === 0 ? 0 : cornerY - STRIP_H;

  // Render the whole page at moderate DPI. The title-block crop becomes the
  // image we send to Azure OCR — 1800 keeps the strip around 200px wide,
  // which is plenty for Azure's READ model on Hebrew text.
  const FULL_WIDTH_TARGET = 1800;
  const pageScale = FULL_WIDTH_TARGET / baseVp.width;
  const pageVp = page.getViewport({ scale: pageScale });
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = Math.ceil(pageVp.width);
  pageCanvas.height = Math.ceil(pageVp.height);
  const pageCtx = pageCanvas.getContext("2d")!;
  pageCtx.fillStyle = "#ffffff";
  pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
  await page.render({ canvasContext: pageCtx, viewport: pageVp }).promise;

  // Crop the strip from the full-page bitmap
  const sx = Math.round(stripX * pageScale);
  const sy = Math.round(stripY * pageScale);
  const sw = Math.round(STRIP_W * pageScale);
  const sh = Math.round(STRIP_H * pageScale);
  const stripCanvas = document.createElement("canvas");
  stripCanvas.width = sw;
  stripCanvas.height = sh;
  const ctx = stripCanvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // Lightweight preview for the UI (max 480px wide JPEG ≈ 30-60 KB)
  const previewW = 480;
  const previewH = Math.round((stripCanvas.height / stripCanvas.width) * previewW);
  const preview = document.createElement("canvas");
  preview.width = previewW;
  preview.height = previewH;
  const pctx = preview.getContext("2d")!;
  pctx.fillStyle = "#ffffff";
  pctx.fillRect(0, 0, previewW, previewH);
  pctx.imageSmoothingQuality = "high";
  pctx.drawImage(stripCanvas, 0, 0, previewW, previewH);
  const stripPreview = preview.toDataURL("image/jpeg", 0.78);

  doc.destroy();
  return { stripCanvas, stripPreview, planNumber, scale, date };
}

