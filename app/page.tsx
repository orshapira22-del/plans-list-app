"use client";

import { useState, useRef, useCallback } from "react";
import JSZip from "jszip";
import { COLUMNS, type PlanRow } from "@/lib/extractor";
import { extractPlan } from "@/lib/plan-extract";
import { warmupOcr } from "@/lib/ocr";
import { exportRowsToXlsx } from "@/lib/excel";
import { LogoFull } from "./components/Logo";

type PdfFile = { name: string; buf: ArrayBuffer };

// Files that are clearly NOT individual plans (lists, declarations, BOQ, etc.)
function isNonPlan(name: string): boolean {
  return /רשימת|רשימה|הצהרה|ביצוע\.|כתב\s*כמויות|index|list|declaration|boq/i.test(name);
}

/** Collect plan PDFs from the upload, expanding ZIPs in the browser. */
async function collectPlanPdfs(files: File[], onStatus: (s: string) => void): Promise<PdfFile[]> {
  const out: PdfFile[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      if (!isNonPlan(f.name)) out.push({ name: f.name, buf: await f.arrayBuffer() });
    } else if (lower.endsWith(".zip")) {
      onStatus(`פותח את ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)} MB)…`);
      const zip = await JSZip.loadAsync(f);
      const entries = Object.values(zip.files).filter(
        (e) => !e.dir && /\.pdf$/i.test(e.name) && !isNonPlan(e.name)
      );
      for (const entry of entries) {
        const buf = await entry.async("arraybuffer");
        const name = entry.name.split(/[\\/]/).pop() ?? entry.name;
        out.push({ name, buf });
      }
    }
  }
  return out;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files ?? []).filter((f) =>
      /\.(pdf|zip)$/i.test(f.name)
    );
    if (dropped.length) setFiles(dropped);
  }, []);

  async function handleExtract() {
    if (files.length === 0) return;
    setBusy(true);
    setErr(null);
    setRows([]);
    setProgress(null);
    setStatus("מעבד קבצים…");

    try {
      const pdfs = await collectPlanPdfs(files, setStatus);
      if (pdfs.length === 0) throw new Error("לא נמצאו קובצי תכנית (PDF) בהעלאה.");

      await warmupOcr(setStatus);

      const collected: PlanRow[] = [];
      setProgress({ done: 0, total: pdfs.length });
      for (let i = 0; i < pdfs.length; i++) {
        setStatus(`קורא סטריפ מתוך ${pdfs[i].name}…`);
        try {
          const row = await extractPlan(pdfs[i].buf, pdfs[i].name);
          collected.push(row);
        } catch {
          collected.push({
            planNumber: "", name: "", description: "", revision: "",
            date: "", status: "", scale: "", sourceFile: pdfs[i].name,
          });
        }
        setProgress({ done: i + 1, total: pdfs.length });
        setRows([...collected]);
      }

      // Sort by plan number for a tidy list
      collected.sort((a, b) => a.planNumber.localeCompare(b.planNumber, "en"));
      setRows([...collected]);
      setStatus("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "שגיאה לא ידועה");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function updateCell(rowIdx: number, key: keyof PlanRow, value: string) {
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)));
  }
  function deleteRow(rowIdx: number) {
    setRows((prev) => prev.filter((_, i) => i !== rowIdx));
  }

  async function handleExport() {
    if (rows.length === 0) return;
    await exportRowsToXlsx(rows);
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <LogoFull />
          <div className="hidden flex-col items-end sm:flex">
            <span className="text-sm font-semibold text-[#16243f]">מחולל רשימת תכניות</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2a7f99]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#34a7c4]" /> מערכת מקוונת
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Hero / steps */}
        <div className="mb-8 animate-fade-in-up">
          <h2 className="text-2xl font-bold tracking-tight text-[#16243f] sm:text-3xl">
            העלאת תכניות ← רשימה מסודרת אוטומטית
          </h2>
          <p className="mt-2 max-w-2xl text-slate-600">
            גרור את התכניות (ZIP או קובצי PDF). האפליקציה קוראת את הסטריפ של כל תכנית — שם, תיאור,
            מהדורה, תאריך, סטטוס וקנ&quot;מ — ומרכיבה רשימה אחידה. הכל מתבצע במחשב שלך.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { n: "1", t: "העלאת התכניות" },
              { n: "2", t: "קריאת הסטריפ (OCR) מכל תכנית" },
              { n: "3", t: "טבלה ניתנת לעריכה + ייצוא לאקסל" },
            ].map((s) => (
              <span
                key={s.n}
                className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#34a7c4] text-[11px] font-bold text-white">
                  {s.n}
                </span>
                {s.t}
              </span>
            ))}
          </div>
        </div>

        {/* Dropzone card */}
        <div className="animate-fade-in-up rounded-2xl bg-white p-6 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all ${
              dragOver ? "border-[#34a7c4] bg-[#34a7c4]/10 scale-[1.01]" : "border-slate-300 hover:border-[#6fdcec] hover:bg-slate-50"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf,.zip,application/zip"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="hidden"
            />
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#34a7c4]/10 text-[#2a7f99] ring-1 ring-[#34a7c4]/20 transition-transform group-hover:scale-110">
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="font-semibold text-slate-800">גרור לכאן את התכניות, או לחץ לבחירה</p>
            <p className="mt-1 text-sm text-slate-500">תומך ב-ZIP וב-PDF · העיבוד מתבצע מקומית במחשב שלך</p>

            {files.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {files.slice(0, 6).map((f, i) => (
                  <span key={i} className="inline-flex max-w-[220px] items-center gap-1.5 truncate rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
                    <span className="truncate">{f.name}</span>
                  </span>
                ))}
                {files.length > 6 && <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-500">+{files.length - 6} נוספים</span>}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={handleExtract}
              disabled={files.length === 0 || busy}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#34a7c4] to-[#2a7f99] px-5 py-2.5 font-semibold text-white shadow-lg shadow-[#2a7f99]/30 transition-all hover:from-[#3cb4d2] hover:to-[#2f8ba8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {busy ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  מחלץ…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M13 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  הפק רשימה
                </>
              )}
            </button>

            <button
              onClick={handleExport}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-300 transition-all hover:bg-emerald-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
              </svg>
              ייצוא לאקסל
            </button>

            {rows.length > 0 && !busy && (
              <span className="mr-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200">
                ✓ {rows.length} תכניות
              </span>
            )}
          </div>

          {/* Progress */}
          {busy && progress && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>{status}</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-l from-[#34a7c4] to-[#2a7f99] transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {busy && !progress && status && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#34a7c4]/10 px-3 py-2 text-sm text-[#1f3a5f] ring-1 ring-[#34a7c4]/20">
              <svg className="h-4 w-4 animate-spin text-[#2a7f99]" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              {status}
            </div>
          )}
          {err && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
              </svg>
              {err}
            </div>
          )}
        </div>

        {/* Editable results table */}
        {rows.length > 0 && (
          <div className="mt-6 animate-fade-in-up">
            <p className="mb-2 text-sm text-slate-500">
              💡 הטבלה ניתנת לעריכה — לחץ על כל תא לתיקון טעויות זיהוי לפני הייצוא.
            </p>
            <div className="overflow-hidden rounded-2xl bg-white shadow-xl shadow-slate-900/5 ring-1 ring-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead>
                    <tr className="bg-gradient-to-l from-[#16243f] to-[#1f3a5f] text-white/90">
                      <th className="px-2 py-3 font-semibold">#</th>
                      {COLUMNS.filter((c) => c.key !== "sourceFile").map((c) => (
                        <th key={c.key} className="whitespace-nowrap px-3 py-3 font-semibold">{c.label}</th>
                      ))}
                      <th className="px-2 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-[#34a7c4]/[0.05]">
                        <td className="px-2 py-1.5 text-center text-slate-400">{i + 1}</td>
                        {COLUMNS.filter((c) => c.key !== "sourceFile").map((c) => (
                          <td key={c.key} className="px-1 py-1">
                            <input
                              value={r[c.key]}
                              onChange={(e) => updateCell(i, c.key, e.target.value)}
                              dir={c.key === "planNumber" || c.key === "scale" || c.key === "date" ? "ltr" : "rtl"}
                              className={`w-full min-w-[80px] rounded-md border border-transparent bg-transparent px-2 py-1 hover:border-slate-200 focus:border-[#34a7c4] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#34a7c4] ${
                                c.key === "planNumber" ? "font-mono text-xs" : ""
                              }`}
                            />
                          </td>
                        ))}
                        <td className="px-1 py-1 text-center">
                          <button onClick={() => deleteRow(i)} title="מחק שורה" className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-7 0v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <footer className="mt-12 pb-6 text-center text-xs text-slate-400">
          העיבוד מתבצע במחשב המשתמש · הקבצים אינם נשמרים בשרת
        </footer>
      </main>
    </div>
  );
}
