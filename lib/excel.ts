import ExcelJS from "exceljs";
import { COLUMNS, type PlanRow } from "./extractor";

const NAVY = "FF16243F";
const HAIRLINE = "FFB7C0CF";

/**
 * Build the .xlsx in the requested format (RTL), entirely in the browser:
 *   Row 1  — merged project title
 *   Row 2  — headers: מס"פ | מספר תכנית | שם התכנית | תאריך | קנ"מ | מטרה | מהדורה | שלב תכנון
 *   Rows…  — one per plan, with a running serial in מס"פ
 */
export async function exportRowsToXlsx(
  rows: PlanRow[],
  opts: { title?: string; fileName?: string } = {}
) {
  const fileName = opts.fileName ?? "רשימת-תכניות.xlsx";
  const wb = buildWorkbook(rows, opts.title ?? deriveTitle(rows));
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Build the formatted workbook (no browser APIs — unit-testable). */
export function buildWorkbook(rows: PlanRow[], title: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("רשימת תכניות", { views: [{ rightToLeft: true }] });

  // Column layout: serial first, then the format columns.
  const cols = [{ key: "serial", label: 'מס"פ', width: 7 }, ...COLUMNS];
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  const lastCol = cols.length; // 1-based

  const border = (light = false) => ({
    top: { style: "thin" as const, color: { argb: light ? "FFE2E8F0" : HAIRLINE } },
    bottom: { style: "thin" as const, color: { argb: light ? "FFE2E8F0" : HAIRLINE } },
    left: { style: "thin" as const, color: { argb: light ? "FFE2E8F0" : HAIRLINE } },
    right: { style: "thin" as const, color: { argb: light ? "FFE2E8F0" : HAIRLINE } },
  });

  // Row 1 — merged title
  const titleRow = ws.addRow([title]);
  ws.mergeCells(1, 1, 1, lastCol);
  titleRow.height = 26;
  const titleCell = ws.getCell(1, 1);
  titleCell.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };

  // Row 2 — headers
  const headerRow = ws.addRow(cols.map((c) => c.label));
  headerRow.height = 20;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.border = border();
  });

  // Data rows
  rows.forEach((r, i) => {
    const row = ws.addRow({ serial: i + 1, ...r });
    row.alignment = { vertical: "middle" };
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = border();
      // Center everything except the name column (3rd format col → sheet col 3).
      const isName = cols[col - 1]?.key === "name";
      cell.alignment = {
        vertical: "middle",
        horizontal: isName ? "right" : "center",
        wrapText: isName,
      };
    });
  });

  return wb;
}

/** "רשימת תכניות — <project>" using the most common project name across rows. */
export function deriveTitle(rows: PlanRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const p = (r.project || "").trim();
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [p, n] of counts) if (n > bestN) { best = p; bestN = n; }
  return best ? `רשימת תכניות — ${best}` : "רשימת תכניות";
}
