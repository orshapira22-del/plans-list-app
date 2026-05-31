"use client";

import { renderStrip, pickPlanNumber } from "./pdf-render";
import { ocrImage } from "./ocr";
import { parseStripOcr, type PlanRow } from "./extractor";

/** Full client-side extraction of one plan PDF → a list row. */
export async function extractPlan(buf: ArrayBuffer, fileName: string): Promise<PlanRow> {
  const { stripCanvas, planNumber, scale } = await renderStrip(buf);
  const ocrText = await ocrImage(stripCanvas);
  const f = parseStripOcr(ocrText);

  // Plan number: prefer the text-layer code; fall back to the filename (these are named by code).
  const fromName = pickPlanNumber(fileName.replace(/\.[a-z]+$/i, ""));
  const planNo = planNumber || fromName;

  return {
    planNumber: planNo,
    name: f.name,
    description: f.description,
    revision: f.revision,
    date: f.date,
    status: f.status,
    scale: scale || "",
    sourceFile: fileName,
  };
}
