import { getDocumentProxy } from "unpdf";

export type PdfItem = { str: string; x: number; y: number; page: number };

export async function pdfBufferToItems(buf: ArrayBuffer): Promise<PdfItem[]> {
  const doc = await getDocumentProxy(new Uint8Array(buf));

  const items: PdfItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      const s = "str" in it ? (it as { str: string }).str : "";
      if (!s || !s.trim()) continue;
      const t = (it as { transform: number[] }).transform;
      items.push({ str: s, x: t[4], y: t[5], page: p });
    }
  }
  return items;
}
