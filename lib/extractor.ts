export type PlanRow = {
  planNumber: string;     // מספר תכנית — from the PDF text layer (reliable)
  name: string;           // שם התכנית — full text under the "שם התכנית" label (one field)
  date: string;           // תאריך — latest revision date, DD.MM.YYYY
  scale: string;          // קנ"מ — text layer / OCR
  purpose: string;        // מטרה — design-stage word + submission purpose (e.g. "מפורט לביצוע")
  revision: string;       // מהדורה — decoded from the plan-number suffix
  planningPhase: string;  // שלב תכנון — "תכנון" / "ביצוע"
  project: string;        // פרוייקט — used for the Excel title row (not a column)
  sourceFile: string;
  /** Compact JPEG dataURL of the title-block; shown in the UI for fast manual fixups. */
  stripPreview?: string;
};

/** Columns in the exact order of the requested format (מס"פ serial is added separately). */
export const COLUMNS: { key: keyof PlanRow; label: string; width: number }[] = [
  { key: "planNumber", label: "מספר תכנית", width: 38 },
  { key: "name", label: "שם התכנית", width: 46 },
  { key: "date", label: "תאריך", width: 13 },
  { key: "scale", label: 'קנ"מ', width: 11 },
  { key: "purpose", label: "מטרה", width: 16 },
  { key: "revision", label: "מהדורה", width: 9 },
  { key: "planningPhase", label: "שלב תכנון", width: 12 },
];
