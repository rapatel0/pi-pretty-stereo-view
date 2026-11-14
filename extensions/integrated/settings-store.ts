import { isRecord as isSettingsRecord } from "../shared/value.js";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentDir } from "./ui-runtime.js";

export type SettingsRecord = Record<string, unknown>;
export { isRecord as isSettingsRecord } from "../shared/value.js";

export function mergeSettings(base: SettingsRecord, override: SettingsRecord): SettingsRecord {
  const next = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const merged = isSettingsRecord(value) && isSettingsRecord(next[key])
      ? mergeSettings(next[key], value) : value;
    Object.defineProperty(next, key, { value: merged, enumerable: true, writable: true, configurable: true });
  }
  return next;
}

function readRecord(file: string, legacy = false): SettingsRecord {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isSettingsRecord(value)) throw new Error(`Expected an object in ${file}`);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || legacy) return {};
    throw error;
  }
}

export const settingsPath = (): string => join(getAgentDir(), "pi-pretty-stereo-view.json");

let cachedPlane: { file: string; fingerprint: string; value: SettingsRecord } | undefined;
function readPlane(): SettingsRecord {
  const file = settingsPath();
  let fingerprint: string;
  try {
    const stat = statSync(file, { bigint: true });
    fingerprint = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  if (cachedPlane?.file === file && cachedPlane.fingerprint === fingerprint) return cachedPlane.value;
  const value = readRecord(file);
  cachedPlane = { file, fingerprint, value };
  return value;
}

function writeSettings(value: SettingsRecord): void {
  const file = settingsPath();
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
    cachedPlane = undefined;
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Import legacy preferences once. Legacy files remain intact. */
export function readSettings(cwd = process.cwd()): SettingsRecord {
  const plane = readPlane();
  if (plane.schemaVersion === 1) return plane;
  const agent = getAgentDir();
  const legacy = mergeSettings(readRecord(join(agent, "settings.json"), true),
    readRecord(join(cwd, ".pi", "settings.json"), true));
  const imported: SettingsRecord = {
    prettyTui: readRecord(join(agent, "pretty-tui.json"), true),
    stereo: readRecord(join(agent, "transcript.json"), true),
    currencyRates: readRecord(join(agent, "powerline-footer", "currency-rates.json"), true),
    diagnostics: {
      enabled: process.env.POWERLINE_DEBUG_PERF === "1",
      fastRender: process.env.POWERLINE_PERF_FAST_RENDER !== "0",
      editorChrome: process.env.POWERLINE_PERF_EDITOR_CHROME !== "0",
      widgets: process.env.POWERLINE_PERF_WIDGETS !== "0",
      lastPrompt: process.env.POWERLINE_PERF_LAST_PROMPT !== "0",
    },
    powerlineTheme: readRecord(join(agent, "extensions", "powerline-footer", "theme.json"), true),
  };
  if (process.env.POWERLINE_NERD_FONTS === "1" || process.env.POWERLINE_NERD_FONTS === "0") {
    (imported.powerlineTheme as SettingsRecord).nerdFonts = process.env.POWERLINE_NERD_FONTS === "1";
  }
  for (const key of ["powerline", "powerlineShortcuts", "showLastPrompt"]) {
    if (legacy[key] !== undefined) imported[key] = legacy[key];
  }
  if (isSettingsRecord(legacy.powerline) && typeof legacy.powerline.enabled === "boolean") {
    imported.statusBarEnabled = legacy.powerline.enabled;
  }
  const bashMode = isSettingsRecord(legacy.bashMode) ? legacy.bashMode : {};
  imported.shellCompletions = bashMode.completions === true;
  const next = { ...mergeSettings(imported, plane), schemaVersion: 1 };
  writeSettings(next);
  return next;
}

export function updateSettings(update: (current: SettingsRecord) => SettingsRecord): SettingsRecord {
  const next = update(readSettings());
  writeSettings({ ...next, schemaVersion: 1 });
  return next;
}

export function readSection(key: string): SettingsRecord {
  const value = readSettings()[key];
  return isSettingsRecord(value) ? value : {};
}

export function updateSection(key: string, update: (current: SettingsRecord) => SettingsRecord): void {
  updateSettings((plane) => ({ ...plane, [key]: update(isSettingsRecord(plane[key]) ? plane[key] : {}) }));
}
