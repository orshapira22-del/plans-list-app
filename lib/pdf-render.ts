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

  // Find the title-block position via the plan number's display position.
  // The Glotan title block sits at a page corner (bottom-left for these plans),
  // but it doesn't always sit FLUSH — table sheets float higher with a bottom
  // margin — so we anchor the crop's bottom edge to the plan-number box (which is
  // always at the title-block bottom) rather than the page corner.
  let cornerX = 0;                 // default = left
  let anchorBottom = baseVp.height; // default = page bottom
  if (planNumber) {
    const anchor = items.find((it) => it.str.includes(planNumber.slice(0, 12)));
    if (anchor) {
      const [vx, vy] = baseVp.convertToViewportPoint(anchor.tx, anchor.ty);
      cornerX = vx < baseVp.width / 2 ? 0 : baseVp.width;
      anchorBottom = vy; // title-block bottom in viewport space
    }
  }

  // The title block has a roughly FIXED PHYSICAL SIZE (~540×470 pt) regardless of
  // page dimensions, so we crop a fixed number of PDF points — not a page fraction
  // (page sizes vary 2x+ between disciplines, which broke fraction-based crops).
  const CROP_W_PTS = 560;
  const CROP_H_PTS = 480;
  const STRIP_W = Math.min(CROP_W_PTS, baseVp.width);
  const STRIP_H = Math.min(CROP_H_PTS, baseVp.height);
  const stripX = cornerX === 0 ? 0 : cornerX - STRIP_W;
  const stripBottom = Math.min(baseVp.height, anchorBottom + STRIP_H * 0.05);
  const stripY = Math.max(0, stripBottom - STRIP_H);

  // Render ONLY the crop region at OCR-ready DPI (~700px wide, matching the
  // server). Rasterising just the title block — via a translated viewport into a
  // crop-sized canvas — avoids the full-page memory blow-up, so we don't have to
  // cap resolution (the old full-page cap dropped big pages to ~280px and garbled
  // the Hebrew OCR).
  const TARGET_CROP_PX = 700;
  const pageScale = TARGET_CROP_PX / STRIP_W;
  const sw = Math.round(STRIP_W * pageScale);
  const sh = Math.round(STRIP_H * pageScale);
  const pageVp = page.getViewport({ scale: pageScale });
  const stripCanvas = document.createElement("canvas");
  stripCanvas.width = sw;
  stripCanvas.height = sh;
  const ctx = stripCanvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sw, sh);
  // Offset the page so the crop region maps to the canvas origin.
  await page.render({
    canvasContext: ctx,
    viewport: pageVp,
    transform: [1, 0, 0, 1, -Math.round(stripX * pageScale), -Math.round(stripY * pageScale)],
  }).promise;

  // The OCR'd image and the preview must be the SAME bitmap so the returned line
  // boxes line up with it (the browser-side stage detector samples this image).
  const stripPreview = stripCanvas.toDataURL("image/jpeg", 0.9);

  doc.destroy();
  return { stripCanvas, stripPreview, planNumber, scale, date };
}

