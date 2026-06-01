"use client";

/**
 * Azure AI Vision OCR — runs in the browser.
 *
 * The user enters their Azure key + endpoint once (stored in localStorage on
 * their machine — never shipped in the app bundle, never on a server).
 */

const KEY_STORAGE = "plans-list:azure-key";
const ENDPOINT_STORAGE = "plans-list:azure-endpoint";

export type AzureCreds = { key: string; endpoint: string };

export function getCreds(): AzureCreds | null {
  if (typeof window === "undefined") return null;
  const key = localStorage.getItem(KEY_STORAGE) ?? "";
  const endpoint = localStorage.getItem(ENDPOINT_STORAGE) ?? "";
  if (!key || !endpoint) return null;
  return { key, endpoint: endpoint.replace(/\/$/, "") };
}

export function setCreds(c: AzureCreds): void {
  localStorage.setItem(KEY_STORAGE, c.key.trim());
  localStorage.setItem(ENDPOINT_STORAGE, c.endpoint.trim().replace(/\/$/, ""));
}

export function clearCreds(): void {
  localStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(ENDPOINT_STORAGE);
}

type AzureV4Response = {
  readResult?: {
    blocks?: Array<{
      lines?: Array<{
        text: string;
        boundingPolygon?: Array<{ x: number; y: number }>;
      }>;
    }>;
  };
};

/**
 * OCR a canvas via Azure Image Analysis 4.0 (READ). Synchronous, fast (~1-2s).
 * Hebrew is auto-detected by the model; no `language` parameter needed.
 * Requires Standard (S1) tier or higher on the Vision resource.
 */
export async function ocrCanvas(canvas: HTMLCanvasElement): Promise<{
  text: string;
  lines: { text: string; box: number[] }[];
}> {
  const creds = getCreds();
  if (!creds) {
    throw new Error("חסר מפתח Azure. לחץ על ⚙️ כדי להזין את ה-Key וה-Endpoint.");
  }

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92)
  );

  const url = `${creds.endpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": creds.key,
      "Content-Type": "application/octet-stream",
    },
    body: blob,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure OCR שגיאה ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as AzureV4Response;

  const lines: { text: string; box: number[] }[] = [];
  for (const b of data.readResult?.blocks ?? []) {
    for (const l of b.lines ?? []) {
      const box = (l.boundingPolygon ?? []).flatMap((p) => [p.x, p.y]);
      lines.push({ text: l.text, box });
    }
  }
  return { text: lines.map((l) => l.text).join("\n"), lines };
}
