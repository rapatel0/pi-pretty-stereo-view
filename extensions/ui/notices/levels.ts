import type { NoticeLevel } from "./store.js";

/** How notices read in the status bar, the inbox, and the plain-text fallback. */
export const NOTICE_GLYPHS: Record<NoticeLevel, string> = { info: "·", warning: "⚠", error: "✗" };

export type NoticeThemeToken = "dim" | "warning" | "error";

export const NOTICE_TOKENS: Record<NoticeLevel, NoticeThemeToken> = {
  info: "dim",
  warning: "warning",
  error: "error",
};

export function noticeLabel(count: number, level: NoticeLevel): string {
  return `${count} ${level}${count === 1 ? "" : "s"}`;
}
