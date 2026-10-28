import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type IntegratedSettings = {
  sidebarEnabled: boolean;
  /** Sidebar width in columns; undefined lets the sidebar pick 20% of the terminal. */
  sidebarWidth: number | undefined;
};

export const DEFAULT_SETTINGS: IntegratedSettings = { sidebarEnabled: true, sidebarWidth: undefined };

const configFile = (): string => join(getAgentDir(), "pi-pretty-stereo-view.json");

type FileShape = { sidebar?: { enabled?: unknown; width?: unknown } };

export function loadSettings(): IntegratedSettings {
  try {
    const parsed = JSON.parse(readFileSync(configFile(), "utf8")) as FileShape;
    const sidebar = parsed?.sidebar;
    if (!sidebar || typeof sidebar !== "object") return { ...DEFAULT_SETTINGS };
    const width = typeof sidebar.width === "number" && Number.isFinite(sidebar.width)
      ? Math.round(sidebar.width)
      : undefined;
    return {
      sidebarEnabled: sidebar.enabled !== false,
      sidebarWidth: width,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: IntegratedSettings): void {
  let existing: FileShape = {};
  try {
    const parsed = JSON.parse(readFileSync(configFile(), "utf8")) as FileShape;
    if (parsed && typeof parsed === "object") existing = parsed;
  } catch {
    // A missing or broken config file is rewritten below.
  }
  const next: FileShape = {
    ...existing,
    sidebar: {
      ...existing.sidebar,
      enabled: settings.sidebarEnabled,
      ...(settings.sidebarWidth === undefined ? {} : { width: settings.sidebarWidth }),
    },
  };
  writeFileSync(configFile(), `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
