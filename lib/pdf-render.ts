"use client";

import * as pdfjs from "pdfjs-dist";

// Static-export worker: copied to public/pdf.worker.min.mjs
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

// A plan/drawing number: a code with many hyphen segments (e.g. YSE-HW-000C-00000RD45-CD-2001-00).
// Requires ≥5 segments so it won't match short codes like WBS-P-5464-01.
const PLAN_NUM_RE = /\b[A-Z]{2,4}(?:[-_][A-Z0-9]+){4,}\b/g;
const WBS_RE = /^WBS\b/i;
const SCALE_RE = /\b1\s*[:/]\s*\d{1,4}(?:\s*[/\\]\s*\d{1,4})?\b/;

/** Pick the best plan-number candidate: longest, not WBS, not a filename. */
export function pickPlanNumber(text: string): string {
  const matches = text.match(PLAN_NUM_RE) ?? [];
  const ok = matches
    .map((m) => m.replace(/\.(pdf|dwg).*$/i, ""))
    .filter((m) => !WBS_RE.test(m));
  if (ok.length === 0) return "";
  return ok.sort((a, b) => b.length - a.length)[0];
}

export type StripResult = {
  stripCanvas: HTMLCanvasElement;
  planNumber: string;
  scale: string;
};

/**
 * Locate the title-block strip of a plan PDF (via the plan-number text position),
 * render just that corner region at high DPI for OCR, and pull the plan number +
 * scale straight from the (clean) text layer.
 */
export async function renderStrip(buf: ArrayBuffer): Promise<StripResult> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });

  const content = await page.getTextContent();
  type TI = { str: string; tx: number; ty: number };
  const items: TI[] = content.items
    .map((it) => {
      const s = "str" in it ? (it as { str: string }).str : "";
      const t = (it as { transform: number[] }).transform;
      return { str: s, tx: t[4], ty: t[5] };
    })
    .filter((i) => i.str && i.str.trim());

  // Plan number from the whole text layer (longest valid code, not WBS/filename)
  const allText = items.map((i) => i.str).join("\n");
  const planNumber = pickPlanNumber(allText);

  // Anchor = the text item containing (part of) that plan number, to locate the strip corner
  let anchor: TI | null = null;
  if (planNumber) {
    const head = planNumber.slice(0, 12);
    anchor = items.find((it) => it.str.includes(head)) ?? null;
  }
  if (!anchor) {
    // fall back to a WBS / file-name token which also sits in the title block
    anchor = items.find((it) => /WBS|FILE NAME/i.test(it.str)) ?? null;
  }

  // Scale from text layer
  let scale = "";
  for (const it of items) {
    const m = it.str.match(SCALE_RE);
    if (m) { scale = m[0].replace(/\s+/g, ""); break; }
  }

  // Determine the strip corner from the anchor's display position
  let fx = 0.08, fy = 0.92; // sensible default: bottom-left
  if (anchor) {
    const [vx, vy] = base.convertToViewportPoint(anchor.tx, anchor.ty);
    fx = vx / base.width;
    fy = vy / base.height;
  }
  const left = fx < 0.5;
  const top = fy < 0.5;

  // Strip box (display-space fractions) anchored at that corner
  const BW = 0.22, BH = 0.32;
  const x0 = left ? 0 : base.width * (1 - BW);
  const y0 = top ? 0 : base.height * (1 - BH);
  const boxW = base.width * BW;
  const boxH = base.height * BH;

  // Render just the box at high DPI (~1500px wide target)
  const scaleFactor = Math.min(4, Math.max(2, 1500 / boxW));
  const vp = page.getViewport({ scale: scaleFactor });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(boxW * scaleFactor);
  canvas.height = Math.ceil(boxH * scaleFactor);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport: vp,
    // offset so the strip box maps to the canvas origin
    transform: [1, 0, 0, 1, -x0 * scaleFactor, -y0 * scaleFactor],
  }).promise;

  doc.destroy();
  return { stripCanvas: canvas, planNumber, scale };
}
