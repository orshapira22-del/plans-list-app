import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { pdfBufferToItems } from "@/lib/pdf";
import { parseListPdf, isListPdfName, type PlanRow } from "@/lib/extractor";

export const runtime = "nodejs";
export const maxDuration = 120;

type Candidate = { name: string; buf: ArrayBuffer };

/** Recursively collect PDF candidates from uploaded files, expanding ZIPs. */
async function collectPdfs(files: File[]): Promise<Candidate[]> {
  const out: Candidate[] = [];

  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      out.push({ name: f.name, buf: await f.arrayBuffer() });
    } else if (lower.endsWith(".zip")) {
      const zip = new AdmZip(Buffer.from(await f.arrayBuffer()));
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        if (!entry.entryName.toLowerCase().endsWith(".pdf")) continue;
        const data = entry.getData();
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        out.push({ name: entry.entryName.split(/[\\/]/).pop() ?? entry.entryName, buf: ab as ArrayBuffer });
      }
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files" }, { status: 400 });
  }

  const pdfs = await collectPdfs(files);
  if (pdfs.length === 0) {
    return NextResponse.json({ error: "no PDF files found" }, { status: 400 });
  }

  // Prefer name-based candidates first (faster path), but verify by parsing.
  const ordered = [...pdfs].sort((a, b) => {
    const ai = isListPdfName(a.name) ? 0 : 1;
    const bi = isListPdfName(b.name) ? 0 : 1;
    return ai - bi;
  });

  const tried: { name: string; rows: number; sample?: PlanRow[] }[] = [];
  let best: { rows: PlanRow[]; name: string } = { rows: [], name: "" };

  for (const pdf of ordered) {
    try {
      const items = await pdfBufferToItems(pdf.buf);
      const parsed = parseListPdf(items, pdf.name);
      tried.push({ name: pdf.name, rows: parsed.length });
      if (parsed.length > best.rows.length) {
        best = { rows: parsed, name: pdf.name };
      }
      // Early-exit: if the name looked like a list AND we got ≥ 2 rows, we're confident.
      if (isListPdfName(pdf.name) && parsed.length >= 2) break;
    } catch (e) {
      tried.push({ name: pdf.name, rows: -1 });
      console.error("parse failed:", pdf.name, e);
    }
  }

  // Require at least 2 rows to consider it a real list (avoids title-block false positives)
  const final = best.rows.length >= 2 ? best : { rows: [], name: "" };

  return NextResponse.json({
    rows: final.rows,
    sourceFile: final.name,
    diagnostics: { totalPdfs: pdfs.length, tried },
  });
}
