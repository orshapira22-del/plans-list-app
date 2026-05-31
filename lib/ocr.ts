import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

/** Lazily create a shared Hebrew+English Tesseract worker (model downloads once, cached). */
function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(["heb", "eng"], 1, {
      logger: onProgress
        ? (m) => {
            if (m.status === "recognizing text" && typeof m.progress === "number") {
              onProgress(m.progress);
            }
          }
        : undefined,
    });
  }
  return workerPromise;
}

/** OCR an image (canvas / dataURL / Blob) → recognized text. */
export async function ocrImage(
  image: HTMLCanvasElement | string | Blob,
  onProgress?: (p: number) => void
): Promise<string> {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(image);
  return data.text;
}

export async function warmupOcr(onStatus?: (s: string) => void): Promise<void> {
  onStatus?.("טוען מנוע זיהוי תווים בעברית (חד-פעמי)…");
  await getWorker();
  onStatus?.("");
}
