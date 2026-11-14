import { STEREO_DEFAULTS as defaults } from "../integrated/defaults.js";
import { readSection, updateSection } from "../integrated/settings-store.js";

export interface Preferences {
  mode: "split" | "combined";
  /** Left means first: left in columns, top in rows. */
  side: "left" | "right";
  /** Null reserves 20% of the column layout; a number is a manual width. */
  chatWidth: number | null;
  layout: "columns" | "rows";
  /** Null grows to half the history area; a number is a manual maximum. */
  chatHeight: number | null;
  zoom: "activity" | "chat" | null;
  showTimestamps: boolean;
  showCopyButtons: boolean;
  compactTools: boolean;
}



/** Read display preferences, retaining the first version's saved arrangement. */
export async function loadPreferences(): Promise<Preferences> {
  const value = readSection("stereo");
  if (Object.keys(value).length === 0) return { ...defaults };
  const record = value as Record<string, unknown>;
  // The first version only had columns; keep that saved arrangement.
  const layout = record.layout === undefined ? "columns" : record.layout;
  const chatHeight = record.chatHeight === undefined ? defaults.chatHeight : record.chatHeight;
  const showTimestamps = record.showTimestamps === undefined ? defaults.showTimestamps : record.showTimestamps;
  const showCopyButtons = record.showCopyButtons === undefined ? defaults.showCopyButtons : record.showCopyButtons;
  const compactTools = record.compactTools === undefined ? defaults.compactTools : record.compactTools;
  if ((record.side !== "left" && record.side !== "right") ||
      (record.chatWidth !== null && (typeof record.chatWidth !== "number" || !Number.isInteger(record.chatWidth) ||
        record.chatWidth < 24 || record.chatWidth > 240)) ||
      (layout !== "columns" && layout !== "rows") ||
      (chatHeight !== null && (typeof chatHeight !== "number" || !Number.isInteger(chatHeight) || chatHeight < 4 || chatHeight > 240)) ||
      typeof showTimestamps !== "boolean" || typeof showCopyButtons !== "boolean" || typeof compactTools !== "boolean") {
    throw new Error("Invalid pi-stereo-view preferences");
  }
  // Legacy files may contain mode/zoom. Every session starts with both panels visible.
  return { mode: "split", side: record.side, chatWidth: record.chatWidth, layout, chatHeight, zoom: null, showTimestamps, showCopyButtons, compactTools };
}

/** Atomically save only the display settings, never session messages. */
export async function savePreferences(preferences: Preferences): Promise<void> {
  const { side, chatWidth, layout, chatHeight, showTimestamps, showCopyButtons, compactTools } = preferences;
  updateSection("stereo", (current) => ({
    ...current, side, chatWidth, layout, chatHeight, showTimestamps, showCopyButtons, compactTools,
  }));
}

export { STEREO_DEFAULTS as defaults } from "../integrated/defaults.js";
