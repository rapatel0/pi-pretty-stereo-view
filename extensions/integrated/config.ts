import { DEFAULT_SETTINGS } from "./defaults.js";
import { readSection, updateSection } from "./settings-store.js";

export type IntegratedSettings = {
  sidebarEnabled: boolean;
  /** Sidebar width in columns; undefined lets the sidebar pick 20% of the terminal. */
  sidebarWidth: number | undefined;
  /** Hide the sidebar on terminals narrower than this (0 disables auto-hide). */
  sidebarAutoHideBelow: number;
};




export function loadSettings(): IntegratedSettings {
  try {
    const sidebar = readSection("sidebar");
    if (!sidebar || typeof sidebar !== "object") return { ...DEFAULT_SETTINGS };
    const width = typeof sidebar.width === "number" && Number.isFinite(sidebar.width)
      ? Math.round(sidebar.width)
      : undefined;
    const autoHideBelow = typeof sidebar.autoHideBelowColumns === "number" && Number.isFinite(sidebar.autoHideBelowColumns)
      ? Math.max(0, Math.min(200, Math.round(sidebar.autoHideBelowColumns)))
      : DEFAULT_SETTINGS.sidebarAutoHideBelow;
    return {
      sidebarEnabled: sidebar.enabled !== false,
      sidebarWidth: width,
      sidebarAutoHideBelow: autoHideBelow,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: IntegratedSettings): void {
  updateSection("sidebar", (current) => {
    const next = {
      ...current,
      enabled: settings.sidebarEnabled,
      autoHideBelowColumns: settings.sidebarAutoHideBelow,
      width: settings.sidebarWidth,
    };
    return next;
  });
}

export { DEFAULT_SETTINGS } from "./defaults.js";
