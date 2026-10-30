import { agentEnv } from "./harness.mjs";

const { module: loadModule } = agentEnv({
  "pretty-tui.json": { enabled: true, mode: "compact", sideBorders: false },
  "transcript.json": "{}",
  "pi-pretty-stereo-view.json": { sidebar: { enabled: true, width: 30 } },
}, "ppsv-agent-");

const registered = { events: [], commands: [], shortcuts: [], tools: [], other: [] };
const noop = () => () => {};
const known = {
  on: (name) => { registered.events.push(name); return noop; },
  registerCommand: (name) => { registered.commands.push(name); return noop; },
  registerShortcut: (combo) => { registered.shortcuts.push(combo); return noop; },
  registerTool: (def) => { registered.tools.push(def?.name ?? "?"); return noop; },
  registerFlag: (name) => { registered.other.push(`flag:${name}`); return noop; },
  registerMessageRenderer: (t) => { registered.other.push(`renderer:${t}`); return noop; },
  registerEntryRenderer: (t) => { registered.other.push(`entry:${t}`); return noop; },
  events: { on: () => noop },
  getAllTools: () => [],
  getActiveTools: () => [],
  getCommands: () => [],
  getThinkingLevel: () => "off",
  getSessionName: () => "smoke",
  setActiveTools: () => {},
  setSessionName: () => {},
  sendUserMessage: async () => {},
  exec: async () => ({ stdout: "", stderr: "", code: 0 }),
};
const pi = new Proxy(known, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop !== "string") return undefined;
    return (...args) => { registered.other.push(`${prop}(${args.length})`); return typeof args[0] === "function" ? undefined : noop; };
  },
});

let failures = 0;
for (const entry of ["extensions/stereo-view/index.ts", "extensions/powerline/index.ts",
  "extensions/pretty-tui/index.ts", "extensions/integrated/sidebar-host.ts", "extensions/index.ts"]) {
  try {
    const mod = await loadModule(entry);
    console.log(`IMPORT OK   ${entry} (default=${typeof mod.default})`);
  } catch (error) {
    failures++;
    console.log(`IMPORT FAIL ${entry}\n${String(error.stack).split("\n").slice(0, 6).join("\n")}`);
  }
}
try {
  const mod = await loadModule("extensions/index.ts");
  await mod.default(pi);
  console.log(`FACTORIES OK events=${registered.events.length} commands=[${[...new Set(registered.commands)].join(",")}] shortcuts=${registered.shortcuts.length} tools=${registered.tools.length}`);
  const commands = new Set(registered.commands);
  for (const required of ["ui-settings", "sidebar", "powerline", "pretty-tui", "stereo-view"]) {
    if (!commands.has(required)) {
      failures++;
      console.log(`SMOKE FAIL command "${required}" not registered`);
    }
  }
  // The unified panel drives each component through its bridge; a missing
  // bridge means /ui-settings would show dead sections.
  const bridges = await loadModule("extensions/integrated/bridges.js");
  for (const [name, getter] of [["pretty-tui", "getPrettyTuiBridge"], ["stereo", "getStereoBridge"], ["powerline", "getPowerlineBridge"]]) {
    const bridge = bridges[getter]?.();
    if (bridge && typeof bridge.statusLine === "function") {
      console.log(`BRIDGE OK   ${name}: ${bridge.statusLine()}`);
    } else {
      failures++;
      console.log(`SMOKE FAIL ${name} bridge not registered`);
    }
  }
} catch (error) {
  failures++;
  console.log(`FACTORIES FAIL\n${String(error.stack).split("\n").slice(0, 10).join("\n")}`);
}
console.log(failures === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
