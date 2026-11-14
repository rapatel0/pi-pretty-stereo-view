import { PRESETS } from "../integrated/defaults.js";
import type { PresetDef, StatusLinePreset } from "./types.ts";
export { PRESETS } from "../integrated/defaults.js";

export function getPreset(name: StatusLinePreset): PresetDef {
  return PRESETS[name] ?? PRESETS.default;
}
