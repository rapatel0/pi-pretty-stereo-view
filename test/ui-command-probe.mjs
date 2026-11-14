import assert from "node:assert/strict";
import { agentEnv } from "./harness.mjs";
const { module: loadModule } = agentEnv({}, "ppsv-ui-");
const commands = new Map();
const shortcuts = [];
const noop = () => {};
const pi = new Proxy({
  registerCommand: (name, definition) => commands.set(name, definition),
  registerShortcut: (name) => shortcuts.push(name),
  on: noop,
  events: { on: () => noop },
}, { get: (target, key) => key in target ? target[key] : noop });
await (await loadModule("extensions/index.ts")).default(pi);
assert.deepEqual([...commands.keys()], ["ui"]);
assert.equal(shortcuts.length, 8);
let menu;
let themeValue;
let reloads = 0;
const theme = { name: "ayu-dark", fg: (_color, text) => text };
const ctx = {
  mode: "tui", hasUI: true,
  reload: async () => { reloads++; },
  ui: {
    notify: noop, setEditorComponent: noop, setFooter: noop, setHeader: noop, setWidget: noop,
    select: async (_title, options) => { menu = options; return undefined; },
    getTheme: (name) => name === "ayu-dark" ? theme : undefined,
    setTheme: (value) => { themeValue = value; return { success: true }; },
    getAllThemes: () => [{ name: "ayu-dark" }],
  },
};
const run = (text) => commands.get("ui").handler(text, ctx);
await run("");
assert.equal(menu.length, 9);
for (const name of ["Sidebar", "Tool presentation", "Split view", "Status bar", "Subagents", "Processes", "Notices", "Theme"]) {
  assert.ok(menu.some((row) => row.startsWith(name + " — ")));
}
assert.ok(menu.some((row) => row.startsWith("Notices — ") && /unread/.test(row)), "the Notices row reports the inbox");
await run("mode full");
await run("preset compact");
await run("split off");
await run("sidebar off");
await run("powerline");
await run("theme ayu-dark");
assert.equal(themeValue, theme);
await run("perf on");
assert.equal(reloads, 1);
const { readSettings } = await loadModule("extensions/integrated/settings-store.ts");
const saved = readSettings();
assert.equal(saved.prettyTui.mode, "full");
assert.equal(typeof saved.powerline === "string" ? saved.powerline : saved.powerline.preset, "compact");
assert.equal((await loadModule("extensions/integrated/ui-runtime.ts")).getPowerlineBridge().preset(), "compact");
assert.deepEqual((await loadModule("extensions/integrated/ui-runtime.ts")).getPowerlineBridge().presets().sort(),
  ["ascii", "compact", "default", "full", "minimal", "nerd"]);
assert.equal(saved.splitEnabled, false);
assert.equal(saved.statusBarEnabled, false);
assert.equal(saved.sidebar.enabled, false);
assert.equal(saved.theme, "ayu-dark");
assert.equal(saved.diagnostics.enabled, true);
const protectedDisplay = () => {
  const current = readSettings();
  return JSON.stringify([current.sidebar, current.splitEnabled, current.statusBarEnabled, current.prettyTui]);
};
const beforePanels = protectedDisplay();
for (const [label, key] of [["Subagents", "subagentPanelEnabled"], ["Processes", "processPanelEnabled"]]) {
  for (const enabled of [false, true]) {
    let chosen = false;
    ctx.ui.select = async (_title, options) => {
      if (chosen) return "Exit";
      chosen = true;
      return options.find((option) => option.startsWith(`${label} — `));
    };
    await run("");
    assert.equal(readSettings()[key], enabled);
    assert.equal(protectedDisplay(), beforePanels);
  }
}
const { updateSection } = await loadModule("extensions/integrated/settings-store.ts");
updateSection("prettyTui", (current) => ({ ...current, enabled: false }));
(await loadModule("extensions/pretty-tui/index.ts")).default(pi);
const disabled = (await loadModule("extensions/integrated/ui-runtime.ts")).getPrettyTuiBridge();
assert.equal(disabled.enabled(), false);
disabled.setMode("compact");
assert.equal(disabled.mode(), "compact");
assert.equal(disabled.enabled(), false);
await disabled.setEnabled(true, ctx);
assert.equal(disabled.enabled(), true);
assert.equal(reloads, 2);
console.log("UI PASS: one command, seven switches, retained shortcuts, live controls, persistence, and theme objects");
