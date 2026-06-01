import type { PdfItem } from "./pdf";
import { pdfBufferToItems } from "./pdf";
import type { PlanRow } from "./extractor";

// ===== Patterns =====
const PLAN_NUM_RE = /^[A-Z]{2,}(?:[-_][A-Z0-9]+){2,}$/;
const PROJECT_META_RE = /^(WBS|PROJECT|PRJ|ATAROT|פרוייקט|פרויקט)\b/i;
const SCALE_RE = /^\s*1\s*[:/]\s*\d{1,4}(?:[/\\]\d{1,4})?\s*$/;
const SCALE_HEB = /^(כמסומן|מסומן|לפי\s*הסימון|—|-)\s*$/;
const DATE_RE = /^\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}$/;
const SEQ_RE = /^\d{1,4}$/;
const REV_RE = /^[A-Za-z0-9]{1,3}$/;
const HEB = /[֐-׿]/;

const PURPOSE_KEYWORDS = [
  "מפורט לאישור", "לביצוע", "למכרז", "לאישור", "להיתר", "לתיאום",
  "לעיון", "להערות", "מפורט", "סופי", "טיוטה",
];
const PURPOSE_RE = new RegExp(`^(${PURPOSE_KEYWORDS.join("|")})$`);

type Row = { y: number; items: PdfItem[] };

function clusterRows(items: PdfItem[], tol = 4): Row[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol && it.page === last.items[0].page) {
      last.items.push(it);
      last.y = (last.y + it.y) / 2;
    } else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => b.x - a.x);
  return rows;
}

const isHeb = (s: string) => HEB.test(s);
const isLatin = (s: string) => /^[A-Za-z0-9\s._\-/:'"]+$/.test(s);

function mergeCells(row: Row, maxGap = 12): { x: number; text: string }[] {
  const cells: { x: number; text: string }[] = [];
  for (const it of row.items) {
    const last = cells[cells.length - 1];
    const mismatch =
      last && ((isHeb(last.text) && isLatin(it.str)) || (isLatin(last.text) && isHeb(it.str)));
    if (last && !mismatch && last.x - it.x <= maxGap) {
      last.text = (last.text + it.str).replace(/\s+/g, " ").trim();
      last.x = it.x;
    } else cells.push({ x: it.x, text: it.str.trim() });
  }
  for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
  return cells;
}

type Parsed = { planNumber: string; name: string; date: string; scale: string; status: string; revision: string };

function classifyRow(cells: { x: number; text: string }[]): Parsed | null {
  const out: Partial<Parsed> = {};
  const leftovers: { x: number; text: string }[] = [];

  let planX: number | null = null;
  for (const cell of cells) {
    if (PLAN_NUM_RE.test(cell.text) && !PROJECT_META_RE.test(cell.text)) {
      out.planNumber = cell.text; planX = cell.x; break;
    }
  }
  if (!out.planNumber || planX === null) return null;

  for (const cell of cells) {
    const t = cell.text;
    if (!t || t === out.planNumber) continue;
    if (!out.date && DATE_RE.test(t)) { out.date = t; continue; }
    if (!out.scale && (SCALE_RE.test(t) || SCALE_HEB.test(t))) { out.scale = t.replace(/\s+/g, ""); continue; }
    if (!out.status && PURPOSE_RE.test(t)) { out.status = t; continue; }
    if (SEQ_RE.test(t) && Number(t) > 0 && Number(t) < 9999) {
      // Right of the plan number (RTL leading side) = the מס"פ row index → drop it.
      // Left/trailing side = a sheet number → keep for the name.
      if (cell.x < planX) leftovers.push(cell);
      continue;
    }
    if (!out.revision && REV_RE.test(t) && t.length <= 2 && !HEB.test(t)) { out.revision = t; continue; }
    leftovers.push(cell);
  }

  const nameParts = leftovers
    .filter((c) => HEB.test(c.text) || SEQ_RE.test(c.text))
    .sort((a, b) => b.x - a.x)
    .map((c) => c.text);
  const name = nameParts.join(" ").replace(/\s+/g, " ").trim();

  const hasSecond = !!(out.date || out.scale || out.status || (name && name.length >= 3));
  if (!hasSecond) return null;

  return {
    planNumber: out.planNumber!, name, date: out.date ?? "",
    scale: out.scale ?? "", status: out.status ?? "", revision: out.revision ?? "",
  };
}

/** Parse a planner's list PDF into unified PlanRows. Empty if it isn't a list. */
export function parseListItems(items: PdfItem[], fileName: string): PlanRow[] {
  if (items.length === 0) return [];
  const out: PlanRow[] = [];
  for (const r of clusterRows(items)) {
    const c = classifyRow(mergeCells(r));
    if (!c) continue;
    out.push({
      planNumber: c.planNumber, name: c.name, description: "",
      revision: c.revision, date: c.date, status: c.status,
      scale: c.scale, sourceFile: fileName,
    });
  }
  return out;
}

export async function parseListPdf(buf: ArrayBuffer, fileName: string): Promise<PlanRow[]> {
  const items = await pdfBufferToItems(buf);
  return parseListItems(items, fileName);
}

export function isListPdfName(name: string): boolean {
  return /רשימת\s*תוכנית|רשימת\s*תכנית|רשימה|plans?\s*list|index/i.test(name);
}
