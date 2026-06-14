/**
 * Pure text-parsing helpers for the OCR'd title-block strip.
 * No browser APIs — usable from any runtime and easy to unit-test.
 */

const HEB = /[֐-׿]/;

// Date — accept DD/MM/YY or DD/MM/YYYY with / . - between, and tolerate spaces.
const DATE_RE = /(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})/g;

// Lines that are field labels (not the answer)
const LABEL_RE = /^(שם\s*ה?תכנית|פרוייקט|פרויקט|מטרה|תאריך|מהדורה|אישר|שרטט|בדק|תכנן|קנ|מס\b|דיסציפלינה|שלב\s*פרוייקט|שלב\s*פרויקט|מטרת\s*הגשה|מוגש|רמת\s*פרוייקט)/;

// Markers that say "the next line is the plan name"
const NAME_LABEL_RE = /שם\s*ה?תכנית|שם\s*ה?תוכנית/;

// Common project names we've seen — block them as plan-name candidates.
const KNOWN_PROJECTS = /צומת\s*עטרות|צומת\s*אריאל/;

// Plan-name lead words (excluding "צומת" which clashes with project names)
const PLAN_WORDS = /תכנית|תוכנית|תנוחה|חתך|חתכים|פרטים|מבט|תרשים|תנועה|סלילה|ניקוז|תיאום|פיתוח|תאורה|ביוב|מים|כביש|גשר|קיר|רומים|רחבה|מערכות/;

// A line that begins the NEXT field (so we stop collecting the name there).
const NEXT_FIELD_RE = /^(שלב\s*תכנון|מטרה|מטרת\s*הגשה|ראשוני|מוקדם|מפורט|לעיון|לאישור|למכרז|לביצוע|מהדורה|תאריך|אישר|שרטט|תכנן|בדק|קנ|מס[׳'\s]|דיסציפלינה|מוגש)/;
// A line that looks like a note / list item (details sheets) — stop before these.
const NOTE_LINE_RE = /^\s*[\d\-•]/;

/**
 * The plan name = ALL the text rows under the "שם התכנית" label, joined into one
 * string exactly as written in the strip (single field, no name/description split).
 */
export function pickFullName(ocrText: string): string {
  const rawLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const isContent = (l: string) =>
    HEB.test(l) &&
    l.replace(/[^֐-׿]/g, "").length >= 3 &&
    !LABEL_RE.test(l) &&
    !KNOWN_PROJECTS.test(l) &&
    !NEXT_FIELD_RE.test(l) &&
    !NOTE_LINE_RE.test(l);

  // Strategy 1: collect the lines right after the "שם התכנית" label until the next field.
  const labelIdx = rawLines.findIndex((l) => NAME_LABEL_RE.test(l));
  if (labelIdx >= 0) {
    const parts: string[] = [];
    for (let i = labelIdx + 1; i < rawLines.length && parts.length < 4; i++) {
      const l = rawLines[i];
      if (NEXT_FIELD_RE.test(l) || NOTE_LINE_RE.test(l)) break; // reached the next field
      if (isContent(l)) parts.push(l);
    }
    if (parts.length > 0) return parts.join(" ");
  }

  // Strategy 2: from the first plan-word line, collect consecutive content lines.
  const contentLines = rawLines.filter(isContent);
  const idx = contentLines.findIndex((l) => PLAN_WORDS.test(l));
  if (idx >= 0) {
    const parts = [contentLines[idx]];
    if (contentLines[idx + 1]) parts.push(contentLines[idx + 1]);
    return parts.join(" ");
  }

  return contentLines[0] ?? "";
}

export type OcrLine = { text: string; box: number[] };

const NEXT_FIELD_BELOW_RE = /שלב\s*תכנון|^מטרה|מטרת\s*הגשה|ראשוני\s*\(|מוקדם\s*\(|מפורט\s*\(/;

function boxYs(box: number[]): number[] {
  const ys: number[] = [];
  for (let i = 1; i < box.length; i += 2) ys.push(box[i]);
  return ys;
}
function boxXs(box: number[]): number[] {
  const xs: number[] = [];
  for (let i = 0; i < box.length; i += 2) xs.push(box[i]);
  return xs;
}
const minOf = (a: number[]) => Math.min(...a);
const maxOf = (a: number[]) => Math.max(...a);
const centerOf = (a: number[]) => (Math.min(...a) + Math.max(...a)) / 2;

/**
 * Geometric plan-name extraction: take only OCR lines that physically sit inside
 * the "שם התכנית" box — below its label, above the next field row (שלב תכנון),
 * and horizontally within the title-block column. This rejects drawing labels
 * that happen to fall inside the cropped strip image.
 */
export function pickNameFromLines(lines: OcrLine[]): string {
  const label = lines.find((l) => NAME_LABEL_RE.test(l.text) && l.box.length >= 8);
  if (!label) return "";

  const labelYs = boxYs(label.box);
  const labelH = maxOf(labelYs) - minOf(labelYs);
  const yStart = maxOf(labelYs) - labelH * 0.5;

  // The next field row below the name box (שלב תכנון / מטרה headers)
  const fieldRows = lines.filter(
    (l) => l.box.length >= 8 && NEXT_FIELD_BELOW_RE.test(l.text) && centerOf(boxYs(l.box)) > centerOf(labelYs)
  );
  const yEnd = fieldRows.length
    ? minOf(fieldRows.flatMap((l) => [minOf(boxYs(l.box))]))
    : maxOf(labelYs) + labelH * 7; // fallback window ≈ name-box height

  // Title-block column: union of x-ranges of the label + the field rows
  const colBoxes = [label, ...fieldRows];
  const colMinX = minOf(colBoxes.map((l) => minOf(boxXs(l.box))));
  const colMaxX = maxOf(colBoxes.map((l) => maxOf(boxXs(l.box))));
  const pad = (colMaxX - colMinX) * 0.1;

  const cands = lines.filter((l) => {
    if (l.box.length < 8) return false;
    const cy = centerOf(boxYs(l.box));
    const cx = centerOf(boxXs(l.box));
    if (cy <= yStart || cy >= yEnd) return false;
    if (cx < colMinX - pad || cx > colMaxX + pad) return false;
    const t = l.text.replace(/\s+/g, " ").trim();
    return (
      HEB.test(t) &&
      t.replace(/[^֐-׿]/g, "").length >= 3 &&
      !LABEL_RE.test(t) &&
      !KNOWN_PROJECTS.test(t) &&
      !NEXT_FIELD_RE.test(t)
    );
  });
  if (cands.length === 0) return "";

  cands.sort((a, b) => centerOf(boxYs(a.box)) - centerOf(boxYs(b.box)));
  return cands.slice(0, 3).map((l) => l.text.replace(/\s+/g, " ").trim()).join(" ");
}

const OCR_SCALE_RE = /\b1\s*:\s*\d{2,4}(?:\s*[/\\]\s*\d{2,4})?\b/;

/** Scale from the OCR text — fallback when the PDF text layer has none (e.g. "כמסומן"). */
export function pickScale(ocrText: string): string {
  if (/כמסומן/.test(ocrText)) return "כמסומן";
  const m = ocrText.match(OCR_SCALE_RE);
  return m ? m[0].replace(/\s+/g, "") : "";
}

// The standalone "פרוייקט:" header only — NOT footer compounds like
// "מס׳ פרוייקט", "רמת פרוייקט", "סוג פרוייקט", "שלב פרוייקט".
const PROJECT_HEADER_RE = /^(פרוייקט|פרויקט)\s*:?\s*$/;
const PROJECT_FOOTER_RE = /מס|רמת|רמות|סוג|שלב|גיליון|מהדורה|מזמין|קובץ|SHEET|FILE|PLOT|NAME|WBS/i;
const PROJECT_LABEL_RE = /פרוייקט|פרויקט/;

/**
 * Project name from the "פרוייקט:" field (e.g. "צומת עטרות") — used for the
 * Excel title row. Geometric: the line(s) directly below the פרוייקט label,
 * above the שם התכנית label, within the title-block column.
 */
export function pickProjectFromLines(lines: OcrLine[]): string {
  // The standalone "פרוייקט:" header — never the "מס׳/רמת/שלב פרוייקט" footer rows
  // (matching those grabs filename junk and masks a cut-off title block).
  const labels = lines
    .filter((l) => PROJECT_HEADER_RE.test(l.text.replace(/\s+/g, " ").trim()) && l.box.length >= 8)
    .sort((a, b) => minOf(boxYs(a.box)) - minOf(boxYs(b.box)));
  const label = labels[0];
  if (!label) return "";
  const labelMinY = minOf(boxYs(label.box));
  const labelMaxY = maxOf(boxYs(label.box));
  const labelH = labelMaxY - labelMinY;
  const labRight = maxOf(boxXs(label.box));

  // Stop at the שם התכנית label (the next field down).
  const nameLabel = lines.find(
    (l) => NAME_LABEL_RE.test(l.text) && l.box.length >= 8 && minOf(boxYs(l.box)) > labelMaxY
  );
  const yEnd = nameLabel ? minOf(boxYs(nameLabel.box)) : labelMaxY + labelH * 5;

  // The value sits in the band between the label and the next field. It is
  // centred below the label and shifted LEFT, so don't constrain x on the left.
  const cands = lines.filter((l) => {
    if (l.box.length < 8) return false;
    const cy = centerOf(boxYs(l.box));
    const cx = centerOf(boxXs(l.box));
    if (cy <= labelMinY + labelH * 0.3 || cy >= yEnd) return false;
    if (cx > labRight + labelH * 2) return false; // reject anything well to the right
    const t = l.text.replace(/\s+/g, " ").trim();
    return (
      HEB.test(t) &&
      t.replace(/[^֐-׿]/g, "").length >= 2 &&
      !PROJECT_LABEL_RE.test(t) &&
      !PROJECT_FOOTER_RE.test(t) &&
      !LABEL_RE.test(t)
    );
  });
  if (cands.length === 0) return "";
  cands.sort((a, b) => centerOf(boxYs(a.box)) - centerOf(boxYs(b.box)));
  return cands.slice(0, 2).map((l) => l.text.replace(/\s+/g, " ").trim()).join(" ");
}

/**
 * True when the "שם התכנית" label sits in the top slice of the strip — a sign the
 * crop cut off the rows above it (project + the first name lines), so the name is
 * incomplete and the plan should be re-rendered with an anchored crop.
 */
export function nameBoxNearTop(lines: OcrLine[]): boolean {
  const withBox = lines.filter((l) => l.box.length >= 8);
  if (withBox.length === 0) return false;
  const maxY = maxOf(withBox.flatMap((l) => boxYs(l.box)));
  if (maxY <= 0) return false;
  const label = withBox.find((l) => NAME_LABEL_RE.test(l.text));
  if (!label) return false;
  return minOf(boxYs(label.box)) < maxY * 0.15;
}

/**
 * The two title-block columns the format needs:
 *   מטרה      = design-stage word + submission purpose  (e.g. "מפורט לביצוע")
 *   שלב תכנון = high-level phase: "ביצוע" when issued for construction, else "תכנון"
 * designStage comes from the radio detector; purpose from the plan-number code.
 */
export function buildPurpose(designStage: string, status: string): string {
  return [designStage, status].filter(Boolean).join(" ");
}
export function buildPlanningPhase(status: string): string {
  if (!status) return "";
  return status === "לביצוע" || status === "לאחר ביצוע" ? "ביצוע" : "תכנון";
}

/**
 * Pick the date of the LATEST revision. The title block lists a revision table
 * (e.g. rev 02 → 21/05/25, rev 00 → 06.06.24); the newest revision always has
 * the most recent date, so we take the chronologically-latest date in the strip.
 */
export function pickDate(ocrText: string): string {
  const dates: { y: number; m: number; d: number; raw: string }[] = [];
  for (const match of ocrText.matchAll(DATE_RE)) {
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    let y = parseInt(match[3], 10);
    if (match[3].length === 2) y += 2000; // 25 → 2025
    if (d < 1 || d > 31 || m < 1 || m > 12) continue;
    dates.push({ y, m, d, raw: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${match[3]}` });
  }
  if (dates.length === 0) return "";
  dates.sort((a, b) => b.y - a.y || b.m - a.m || b.d - a.d);
  const t = dates[0];
  // Reference format: DD.MM.YYYY with dots and a 4-digit year.
  return `${String(t.d).padStart(2, "0")}.${String(t.m).padStart(2, "0")}.${t.y}`;
}
