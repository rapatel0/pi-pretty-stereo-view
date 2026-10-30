// Shared probe setup: an isolated agent dir, a jiti loader, and module
// resolution — kept identical across probes so every test exercises the same
// runtime path pi takes to load the bundle.
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

export function agentEnv(files = {}, prefix = "ppsv-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.HOME = process.env.HOME || homedir();
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof contents === "string" ? contents : JSON.stringify(contents));
  }
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const repoRoot = new URL("..", import.meta.url).pathname;
  return {
    dir,
    jiti,
    url: (path) => new URL(path, import.meta.url).href,
    module: (entry) => jiti.import(pathToFileURL(join(repoRoot, entry)).href),
  };
}
