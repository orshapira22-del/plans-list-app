"use client";

/**
 * Fast server-side extraction: the plans-list-api Vercel function renders the
 * title-block strip (PyMuPDF) and runs Azure OCR with a server-held key.
 * The browser does no PDF rendering and needs no credentials.
 *
 * Fallback: Vercel rejects request bodies over ~4.5MB, so for oversized PDFs we
 * render the strip in the browser (slow, rare) and send just the JPEG for OCR.
 */

import { renderStripCells, pickPlanNumber } from "./pdf-render";
import {
  pickFullName, pickNameFromLines, pickProjectFromLines,
  pickDate, pickScale, buildPurpose, buildPlanningPhase, type OcrLine,
} from "./ocr-parse";
import { decodeStatus, decodeRevision } from "./plan-code";
import type { PlanRow } from "./extractor";

const API_URL = "https://plans-list-api.vercel.app/api/extract";
// Stay safely under Vercel's 4.5MB serverless body limit.
const SERVER_PDF_LIMIT = 4_200_000;

// Design-stage radio options (Hebrew word or English code → Hebrew word).
const STAGE_OPTS: Record<string, string> = {
  "ראשוני": "ראשוני", "מוקדם": "מוקדם", "מפורט": "מפורט",
  SD: "ראשוני", PD: "מוקדם", DD: "מפורט",
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Determine the selected "שלב תכנון" radio by measuring which option's circle is
 * filled. The circle sits ~1.2 label-heights to the LEFT of its text; the filled
 * one is darker than the empty rings. Runs in the browser on the strip preview
 * (the exact image the OCR boxes refer to) — so it needs no API redeploy.
 */
async function detectDesignStage(stripPreview: string, lines: OcrLine[]): Promise<string> {
  if (!stripPreview || lines.length === 0) return "";
  let data: Uint8ClampedArray, W: number;
  try {
    const img = await loadImage(stripPreview);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    ctx.drawImage(img, 0, 0);
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    W = canvas.width;
  } catch {
    return "";
  }
  const grayAt = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return (data[i] + data[i + 1] + data[i + 2]) / 3;
  };
  const cands: { mean: number; word: string }[] = [];
  for (const l of lines) {
    let word = "";
    for (const k in STAGE_OPTS) if (l.text.includes(k)) { word = STAGE_OPTS[k]; break; }
    if (!word || l.box.length < 8) continue;
    const xs = l.box.filter((_, i) => i % 2 === 0);
    const ys = l.box.filter((_, i) => i % 2 === 1);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const h = Math.max(1, y1 - y0);
    const cy = (y0 + y1) / 2;
    const cx = x0 - 1.2 * h;
    const r = Math.max(3, Math.round(h * 0.45));
    let sum = 0, n = 0;
    for (let y = Math.round(cy - r); y < cy + r; y++) {
      for (let x = Math.round(cx - r); x < cx + r; x++) {
        if (x < 0 || y < 0 || x >= W || y * W * 4 >= data.length) continue;
        sum += grayAt(x, y); n++;
      }
    }
    if (n > 0) cands.push({ mean: sum / n, word });
  }
  if (cands.length === 0) return "";
  cands.sort((a, b) => a.mean - b.mean);
  return cands[0].word; // darkest circle = filled = selected
}

type ApiResult = {
  ocrText: string;
  lines?: OcrLine[];
  designStage?: string;
  planNumber: string;
  scale: string;
  stripPreview: string;
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function postToApi(body: BodyInit, contentType: string): Promise<ApiResult> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new ApiError(res.status, `שגיאת שרת ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as ApiResult;
}

/** Extract one plan via the server (fast path), falling back to local render for oversized PDFs. */
export async function extractPlanFast(buf: ArrayBuffer, fileName: string): Promise<PlanRow> {
  let ocrText = "";
  let ocrLines: OcrLine[] = [];
  let designStage = "";
  let planNumber = "";
  let scale = "";
  let stripPreview = "";
  let textLayerDate = "";

  let useFallback = buf.byteLength > SERVER_PDF_LIMIT;

  if (!useFallback) {
    try {
      const r = await postToApi(buf, "application/pdf");
      ocrText = r.ocrText;
      ocrLines = r.lines ?? [];
      designStage = r.designStage ?? "";
      planNumber = r.planNumber;
      scale = r.scale;
      stripPreview = r.stripPreview;
    } catch (e) {
      // 413 = body too large (proxy measured differently) → local-render fallback.
      if (e instanceof ApiError && e.status === 413) useFallback = true;
      else throw e;
    }
  }

  if (useFallback) {
    // Browser renders the strip (slow — only for PDFs above the upload limit),
    // then the server OCRs the small JPEG. Still zero client credentials.
    const r = await renderStripCells(buf);
    planNumber = r.planNumber;
    scale = r.scale;
    stripPreview = r.stripPreview;
    textLayerDate = r.date;
    const blob: Blob = await new Promise((resolve, reject) =>
      r.stripCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92)
    );
    const o = await postToApi(blob, "image/jpeg");
    ocrText = o.ocrText;
    ocrLines = o.lines ?? [];
    designStage = o.designStage ?? "";
  }

  const planNo = planNumber || pickPlanNumber(fileName.replace(/\.[a-z]+$/i, ""));

  // Name + project: geometric extraction (only lines physically inside each box);
  // fall back to the text-order heuristic when geometry isn't available.
  const name = pickNameFromLines(ocrLines) || pickFullName(ocrText);
  const project = pickProjectFromLines(ocrLines);

  // Design stage: prefer the server's value; otherwise detect it in the browser
  // from the strip preview (works even before the API redeploys).
  if (!designStage) designStage = await detectDesignStage(stripPreview, ocrLines);

  // מטרה = design stage (radio) + submission purpose (plan-number code).
  const status = decodeStatus(planNo);
  const purpose = buildPurpose(designStage, status);

  return {
    planNumber: planNo,
    name,
    date: pickDate(ocrText) || textLayerDate,
    scale: scale || pickScale(ocrText),
    purpose,
    revision: decodeRevision(planNo),
    planningPhase: buildPlanningPhase(status),
    project,
    sourceFile: fileName,
    stripPreview,
  };
}
