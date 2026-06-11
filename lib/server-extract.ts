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
import { pickFullName, pickNameFromLines, pickDate, pickScale, type OcrLine } from "./ocr-parse";
import { decodeStatus, decodeRevision } from "./plan-code";
import type { PlanRow } from "./extractor";

const API_URL = "https://plans-list-api.vercel.app/api/extract";
// Stay safely under Vercel's 4.5MB serverless body limit.
const SERVER_PDF_LIMIT = 4_200_000;

type ApiResult = {
  ocrText: string;
  lines?: OcrLine[];
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
  }

  const planNo = planNumber || pickPlanNumber(fileName.replace(/\.[a-z]+$/i, ""));

  // Name: geometric extraction (only lines physically inside the name box);
  // fall back to the text-order heuristic when geometry isn't available.
  const name = pickNameFromLines(ocrLines) || pickFullName(ocrText);

  return {
    planNumber: planNo,
    name,
    revision: decodeRevision(planNo),
    date: pickDate(ocrText) || textLayerDate,
    status: decodeStatus(planNo),
    scale: scale || pickScale(ocrText),
    sourceFile: fileName,
    stripPreview,
  };
}
