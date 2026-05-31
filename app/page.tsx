"use client";

import { useState } from "react";
import { COLUMNS, type PlanRow } from "@/lib/extractor";

type ExtractResponse = {
  rows: PlanRow[];
  sourceFile: string;
  diagnostics: { totalPdfs: number; tried: { name: string; rows: number }[] };
};

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [info, setInfo] = useState<ExtractResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleExtract() {
    if (files.length === 0) return;
    setBusy(true);
    setErr(null);
    setRows([]);
    setInfo(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ExtractResponse;
      setRows(data.rows);
      setInfo(data);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "שגיאה לא ידועה");
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
