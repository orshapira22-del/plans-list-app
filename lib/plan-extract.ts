"use client";

import { renderStripCells, pickPlanNumber } from "./pdf-render";
import { ocrCanvas } from "./azure-ocr";
import { decodeStatus, decodeRevision } from "./plan-code";
import type { PlanRow } from "./extractor";

const HEB = /[֐-׿]/;

// Date — accept DD/MM/YY or DD/MM/YYYY with / . - between, and tolerate spaces.
const DATE_RE = /(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})/g;

// Lines that are field labels (not the answer)
const LABEL_RE = /^(שם\s*ה?תכנית|פרוייקט|פרויקט|מטרה|תאריך|מהדורה|אישר|שרטט|בדק|תכנן|קנ|מס\b|דיסציפלינה|שלב\s*פרוייקט|שלב\s*פרויקט|מטרת\s*הגשה|מוגש|רמת\s*פרוייקט)/;

// Markers that say "the next line is the plan name"
const NAME_LABEL_RE = /שם\s*ה?תכנית|שם\s*ה?תוכנית/;

// "Project:" marker — the line following it is the *project* (e.g. "צומת עטרות"), NOT the plan name.
const PROJECT_LABEL_RE = /^פרוייקט|^פרויקט/;

// Common project names we've seen — block them as plan-name candidates.
const KNOWN_PROJECTS = /צומת\s*עטרות|צומת\s*אריאל/;

// Plan-name lead words (excluding "צומת" which clashes with project names)
const PLAN_WORDS = /תכנית|תוכנית|תנוחה|חתך|חתכים|פרטים|מבט|תרשים|תנועה|סלילה|ניקוז|תיאום|פיתוח|תאורה|ביוב|מים|כביש|גשר|קיר|רומים|רחבה|מערכות/;

function pickNameAndDescription(ocrText: string): { name: string; description: string } {
  const rawLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Build a list of *content* Hebrew lines (excluding labels and known project names)
  const contentLines = rawLines.filter(
    (l) =>
      HEB.test(l) &&
      l.replace(/[^֐-׿]/g, "").length >= 4 &&
      !LABEL_RE.test(l) &&
      !KNOWN_PROJECTS.test(l)
  );

  // Strategy 1: look for an explicit "שם התכנית" label, take the lines following it
  const labelIdx = rawLines.findIndex((l) => NAME_LABEL_RE.test(l));
  if (labelIdx >= 0) {
    // Find the next 1-2 content lines after the label
    const after: string[] = [];
    for (let i = labelIdx + 1; i < rawLines.length && after.length < 2; i++) {
      const l = rawLines[i];
      if (
        HEB.test(l) &&
        l.replace(/[^֐-׿]/g, "").length >= 4 &&
        !LABEL_RE.test(l) &&
        !KNOWN_PROJECTS.test(l)
      ) {
        after.push(l);
      }
    }
    if (after.length > 0) {
      return { name: after[0], description: after[1] ?? "" };
    }
  }

  // Strategy 2: first content line that looks like a plan name (has a plan word)
  const idx = contentLines.findIndex((l) => PLAN_WORDS.test(l));
  if (idx >= 0) {
    return { name: contentLines[idx], description: contentLines[idx + 1] ?? "" };
  }

  // Last resort: first 2 content lines
  return { name: contentLines[0] ?? "", description: contentLines[1] ?? "" };
}

/**
 * Pick the date of the LATEST revision. The title block lists a revision table
 * (e.g. rev 02 → 21/05/25, rev 00 → 06.06.24); the newest revision always has
 * the most recent date, so we take the chronologically-latest date in the strip.
 */
function pickDate(ocrText: string): string {
  const dates: { y: number; m: number; d: number; raw: string }[] = [];
  for (const match of ocrText.matchAll(DATE_RE)) {
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    let y = parseInt(match[3], 10);
    if (match[3].length === 2) y += 2000; // 25 → 2025
    // sanity: valid day/month
    if (d < 1 || d > 31 || m < 1 || m > 12) continue;
    dates.push({ y, m, d, raw: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${match[3]}` });
  }
  if (dates.length === 0) return "";
  // Sort descending by date and take the most recent
  dates.sort((a, b) => b.y - a.y || b.m - a.m || b.d - a.d);
  return dates[0].raw;
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
  // Prefer the latest-revision date parsed from the OCR'd revision table;
  // fall back to any date found in the text layer.
  const finalDate = pickDate(text) || date;

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
