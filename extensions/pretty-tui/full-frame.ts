import { RenderMemo } from "../shared/render-cache.js";
import { fillToWidth, padToWidth } from "../shared/text.js";
import { cardSurface } from "./card-surface.js";
import { isNativeImageRow, stripAnsiBackgrounds } from "./ansi-style.js";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type NativeFrame = {
  lines: string[]; sourceRows: Map<number, number>; contentWidth: number; inset: number;
};
/** When false, panel body rows drop the visible side columns; top/bottom rules stay. */
export let sideBorders = true;
export function setSideBorders(enabled: boolean): void { sideBorders = enabled; }
/** WeakMap cache key: any component instance can own a cached frame. */
type RenderCacheOwner = object;
const frameCache = new RenderMemo<NativeFrame>();
export const cardMargin = (width: number) => width >= 20 ? 1 : 0;
export const nativeFrameWidth = (width: number) => {
  const panelWidth = width - cardMargin(width) * 2;
  return panelWidth >= 8 ? panelWidth - 4 : Math.max(1, panelWidth);
};

/** Fill one panel row, preserving foreground styles and reopening after resets. */
export const cardBackground = (line: string, width: number, theme: any, role = "toolPendingBg", borderRole?: string): string => {
  if (isNativeImageRow(line)) return line;
  const content = stripAnsiBackgrounds(line);
  const padded = padToWidth(content, width);
  const surface = cardSurface(theme, borderRole, role);
  const prefix = surface.prefix;
  const reopened = padded.replace(/\x1b\[([0-9:;]*)m/g, (sequence, raw: string) => {
    const fields = raw.split(";");
    let reset = raw === "";
    for (let i = 0; i < fields.length; i++) {
      const code = Number(fields[i].split(":")[0] || 0);
      if (code === 0) reset = true;
      if (!fields[i].includes(":") && (code === 38 || code === 58)) {
        i += fields[i + 1] === "2" ? 4 : fields[i + 1] === "5" ? 2 : 0;
      }
    }
    return reset ? sequence + prefix : sequence;
  });
  return surface.paint(reopened);
};

/** One shared panel for native text, media, thinking, replies and user messages. */
function renderPanel(
  title: string, source: string[], width: number, theme: any,
  sections = new Map<number, { label: string; color: string }>(), cacheOwner?: RenderCacheOwner,
  titleColor = "text", footer = "", borderColor = "borderMuted", background = "toolPendingBg",
): NativeFrame {
  const palette = ["borderMuted", "text", "accent", "success", "error", titleColor, borderColor]
    .map((role) => theme.fg(role, "x")).join("|") + (theme.bold?.("x") ?? "x") +
    cardSurface(theme, borderColor, background).signature;
  const sectionKey = titleColor + borderColor + footer + background + JSON.stringify([...sections]);
  const cacheInputs = [title, width, palette, sectionKey, sideBorders, ...source];
  const cached = cacheOwner ? frameCache.read(cacheOwner, cacheInputs) : undefined;
  if (cached) return cached;
  const sourceRows = new Map<number, number>();
  if (width < 8) {
    source.forEach((_, y) => sourceRows.set(y, y));
    return { lines: source.map((row) => cardBackground(row, width, theme, background, borderColor)), sourceRows, contentWidth: Math.max(1, width), inset: 0 };
  }
  const contentWidth = width - 4;
  const border = (s: string) => theme.fg(borderColor, s);
  const plainCaption = truncateToWidth(title, width - 6, "…");
  const caption = theme.fg(titleColor, theme.bold?.(plainCaption) ?? plainCaption);
  const lines = [border("╭─ ") + caption + border(" " + fillToWidth(width - 5, [plainCaption], "─") + "╮")];
  // Pi uses empty rows as image reservations. Preserve them so the viewport
  // can find and crop an image when its first row scrolls out of view.
  const imageRows = new Set<number>();
  source.forEach((row, index) => {
    const kitty = /\x1b_G([^;]*);/.exec(row);
    if (kitty) {
      const count = Number(/(?:^|,)r=(\d+)(?:,|$)/.exec(kitty[1])?.[1] ?? 1);
      for (let y = index + 1; y < Math.min(source.length, index + count) && source[y] === ""; y++) imageRows.add(y);
    } else if (row.includes("\x1b]1337;File=")) {
      const count = Number(/\x1b\[(\d+)A/.exec(row)?.[1] ?? 0);
      for (let y = index - 1; y >= Math.max(0, index - count) && source[y] === ""; y--) imageRows.add(y);
    }
  });
  source.forEach((row, sourceY) => {
    const section = sections.get(sourceY);
    if (section) {
      const plainLabel = truncateToWidth(section.label, width - 5, "…");
      const label = theme.fg(section.color, plainLabel);
      sourceRows.set(lines.length, sourceY);
      lines.push(border("├─ ") + label + border(" " + fillToWidth(width - 5, [plainLabel], "─") + "┤"));
    }
    sourceRows.set(lines.length, sourceY);
    if (imageRows.has(sourceY)) lines.push("");
    else if (isNativeImageRow(row)) lines.push("  " + row);
    else {
      const content = stripAnsiBackgrounds(row);
      lines.push((sideBorders ? border("│ ") : "  ") + padToWidth(content, contentWidth) + (sideBorders ? border(" │") : "  "));
    }
  });
  const footerFits = footer && visibleWidth(footer) + 6 <= width;
  lines.push(footerFits
    ? border("╰" + "─".repeat(width - visibleWidth(footer) - 5) + " " + footer + " ─╯")
    : border("╰" + "─".repeat(width - 2) + "╯"));
  const reserved = new Set([...sourceRows].filter(([, sourceY]) => imageRows.has(sourceY)).map(([y]) => y));
  const frame = { lines: lines.map((line, y) => reserved.has(y) ? line : cardBackground(line, width, theme, background, borderColor)), sourceRows, contentWidth, inset: 2 };
  if (cacheOwner) frameCache.write(cacheOwner, cacheInputs, frame);
  return frame;
}

const gutterFrames = new RenderMemo<NativeFrame>();

/** Outer gutters stay on the terminal background, outside the filled panel. */
export function frameNativeRows(
  title: string, source: string[], width: number, theme: any,
  sections = new Map<number, { label: string; color: string }>(), cacheOwner?: RenderCacheOwner,
  titleColor = "text", footer = "", borderColor = "borderMuted", background = "toolPendingBg",
): NativeFrame {
  const margin = cardMargin(width);
  const frame = renderPanel(title, source, width - margin * 2, theme, sections, cacheOwner,
    titleColor, footer, borderColor, background);
  if (!margin) return frame;
  const cached = gutterFrames.read(frame, []);
  if (cached) return cached;
  const padded = { ...frame, inset: frame.inset + margin,
    lines: frame.lines.map((line) => isNativeImageRow(line) ? " ".repeat(margin) + line : line === "" ? line : " ".repeat(margin) + line + " ".repeat(margin)),
  };
  gutterFrames.write(frame, [], padded);
  return padded;
}

const trimmedIndices = (source: string[], start: number, end: number): number[] => {
  // Preserve image reservation rows and internal text blank lines.
  if (!source.slice(start, end).some(isNativeImageRow)) {
    while (start < end && !stripTerminalSequences(source[start]).trim()) start++;
    while (end > start && !stripTerminalSequences(source[end - 1]).trim()) end--;
  }
  return Array.from({ length: end - start }, (_, i) => start + i);
};

/** Keep native call/output content in one panel, divided at its actual boundary. */
export function frameNativeToolRows(
  title: string, source: string[], width: number, theme: any,
  resultStart: number | undefined, resultColor: string, owner: RenderCacheOwner, footer = "",
): NativeFrame {
  const hasOutput = resultStart !== undefined && resultStart > 0 && resultStart < source.length;
  const indices = width < 8 ? source.map((_, i) => i) : hasOutput
    ? [...trimmedIndices(source, 0, resultStart!), ...trimmedIndices(source, resultStart!, source.length)]
    : trimmedIndices(source, 0, source.length);
  const sections = new Map<number, { label: string; color: string }>();
  if (hasOutput) {
    const output = indices.findIndex((i) => i >= resultStart!);
    if (output >= 0) sections.set(output, { label: "Output", color: resultColor });
  }
  const color = resultColor === "error" || resultColor === "success" ? resultColor : "accent";
  const frame = frameNativeRows(title, indices.map((i) => source[i]), width, theme, sections, owner,
    color, footer, color, resultColor === "error" ? "toolErrorBg" : "toolPendingBg");
  return { ...frame, sourceRows: new Map([...frame.sourceRows].map(([y, i]) => [y, indices[i]])) };
}
