export { ansi } from "../shared/colors.js";
import { ansi } from "../shared/colors.js";

/** The editor's neutral separator color. Semantic colors use theme.ts. */
export function getFgAnsiCode(_color: "sep"): string {
  return ansi.getFgAnsi256(244);
}
