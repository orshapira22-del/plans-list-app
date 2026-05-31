import ExcelJS from "exceljs";
import { COLUMNS, type PlanRow } from "./extractor";

/** Build an .xlsx file (Ariel format, RTL) entirely in the browser and trigger download. */
export async function exportRowsToXlsx(rows: PlanRow[], fileName = "רשימת-תכניות.xlsx") {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("רשימת תכניות", { views: [{ rightToLeft: true }] });

  ws.columns = COLUMNS.map((c) => ({ header: c.label, key: c.key, width: c.width }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { horizontal: "center", vertical: "middle" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16243F" } };
  });

  rows.forEach((r) => ws.addRow(r));

  ws.eachRow((row, n) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
    if (n > 1) row.alignment = { vertical: "middle" };
  });

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
