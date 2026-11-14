import type { IntegratedSettings } from "./config.js";
import type { Preferences } from "../stereo-view/preferences.js";
import type { PowerlineConfig } from "../powerline/powerline-config.js";
import type { PowerlineShortcuts } from "../powerline/index.js";
import type { ColorScheme, PresetDef, StatusLinePreset } from "../powerline/types.js";

/** Initial UI preferences and presets. Runtime state uses copies of these values. */
export const DEFAULT_SETTINGS: IntegratedSettings = {
  sidebarEnabled: true,
  sidebarWidth: undefined,
  sidebarAutoHideBelow: 100,
};

export const STEREO_DEFAULTS: Preferences = {
  mode: "split", side: "left", chatWidth: null, layout: "columns", chatHeight: null, zoom: null, showTimestamps: true, showCopyButtons: true, compactTools: false,
};

export const DEFAULT_COLORS: Required<ColorScheme> = {
  model: "#d787af",  // Pink/mauve (matching original colors.ts)
  path: "#00afaf",  // Teal/cyan (matching original colors.ts)
  gitDirty: "warning",
  gitClean: "success",
  thinking: "thinkingOff",
  thinkingMinimal: "thinkingMinimal",
  thinkingLow: "thinkingLow",
  thinkingMedium: "thinkingMedium",
  thinkingHigh: "rainbow",
  thinkingXhigh: "rainbow",
  thinkingMax: "rainbow",
  context: "dim",
  contextWarn: "warning",
  contextError: "error",
  noticeInfo: "dim",
  noticeWarn: "warning",
  noticeError: "error",
  cost: "text",
  tokens: "muted",
  separator: "dim",
  border: "borderMuted",
};

export const POWERLINE_DEFAULTS: PowerlineConfig = {
  preset: "default",
  customItems: [],
  disabledSegments: [],
  invalidDisabledSegments: [],
  layout: null,
  invalidLayoutSegments: [],
  separator: null,
  segmentOptions: {},
  placement: "above",
  invalidPlacement: null,
  padding: 1,
  secondaryOverflow: "drop",
  invalidSecondaryOverflow: null,
  workingIndicatorPlacement: "editor-border",
  invalidWorkingIndicatorPlacement: null,
  sendDelayMs: 0,
  autoFollowUp: false,
};

export const DEFAULT_SHORTCUTS: PowerlineShortcuts = {
  copyEditor: "ctrl+alt+c",
  cutEditor: "ctrl+alt+x",
  editorStart: "super+shift+up",
  editorEnd: "super+shift+down",
};


// Minimal - more muted, less colorful
const MINIMAL_COLORS: ColorScheme = {
  ...DEFAULT_COLORS,
  model: "text",
  path: "text",
  gitClean: "dim",
};

// Nerd - vibrant colors
const NERD_COLORS: ColorScheme = {
  ...DEFAULT_COLORS,
  model: "accent",
  path: "success",
  tokens: "muted",
  cost: "warning",
};

export const PRESETS: Record<StatusLinePreset, PresetDef> = {
  default: {
    leftSegments: ["model", "thinking", "path", "git", "context_pct", "cache_read", "cost", "notices"],
    rightSegments: [],
    secondarySegments: ["extension_statuses"],
    separator: "powerline-thin",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },

  minimal: {
    leftSegments: ["path", "git", "notices"],
    rightSegments: ["context_pct"],
    separator: "slash",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: false, showUnstaged: false, showUntracked: false },
    },
  },

  compact: {
    leftSegments: ["model", "git", "notices"],
    rightSegments: ["cost", "context_pct"],
    separator: "powerline-thin",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
    },
  },

  full: {
    leftSegments: ["hostname", "model", "thinking", "path", "git", "subagents", "notices"],
    rightSegments: ["token_in", "token_out", "cache_read", "cost", "context_pct", "time_spent", "time", "extension_statuses"],
    separator: "powerline",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 50 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: false },
    },
  },

  nerd: {
    leftSegments: ["hostname", "model", "thinking", "path", "git", "session", "subagents", "notices"],
    rightSegments: ["token_in", "token_out", "cache_read", "cache_write", "cost", "context_pct", "context_total", "time_spent", "time", "extension_statuses"],
    separator: "powerline",
    colors: NERD_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 60 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: true },
    },
  },

  ascii: {
    leftSegments: ["model", "path", "git", "notices"],
    rightSegments: ["token_total", "cost", "context_pct"],
    separator: "ascii",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: true },
      path: { mode: "abbreviated", maxLength: 40 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },

};



export const PRETTY_DEFAULTS = { enabled: true, sideBorders: true, mode: "clean" as const };
