/**
 * Decode the Glotan / קו-מדידה plan-number convention without OCR.
 *
 *   YSE-HW-000C-00000RD45-CD-2001-00
 *   └─┬─┘ └┬┘                 └┬┘ └┬┘
 *  project disc.            stage  rev
 *
 * Stage two-letter code → planning status (Hebrew):
 *   SD  Schematic Design   ראשוני
 *   DD  Detailed Design    מפורט / למכרז
 *   CD  Construction Doc   לביצוע
 *   FA  For Approval       לאישור
 *   AB  As Built           לאחר ביצוע (as-built)
 */

const STAGE_TO_STATUS: Record<string, string> = {
  SD: "ראשוני",
  DD: "למכרז",
  CD: "לביצוע",
  FA: "לאישור",
  AB: "לאחר ביצוע",
  IF: "להיתר",
};

/** Segment immediately before the final two segments is the stage code. */
export function decodeStatus(planNumber: string): string {
  const segs = planNumber.split("-");
  // Stage is the segment before the last two (sheet number + revision)
  for (let i = segs.length - 3; i >= 0; i--) {
    const tok = segs[i].toUpperCase();
    if (STAGE_TO_STATUS[tok]) return STAGE_TO_STATUS[tok];
  }
  return "";
}

/** Final two-digit segment is the revision (e.g. -00, -01, -02). */
export function decodeRevision(planNumber: string): string {
  const segs = planNumber.split("-");
  const last = segs[segs.length - 1];
  return /^\d{1,3}$/.test(last) ? String(parseInt(last, 10)) : "";
}
