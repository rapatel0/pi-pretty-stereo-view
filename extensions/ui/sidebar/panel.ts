import { fillToWidth, padToWidth, remainingWidth } from "../../shared/text.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export type PanelColor = "success" | "error" | "warning" | "dim" | "accent";

export function panelTop(theme: Theme, title: string, renderWidth: number): string {
  const innerWidth = Math.max(1, renderWidth - 2);
  const titleText = ` ${title} `;
  const borderWidth = remainingWidth(innerWidth, titleText);
  const left = Math.floor(borderWidth / 2);
  const right = borderWidth - left;
  return theme.fg("accent", `╭${"─".repeat(left)}${titleText}${"─".repeat(right)}╮`);
}

export function panelBottom(theme: Theme, renderWidth: number): string {
  return theme.fg("accent", `╰${"─".repeat(Math.max(1, renderWidth - 2))}╯`);
}

export function panelContent(
  theme: Theme,
  content: string,
  color: PanelColor,
  contentWidth: number,
): string {
  const text = truncateToWidth(content, contentWidth, "");
  const padding = fillToWidth(contentWidth, [text]);
  return theme.fg("dim", "│ ") +
    theme.fg(color, text) +
    theme.fg("dim", `${padding} │`);
}

export function panelRow(
  theme: Theme,
  label: string,
  value: string,
  color: PanelColor,
  contentWidth: number,
): string {
  const labelWidth = Math.max(1, Math.min(11, Math.floor(contentWidth * 0.58)));
  const valueWidth = Math.max(1, contentWidth - labelWidth - 1);
  const labelText = padToWidth(truncateToWidth(label, labelWidth, ""), labelWidth);
  const valueText = truncateToWidth(value, valueWidth, "");
  const padding = fillToWidth(contentWidth - 1, [labelText, valueText]);
  return theme.fg("dim", "│ ") +
    theme.fg("dim", `${labelText} `) +
    theme.fg(color, valueText) +
    theme.fg("dim", `${padding} │`);
}
