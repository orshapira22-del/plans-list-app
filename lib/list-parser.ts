/**
 * Filename heuristic to skip an already-made "plans list" PDF in an upload —
 * the app generates the list FROM the plans, so any such file isn't a plan.
 */
export function isListPdfName(name: string): boolean {
  return /רשימת\s*תוכנית|רשימת\s*תכנית|רשימה|plans?\s*list|index/i.test(name);
}
