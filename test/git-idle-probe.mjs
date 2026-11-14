import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentEnv } from "./harness.mjs";
const { dir, module: loadModule } = agentEnv({}, "ppsv-git-idle-");
const cwd = join(dir, "repo");
mkdirSync(cwd);
childProcess.execFileSync("git", ["init", "-q", cwd]);
writeFileSync(join(cwd, "sample"), "before");
let starts = 0;
const spawn = childProcess.spawn;
const originalNow = Date.now;
try {
  childProcess.spawn = (...args) => { starts++; return spawn(...args); };
  syncBuiltinESMExports();
  const git = await loadModule("extensions/powerline/git-status.ts");
  git.getGitStatus(null, "full", cwd);
  git.getGitRemoteHost(cwd);
  await git.waitForGitUpdates();
  assert.ok(starts > 0);
  assert.equal(git.getGitStatus(null, "full", cwd).untracked, 1);
  const initial = starts;
  Date.now = () => originalNow() + 600_000;
  for (let i = 0; i < 100; i++) {
    git.getGitStatus(null, "full", cwd);
    git.getGitRemoteHost(cwd);
  }
  await git.waitForGitUpdates();
  assert.equal(starts, initial, "Idle redraws must not start Git processes");
  writeFileSync(join(cwd, "second"), "after");
  git.invalidateGitStatus();
  git.getGitStatus(null, "full", cwd);
  await git.waitForGitUpdates();
  assert.ok(starts > initial);
  assert.equal(git.getGitStatus(null, "full", cwd).untracked, 2);
} finally {
  Date.now = originalNow;
  childProcess.spawn = spawn;
  syncBuiltinESMExports();
}
console.log("GIT IDLE PASS: 100 idle redraws start zero processes, explicit invalidation refreshes real Git state");
