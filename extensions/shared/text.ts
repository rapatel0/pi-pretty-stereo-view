import { visibleWidth } from "@earendil-works/pi-tui";

/** Columns left after text. ANSI sequences do not consume columns. */
export function remainingWidth(width: number, ...parts: string[]): number {
  return Math.max(0, width - parts.reduce((used, text) => used + visibleWidth(text), 0));
}

export function fillToWidth(width: number, parts: readonly string[], fill: " " | "─" = " "): string {
  return fill.repeat(remainingWidth(width, ...parts));
}

/** Pad by terminal columns. ANSI sequences do not consume columns. */
export function padToWidth(text: string, width: number): string {
  return text + fillToWidth(width, [text]);
}
