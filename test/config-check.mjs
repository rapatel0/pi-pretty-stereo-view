import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentEnv } from "./harness.mjs";

const { dir, jiti } = agentEnv({}, "ppsv-cfg-");
const cfg = await jiti.import("../extensions/integrated/config.ts");
let failures = 0;
const check = (label, ok, seen) => {
  if (ok) return;
  failures += 1;
  console.error(`CFG FAIL ${label}:`, JSON.stringify(seen));
};

const a = cfg.loadSettings();
check("default autohide", a.sidebarAutoHideBelow === 100, a);
cfg.saveSettings({ sidebarEnabled: true, sidebarWidth: 30, sidebarAutoHideBelow: 0 });
const b = cfg.loadSettings();
check("roundtrip off", b.sidebarAutoHideBelow === 0 && b.sidebarWidth === 30, b);
writeFileSync(join(dir, "pi-pretty-stereo-view.json"), JSON.stringify({ sidebar: { enabled: false, autoHideBelowColumns: 140 } }));
const c = cfg.loadSettings();
check("file parse", c.sidebarEnabled === false && c.sidebarAutoHideBelow === 140, c);
if (failures > 0) process.exit(1);
console.log("CFG PASS");
