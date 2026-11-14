import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { agentEnv } from "./harness.mjs";

const legacy = { powerline: { preset: "compact", placement: "below" }, powerlineShortcuts: { copyEditor: "ctrl+alt+c" }, bashMode: { completions: true } };
const pretty = { enabled: true, mode: "full", sideBorders: false };
const stereo = { side: "right", chatWidth: 40, layout: "rows", chatHeight: 12, showTimestamps: false, showCopyButtons: true, compactTools: true };
const { dir, module: loadModule } = agentEnv({
  "settings.json": legacy,
  "pretty-tui.json": pretty,
  "transcript.json": stereo,
  "pi-pretty-stereo-view.json": { powerline: { preset: "minimal" }, sidebar: { width: 32 } },
}, "ppsv-migration-");
const paths = ["settings.json", "pretty-tui.json", "transcript.json"];
const before = paths.map((name) => readFileSync(join(dir, name), "utf8"));
const store = await loadModule("extensions/integrated/settings-store.ts");
const migrated = store.readSettings();
assert.equal(migrated.schemaVersion, 1);
assert.deepEqual(migrated.prettyTui, pretty);
assert.deepEqual(migrated.stereo, stereo);
assert.deepEqual(migrated.powerline, { preset: "minimal", placement: "below" });
assert.equal(migrated.shellCompletions, true);
assert.deepEqual(paths.map((name) => readFileSync(join(dir, name), "utf8")), before);
writeFileSync(join(dir, "pretty-tui.json"), JSON.stringify({ mode: "clean" }));
assert.equal(store.readSettings().prettyTui.mode, "full");
store.updateSection("prettyTui", (current) => ({ ...current, mode: "compact" }));
const config = await loadModule("extensions/integrated/config.ts");
config.saveSettings({ sidebarEnabled: true, sidebarWidth: undefined, sidebarAutoHideBelow: 0, sidebarSessionPanel: false });
const preferences = await loadModule("extensions/stereo-view/preferences.ts");
await preferences.savePreferences(await preferences.loadPreferences());
const saved = store.readSettings();
assert.equal(saved.prettyTui.mode, "compact");
assert.equal(saved.powerline.preset, "minimal");
assert.equal(saved.sidebar.width, undefined);
assert.equal(saved.stereo.side, "right");
assert.equal(readdirSync(dir).some((name) => name.endsWith(".tmp")), false);
const file = join(dir, "pi-pretty-stereo-view.json");
writeFileSync(file, "{broken");
assert.throws(() => store.updateSection("sidebar", () => ({})));
assert.equal(readFileSync(file, "utf8"), "{broken");
console.log("MIGRATION PASS: legacy values, precedence, one-time import, atomic section writes, and malformed-file protection");
