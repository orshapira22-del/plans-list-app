"use client";

import { useState } from "react";
import JSZip from "jszip";
import { COLUMNS, type PlanRow } from "@/lib/extractor";

type ExtractResponse = {
  rows: PlanRow[];
  sourceFile: string;
  diagnostics: { totalPdfs: number; tried: { name: string; rows: number }[] };
};

// Heuristic: filename suggests a planner's list PDF
function looksLikeListPdf(name: string): boolean {
  return /רשימת\s*תוכנית|רשימת\s*תכנית|רשימה|plans?\s*list|index/i.test(name);
}

/**
 * Pre-process selected files in the BROWSER:
 *  - PDFs pass through as-is
 *  - ZIPs are unpacked locally with JSZip; only PDFs whose name looks like
 *    a planner's list (and a few small fallback PDFs) are uploaded.
 * Result: only ~tens of KB ever leaves the user's machine.
 */
async function selectPdfsForUpload(files: File[], onStatus: (s: string) => void): Promise<File[]> {
  const pdfs: File[] = [];
  const fallback: File[] = []; // small PDFs we might try if no list-named file found

  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      pdfs.push(f);
      continue;
    }
    if (lower.endsWith(".zip")) {
      onStatus(`פותח את ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)} MB) מקומית...`);
      const zip = await JSZip.loadAsync(f);
      const entries = Object.values(zip.files).filter((e) => !e.dir && /\.pdf$/i.test(e.name));
      onStatus(`נמצאו ${entries.length} קבצי PDF ב-ZIP. מאתר את קובץ הרשימה...`);

      const namedList = entries.filter((e) => looksLikeListPdf(e.name));
      const targets = namedList.length > 0 ? namedList : entries.filter((e) => {
        const size = (e as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
        // Heuristic fallback: only small PDFs (< 500 KB) — list PDFs are typically tiny
        return size > 0 && size < 500_000;
      });

      for (const entry of targets) {
        const blob = await entry.async("blob");
        const fileName = entry.name.split(/[\\/]/).pop() ?? entry.name;
        const file = new File([blob], fileName, { type: "application/pdf" });
        (namedList.length > 0 ? pdfs : fallback).push(file);
      }

      onStatus(`הועלו לעיבוד ${pdfs.length + fallback.length} קבצים מתוך ה-ZIP.`);
    }
  }

  // Prefer name-matched files; fall back to small unmatched PDFs only if nothing named correctly
  return pdfs.length > 0 ? pdfs : fallback;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [info, setInfo] = useState<ExtractResponse | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleExtract() {
    if (files.length === 0) return;
    setBusy(true);
    setErr(null);
    setRows([]);
    setInfo(null);
    setStatus("מעבד קבצים...");

    try {
      const toUpload = await selectPdfsForUpload(files, setStatus);
      if (toUpload.length === 0) {
        throw new Error("לא נמצא קובץ PDF מתאים בתוך החבילה. ודא שה-ZIP מכיל את 'רשימת תוכניות.pdf'.");
      }
      const totalKB = toUpload.reduce((a, f) => a + f.size, 0) / 1024;
      setStatus(`שולח ${toUpload.length} קבצים לעיבוד (${totalKB.toFixed(0)} KB)...`);

      const fd = new FormData();
      for (const f of toUpload) fd.append("files", f, f.name);

      const res = await fetch("/api/extract", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ExtractResponse;
      setRows(data.rows);
      setInfo(data);
      setStatus("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "שגיאה לא ידועה");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    if (rows.length === 0) return;
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "רשימת-תכניות.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="mb-2 text-3xl font-bold">רשימת תכניות</h1>
      <p className="mb-6 text-gray-600">
        העלה את חבילת התכניות של המתכנן (ZIP או PDFים). האפליקציה מאתרת בתוכה את &quot;רשימת תוכניות.pdf&quot; של המתכנן ומפיקה ממנה רשימה בפורמט אחיד.
      </p>

      <div className="mb-6 rounded-xl border border-dashed border-gray-300 bg-white p-6">
        <input
          type="file"
          accept="application/pdf,.pdf,.zip,application/zip"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm"
        />
        {files.length > 0 && (
          <p className="mt-3 text-sm text-gray-600">נבחרו {files.length} קבצים</p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleExtract}
            disabled={files.length === 0 || busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {busy ? "מחלץ..." : "הפק רשימה"}
          </button>
          <button
            onClick={handleExport}
            disabled={rows.length === 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
          >
            ייצוא לאקסל
          </button>
        </div>
        {status && <p className="mt-3 text-sm text-blue-700">{status}</p>}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      </div>

      {info && (
        <div className="mb-4 rounded-lg bg-white p-3 text-sm text-gray-700 ring-1 ring-gray-200">
          <div>נסרקו {info.diagnostics.totalPdfs} קבצי PDF.</div>
          {info.sourceFile ? (
            <div>
              קובץ המקור שזוהה: <span className="font-mono">{info.sourceFile}</span> — {rows.length} שורות.
            </div>
          ) : (
            <div className="text-amber-700">
              לא זוהה קובץ רשימת תכניות מתאים. תוצאות סריקה:{" "}
              {info.diagnostics.tried.map((t) => `${t.name}(${t.rows})`).join(", ")}
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-100">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="p-3 whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-100">
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={
                        c.key === "sourceFile"
                          ? "p-3 font-mono text-xs text-gray-500"
                          : c.key === "planNumber"
                          ? "p-3 font-mono text-xs"
                          : "p-3"
                      }
                    >
                      {r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
