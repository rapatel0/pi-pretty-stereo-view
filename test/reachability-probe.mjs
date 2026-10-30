// Ratchet: every module under extensions/ must be reachable from the bundle
// entry, statically or via dynamic import(). Vendored trees grow on upstream
// sync; a module nobody loads is dead weight in every user's startup bundle.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = new URL("../extensions/", import.meta.url).pathname;
const ENTRY = `${ROOT}index.ts`;
const STATIC_RE = /(?:from|import)\s+["'](\.[^"']+)["']/g;
const DYNAMIC_RE = /import\(\s*["'](\.[^"']+)["']\s*\)/g;

const resolveLocal = (from, spec) => {
  let base = resolve(dirname(from), spec);
  if (base.endsWith(".js") || base.endsWith(".ts")) base = base.slice(0, -3);
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
};

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
};

const all = walk(ROOT);
const reached = new Set();
const queue = [ENTRY];
while (queue.length > 0) {
  const file = queue.pop();
  if (file === undefined || reached.has(file)) continue;
  reached.add(file);
  const source = readFileSync(file, "utf8");
  for (const re of [STATIC_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) {
      const target = resolveLocal(file, match[1]);
      if (target !== undefined && !reached.has(target)) queue.push(target);
    }
  }
}

const unreached = all.filter((file) => !reached.has(file) && !file.endsWith("/index.ts"));
console.log(`modules=${all.length} reached=${reached.size} unreached=${unreached.length}`);
for (const file of unreached) console.log(`UNREACHED ${file.slice(ROOT.length)}`);
console.log(unreached.length === 0 ? "REACH PROBE PASS" : "REACH PROBE FAIL");
process.exit(unreached.length === 0 ? 0 : 1);
