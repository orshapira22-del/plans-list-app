import type { PdfItem } from "./pdf";

export type PlanRow = {
  seq: string;          // מס"פ
  planNumber: string;   // מספר תכנית
  name: string;         // שם התכנית
  date: string;         // תאריך
  scale: string;        // קנ"מ
  purpose: string;      // מטרה
  revision: string;     // מהדורה
  phase: string;        // שלב תכנון
  sourceFile: string;
};

export const COLUMNS: { key: keyof PlanRow; label: string; width: number }[] = [
  { key: "seq", label: 'מס"פ', width: 6 },
  { key: "planNumber", label: "מספר תכנית", width: 38 },
  { key: "name", label: "שם התכנית", width: 32 },
  { key: "date", label: "תאריך", width: 12 },
  { key: "scale", label: 'קנ"מ', width: 10 },
  { key: "purpose", label: "מטרה", width: 14 },
  { key: "revision", label: "מהדורה", width: 8 },
  { key: "phase", label: "שלב תכנון", width: 12 },
  { key: "sourceFile", label: "קובץ מקור", width: 28 },
];

// ============== Patterns ==============
// A real plan code: starts with letters, has at least 3 hyphen-separated segments,
// no path chars, no file extension.
const PLAN_NUM_RE = /^[A-Z]{2,}(?:[-_][A-Z0-9]+){2,}$/;
// Identifies project-meta rows (WBS, project codes) that look like plan numbers but aren't
const PROJECT_META_RE = /^(WBS|PROJECT|PRJ|ATAROT|פרוייקט|פרויקט)\b/i;
const SCALE_RE = /^\s*1\s*[:/]\s*\d{1,4}(?:[/\\]\d{1,4})?\s*$/;
const SCALE_HEBREW_WORDS = /^(כמסומן|מסומן|לפי\s*הסימון|—|-)\s*$/;
const DATE_RE = /^\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}$/;
const SEQ_RE = /^\d{1,4}$/;
const REVISION_RE = /^[A-Za-z0-9]{1,3}$/;

const PURPOSE_KEYWORDS = [
  "לביצוע",
  "למכרז",
  "לאישור",
  "להיתר",
  "לתיאום",
  "לעיון",
  "להערות",
  "מפורט לאישור",
  "מפורט",
  "סופי",
  "טיוטה",
];
// Anchored — the whole cell must equal one of the keywords (avoids matching "מפורט" inside a name)
const PURPOSE_RE = new RegExp(`^(${PURPOSE_KEYWORDS.join("|")})$`);

const PHASE_KEYWORDS = ["תכנון", "מוקדם", "בינוי", "תכנון מפורט", "ביצוע", "פיתוח"];
const PHASE_RE = new RegExp(`^(${PHASE_KEYWORDS.join("|")})$`);

// Hebrew character test
const HAS_HEBREW = /[֐-׿]/;

// ============== Row clustering ==============
type Row = { y: number; items: PdfItem[] };

function clusterRows(items: PdfItem[], tolerance = 4): Row[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= tolerance && it.page === last.items[0].page) {
      last.items.push(it);
      last.y = (last.y + it.y) / 2;
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }
  // Within each row, sort right-to-left (RTL reading order) for Hebrew docs
  for (const r of rows) r.items.sort((a, b) => b.x - a.x);
  return rows;
}

/**
 * Merge adjacent items into "cells" based on X-gap.
 * Items in the row are already sorted by descending X.
 */
function isHebrew(s: string): boolean {
  return HAS_HEBREW.test(s);
}
function isLatinOrDigit(s: string): boolean {
  return /^[A-Za-z0-9\s._\-/:'"]+$/.test(s);
}

function mergeCellsRTL(row: Row, maxGap = 12): { x: number; text: string }[] {
  const cells: { x: number; text: string }[] = [];
  for (const it of row.items) {
    const last = cells[cells.length - 1];
    // Never merge across script boundary (Hebrew ↔ Latin/digit) — those are separate cells
    const scriptMismatch =
      last && ((isHebrew(last.text) && isLatinOrDigit(it.str)) || (isLatinOrDigit(last.text) && isHebrew(it.str)));
    if (last && !scriptMismatch && last.x - it.x <= maxGap) {
      last.text = (last.text + it.str).replace(/\s+/g, " ").trim();
      last.x = it.x;
    } else {
      cells.push({ x: it.x, text: it.str.trim() });
    }
  }
  for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
  return cells;
}

// ============== Row classification (content-based) ==============
function classifyRow(cells: { x: number; text: string }[]): Partial<PlanRow> | null {
  const out: Partial<PlanRow> = {};
  const leftovers: { x: number; text: string }[] = [];

  // First pass: identify the planNumber so we can use its X as a divider
  let planX: number | null = null;
  for (const cell of cells) {
    if (PLAN_NUM_RE.test(cell.text) && !PROJECT_META_RE.test(cell.text)) {
      out.planNumber = cell.text;
      planX = cell.x;
      break;
    }
  }
  if (!out.planNumber || planX === null) return null;

  for (const cell of cells) {
    const t = cell.text;
    if (!t) continue;
    if (t === out.planNumber) continue;

    if (!out.date && DATE_RE.test(t)) { out.date = t; continue; }
    if (!out.scale && (SCALE_RE.test(t) || SCALE_HEBREW_WORDS.test(t))) {
      out.scale = t.replace(/\s+/g, "");
      continue;
    }
    if (!out.purpose && PURPOSE_RE.test(t)) {
      out.purpose = t;
      continue;
    }
    if (!out.phase && PHASE_RE.test(t)) { out.phase = t; continue; }

    // Small numeric token:
    //  - cell.x > planX (right of plan number, RTL leading side) → seq
    //  - cell.x < planX (left, trailing side) → likely sheet number → goes to name
    if (SEQ_RE.test(t) && Number(t) > 0 && Number(t) < 9999) {
      if (cell.x > planX && !out.seq) { out.seq = t; continue; }
      leftovers.push(cell); // sheet number → keep for name
      continue;
    }

    // revision: very short alphanum
    if (!out.revision && REVISION_RE.test(t) && t.length <= 2 && !HAS_HEBREW.test(t)) {
      out.revision = t;
      continue;
    }

    leftovers.push(cell);
  }

  // Build the name from Hebrew leftovers + trailing sheet numbers (preserve visual order)
  const nameParts = leftovers
    .filter((c) => HAS_HEBREW.test(c.text) || SEQ_RE.test(c.text))
    .sort((a, b) => b.x - a.x) // RTL reading
    .map((c) => c.text);
  out.name = nameParts.join(" ").replace(/\s+/g, " ").trim();

  // A real list row must have a plan number AND at least one other tabular field.
  // This filters out title-block false positives in individual drawing PDFs.
  const hasSecondField = !!(out.date || out.scale || out.purpose || out.phase || (out.name && out.name.length >= 3));
  if (!hasSecondField) return null;

  return out;
}

/**
 * Parse a planner's "רשימת תוכניות" PDF into structured rows.
 * Uses content-based row classification (no header dependency).
 */
export function parseListPdf(items: PdfItem[], fileName: string): PlanRow[] {
  if (items.length === 0) return [];
  const rows = clusterRows(items);

  const out: PlanRow[] = [];
  for (const r of rows) {
    const cells = mergeCellsRTL(r);
    const cls = classifyRow(cells);
    if (!cls) continue;

    out.push({
      seq: cls.seq ?? String(out.length + 1),
      planNumber: cls.planNumber ?? "",
      name: cls.name ?? "",
      date: cls.date ?? "",
      scale: cls.scale ?? "",
      purpose: cls.purpose ?? "",
      revision: cls.revision ?? "",
      phase: cls.phase ?? "",
      sourceFile: fileName,
    });
  }

  // Always renumber seq sequentially to match the planner's intent (1..N)
  out.forEach((r, i) => (r.seq = String(i + 1)));
  return out;
}

/** Heuristic: does this filename look like a planner's list PDF? */
export function isListPdfName(name: string): boolean {
  return /רשימת\s*תוכנית|רשימת\s*תכנית|רשימה|plans?\s*list|index/i.test(name);
}
