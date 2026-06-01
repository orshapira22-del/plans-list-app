"use client";

import { renderStripCells, pickPlanNumber } from "./pdf-render";
import { ocrCanvas } from "./azure-ocr";
import { decodeStatus, decodeRevision } from "./plan-code";
import type { PlanRow } from "./extractor";

const HEB = /[֐-׿]/;
const DATE_RE = /\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})\b/;

const LABEL_RE = /^(שם\s*ה?תכנית|פרוייקט|פרויקט|מטרה|תאריך|מהדורה|אישר|שרטט|בדק|תכנן|קנ|מס\b)/;
const PLAN_WORDS = /תכנית|תנוחה|חתך|חתכים|פרטים|מבט|תרשים|תנועה|סלילה|ניקוז|תיאום|פיתוח|תאורה|ביוב|מים|כביש|צומת|גשר|קיר|רומים/;

function pickNameAndDescription(ocrText: string): { name: string; description: string } {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((l) => HEB.test(l) && l.replace(/[^֐-׿]/g, "").length >= 4)
    .filter((l) => !LABEL_RE.test(l));

  // Prefer the first line that contains a plan-name word; the next non-label line is the description.
  const idx = lines.findIndex((l) => PLAN_WORDS.test(l));
  if (idx >= 0) {
    return { name: lines[idx], description: lines[idx + 1] ?? "" };
  }
  return { name: lines[0] ?? "", description: lines[1] ?? "" };
}

function pickDate(ocrText: string): string {
  const m = ocrText.match(DATE_RE);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
}

/** Full client-side extraction of one plan PDF → a list row (Azure OCR on the strip). */
export async function extractPlan(buf: ArrayBuffer, fileName: string): Promise<PlanRow> {
  const { stripCanvas, stripPreview, planNumber, scale, date } = await renderStripCells(buf);

  // Plan number: text layer first, filename fallback
  const planNo = planNumber || pickPlanNumber(fileName.replace(/\.[a-z]+$/i, ""));
  const status = decodeStatus(planNo);
  const revision = decodeRevision(planNo);

  // One Azure OCR call on the full strip — Azure handles Hebrew layout natively.
  const { text } = await ocrCanvas(stripCanvas);
  const { name, description } = pickNameAndDescription(text);
  const finalDate = date || pickDate(text);

  return {
    planNumber: planNo,
    name,
    description,
    revision,
    date: finalDate,
    status,
    scale: scale || "",
    sourceFile: fileName,
    stripPreview,
  };
}
