export type PlanRow = {
  planNumber: string;   // מספר תכנית — from text layer (reliable)
  name: string;         // שם התכנית — full text under the "שם התכנית" label (one field)
  revision: string;     // מהדורה — decoded from plan number suffix
  date: string;         // תאריך — text layer / OCR
  status: string;       // סטטוס — decoded from plan-number stage code (CD/DD/SD/FA)
  scale: string;        // קנ"מ — text layer (reliable)
  sourceFile: string;
  /** Compact JPEG dataURL of the title-block; shown in the UI for fast manual fixups. */
  stripPreview?: string;
};

export const COLUMNS: { key: keyof PlanRow; label: string; width: number }[] = [
  { key: "planNumber", label: "מספר תכנית", width: 36 },
  { key: "name", label: "שם התכנית", width: 40 },
  { key: "revision", label: "מהדורה", width: 9 },
  { key: "date", label: "תאריך", width: 12 },
  { key: "status", label: "סטטוס", width: 12 },
  { key: "scale", label: 'קנ"מ', width: 10 },
  { key: "sourceFile", label: "קובץ מקור", width: 26 },
];

// Status (מטרת הגשה) options — one is selected via a filled radio in the strip.
const STATUS_KEYWORDS = [
  "לביצוע",
  "למכרז",
  "לאישור",
  "לעיון",
  "להיתר",
  "לתיאום",
  "להערות",
  "סופי",
  "טיוטה",
];
// A "filled radio" glyph that OCR may render next to the selected option.
const FILLED_RE = /[@●■▪◆♦*•]/;

// Plan-name lead words — help pick the right OCR line as the name.
const PLAN_WORDS = /תכנית|תנוחה|חתך|חתכים|פרטים|מבט|תרשים|תנועה|סלילה|ניקוז|תיאום|פיתוח|תאורה|ביוב|מים|כביש|צומת|גשר|קיר/;

// Labels/noise lines we don't want to treat as the plan name.
const LABEL_NOISE = [
  "פרוייקט", "פרויקט", "שם התכנית", "שם תכנית", "מטרה", "שלב תכנון",
  "תאריך", "מהדורה", "אישר", "שרטט", "בדק", "תכנן", "קנ", 'קנ"מ',
  "מס'", "מספר", "WBS", "SHEET", "PLOT", "FILE", "NAME", "גיליון",
  "קובץ", "מזמין", "ספק", "תחום", "מקום", "אלמנט", "גוש", "מגרש",
];

const DATE_RE = /\b(\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{2,4})\b/;
const HEB = /[֐-׿]/;

function looksLikeLabel(line: string): boolean {
  return LABEL_NOISE.some((w) => line.includes(w));
}

/** Parse the OCR'd strip text into the Hebrew fields. */
export function parseStripOcr(ocrText: string): {
  name: string;
  description: string;
  revision: string;
  date: string;
  status: string;
} {
  const rawLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.replace(/[|/\\_=₪~]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Date
  const dateMatch = ocrText.match(DATE_RE);
  const date = dateMatch ? dateMatch[1].replace(/\s+/g, "") : "";

  // Status — find the option marked with a filled radio. If several options appear
  // but none is clearly filled, leave blank (ambiguous) rather than guessing.
  let status = "";
  const present = STATUS_KEYWORDS.filter((kw) => ocrText.includes(kw));
  for (const kw of STATUS_KEYWORDS) {
    const idx = ocrText.indexOf(kw);
    if (idx < 0) continue;
    const after = ocrText.slice(idx + kw.length, idx + kw.length + 8);
    if (FILLED_RE.test(after)) { status = kw; break; }
  }
  if (!status && present.length === 1) status = present[0];

  // Revision — a short token (00, 0, 01, A) appearing on the date line
  let revision = "";
  if (dateMatch) {
    const dateLine = rawLines.find((l) => l.includes(dateMatch[1].replace(/\s+/g, "")) || DATE_RE.test(l)) || "";
    const revTok = dateLine.replace(DATE_RE, " ").match(/\b(\d{1,2}|[A-Za-z]\d?)\b/);
    if (revTok) revision = revTok[1];
  }

  // Name + description — Hebrew content lines that are not labels/status options.
  const nameIdx = rawLines.findIndex((l) => /שם\s*ה?תכנית/.test(l));
  const pool = nameIdx >= 0 ? rawLines.slice(nameIdx + 1) : rawLines;
  const cleaned = pool
    .map(cleanNameLine)
    .filter(
      (l) =>
        HEB.test(l) &&
        l.replace(/[^֐-׿]/g, "").length >= 4 &&
        !looksLikeLabel(l) &&
        !DATE_RE.test(l) &&
        !STATUS_KEYWORDS.some((k) => l.includes(k))
    );

  // Prefer a line that contains a typical plan word as the name.
  const planLineIdx = cleaned.findIndex((l) => PLAN_WORDS.test(l));
  let name = "", description = "";
  if (planLineIdx >= 0) {
    name = cleaned[planLineIdx];
    description = cleaned[planLineIdx + 1] ?? cleaned.find((l, i) => i !== planLineIdx) ?? "";
  } else {
    name = cleaned[0] ?? "";
    description = cleaned[1] ?? "";
  }

  return { name, description, revision, date, status };
}

/** Trim OCR noise from a candidate name line (leading latin/digits/short tokens). */
function cleanNameLine(line: string): string {
  let s = line.replace(/[A-Za-z0-9]+/g, " ").replace(/[.,;:'"`()\[\]{}]+/g, " ");
  // drop leading 1-char Hebrew tokens (common OCR speckle) until a real word
  const tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length && tokens[0].replace(/[^֐-׿]/g, "").length <= 1) tokens.shift();
  return tokens.join(" ").replace(/\s+/g, " ").trim();
}
