import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { COLUMNS, type PlanRow } from "@/lib/extractor";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { rows } = (await req.json()) as { rows: PlanRow[] };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("רשימת תכניות", {
    views: [{ rightToLeft: true }],
  });

  ws.columns = [
    { header: "#", key: "i", width: 5 },
    ...COLUMNS.map((c) => ({ header: c.label, key: c.key, width: c.width })),
  ];

  ws.getRow(1).font = { bold: true };
  rows.forEach((r, i) => ws.addRow({ i: i + 1, ...r }));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plans-list.xlsx"',
    },
  });
}
