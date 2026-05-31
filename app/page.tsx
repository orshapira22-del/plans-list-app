"use client";

import { useState, useRef, useCallback } from "react";
import JSZip from "jszip";
import { COLUMNS, type PlanRow } from "@/lib/extractor";
import { LogoFull } from "./components/Logo";

type ExtractResponse = {
  rows: PlanRow[];
  sourceFile: string;
  diagnostics: { totalPdfs: number; tried: { name: string; rows: number }[] };
};

function looksLikeListPdf(name: string): boolean {
  return /רשימת\s*תוכנית|רשימת\s*תכנית|רשימה|plans?\s*list|index/i.test(name);
}

async function selectPdfsForUpload(files: File[], onStatus: (s: string) => void): Promise<File[]> {
  const pdfs: File[] = [];
  const fallback: File[] = [];

  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      pdfs.push(f);
      continue;
    }
    if (lower.endsWith(".zip")) {
      onStatus(`פותח את ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)} MB) במחשב שלך…`);
      const zip = await JSZip.loadAsync(f);
      const entries = Object.values(zip.files).filter((e) => !e.dir && /\.pdf$/i.test(e.name));
      onStatus(`נמצאו ${entries.length} קבצי PDF בחבילה. מאתר את קובץ הרשימה…`);

      const namedList = entries.filter((e) => looksLikeListPdf(e.name));
      const targets =
        namedList.length > 0
          ? namedList
          : entries.filter((e) => {
              const size = (e as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
              return size > 0 && size < 500_000;
            });

      for (const entry of targets) {
        const blob = await entry.async("blob");
        const fileName = entry.name.split(/[\\/]/).pop() ?? entry.name;
        const file = new File([blob], fileName, { type: "application/pdf" });
        (namedList.length > 0 ? pdfs : fallback).push(file);
      }
    }
  }

  return pdfs.length > 0 ? pdfs : fallback;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [info, setInfo] = useState<ExtractResponse | null>(null);
  const [status, setStatus] = useState<string>("");
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
    setInfo(null);
    setStatus("מעבד קבצים…");

    try {
      const toUpload = await selectPdfsForUpload(files, setStatus);
      if (toUpload.length === 0) {
        throw new Error("לא נמצא קובץ PDF מתאים בתוך החבילה. ודא שה-ZIP מכיל את 'רשימת תוכניות.pdf'.");
      }
      const totalKB = toUpload.reduce((a, f) => a + f.size, 0) / 1024;
      setStatus(`שולח ${toUpload.length} קבצים לעיבוד (${totalKB.toFixed(0)} KB)…`);

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
            העלאת תכניות → רשימה מסודרת תוך שניות
          </h2>
          <p className="mt-2 max-w-2xl text-slate-600">
            גרור לכאן את חבילת ה-ZIP של המתכנן או את קובץ ה-PDF. הקבצים מעובדים אצלך במחשב —
            רק קובץ הרשימה הקטן נשלח לעיבוד. הפלט מיוצא לאקסל בפורמט אחיד.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { n: "1", t: "העלאה" },
              { n: "2", t: "זיהוי אוטומטי של קובץ הרשימה" },
              { n: "3", t: "טבלה + ייצוא לאקסל" },
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
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all ${
              dragOver
                ? "border-[#34a7c4] bg-[#34a7c4]/10 scale-[1.01]"
                : "border-slate-300 hover:border-[#6fdcec] hover:bg-slate-50"
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
            <p className="font-semibold text-slate-800">
              גרור לכאן קבצים, או לחץ לבחירה
            </p>
            <p className="mt-1 text-sm text-slate-500">תומך ב-ZIP וב-PDF · עד מאות MB · העיבוד מתבצע מקומית</p>

            {files.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {files.slice(0, 6).map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex max-w-[220px] items-center gap-1.5 truncate rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-[#2a7f99]" fill="currentColor">
                      <path d="M7 2h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" opacity="0.25" />
                      <path d="M14 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                    <span className="truncate">{f.name}</span>
                  </span>
                ))}
                {files.length > 6 && (
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                    +{files.length - 6} נוספים
                  </span>
                )}
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
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
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

            {rows.length > 0 && (
              <span className="mr-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200">
                ✓ {rows.length} תכניות
              </span>
            )}
          </div>

          {status && (
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

        {/* Loading skeleton */}
        {busy && rows.length === 0 && (
          <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-xl shadow-slate-900/5 ring-1 ring-slate-200">
            <div className="h-12 bg-slate-100" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 border-t border-slate-100 px-4 py-3.5">
                {Array.from({ length: 5 }).map((__, j) => (
                  <div key={j} className="shimmer h-4 flex-1 rounded" />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Source diagnostics */}
        {info && (
          <div className="mt-6 animate-fade-in-up rounded-xl bg-white p-4 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
            {info.sourceFile ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  זוהה קובץ מקור:
                </span>
                <span className="font-mono text-xs text-slate-600">{info.sourceFile}</span>
                <span className="text-slate-400">·</span>
                <span>נסרקו {info.diagnostics.totalPdfs} קבצים · {rows.length} שורות</span>
              </div>
            ) : (
              <div className="text-amber-700">
                לא זוהה קובץ רשימת תכניות מתאים. ודא שהחבילה כוללת את &quot;רשימת תוכניות.pdf&quot;.
              </div>
            )}
          </div>
        )}

        {/* Results table */}
        {rows.length > 0 && (
          <div className="mt-6 animate-fade-in-up overflow-hidden rounded-2xl bg-white shadow-xl shadow-slate-900/5 ring-1 ring-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="bg-gradient-to-l from-[#16243f] to-[#1f3a5f] text-white/90">
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="whitespace-nowrap px-4 py-3.5 font-semibold">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      style={{ animationDelay: `${Math.min(i * 35, 500)}ms` }}
                      className="border-t border-slate-100 transition-colors hover:bg-[#34a7c4]/[0.06]"
                    >
                      {COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className={
                            c.key === "sourceFile"
                              ? "px-4 py-3 font-mono text-xs text-slate-400"
                              : c.key === "planNumber"
                              ? "px-4 py-3 font-mono text-xs text-slate-700"
                              : c.key === "seq"
                              ? "px-4 py-3 text-slate-400"
                              : c.key === "purpose"
                              ? "px-4 py-3"
                              : "px-4 py-3 text-slate-800"
                          }
                        >
                          {c.key === "purpose" && r[c.key] ? (
                            <span className="inline-block rounded-md bg-[#34a7c4]/10 px-2 py-0.5 text-xs font-medium text-[#2a7f99] ring-1 ring-[#34a7c4]/20">
                              {r[c.key]}
                            </span>
                          ) : (
                            r[c.key]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
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
