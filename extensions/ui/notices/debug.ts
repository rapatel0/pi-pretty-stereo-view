import { appendFileSync } from "node:fs";

/**
 * `PPSV_NOTICE_DEBUG=<file>` records what the notice path saw. Whether the
 * guard engages at all is not visible from the screen: Pi's notify path is not
 * reachable from the module an extension imports, which is why the wrap sits on
 * the component tree instead. This log is what makes a silent miss obvious.
 */
export const noticeDebugEnabled = Boolean(process.env.PPSV_NOTICE_DEBUG);

export function noticeDebugRow(row: Record<string, unknown>): void {
  const file = process.env.PPSV_NOTICE_DEBUG;
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...row })}\n`);
  } catch { /* Diagnostics must never break the notice path. */ }
}
