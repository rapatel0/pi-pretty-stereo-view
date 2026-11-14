import assert from "node:assert/strict";
import { agentEnv } from "./harness.mjs";
const { module: loadModule } = agentEnv({}, "ppsv-clock-");
const { UiScheduler } = await loadModule("extensions/shared/scheduler.ts");
let now = 0;
let sequence = 0;
let maxTimers = 0;
const timers = new Map();
const clock = {
  now: () => now,
  setTimeout: (callback, delay) => {
    const id = ++sequence;
    timers.set(id, { callback, due: now + delay });
    maxTimers = Math.max(maxTimers, timers.size);
    return id;
  },
  clearTimeout: (id) => timers.delete(id),
};
const scheduler = new UiScheduler(clock);
const advance = (target) => {
  for (;;) {
    const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
    if (!next || next[1].due > target) break;
    now = next[1].due;
    timers.delete(next[0]);
    next[1].callback();
  }
  now = target;
};
let pulses = 0;
let sends = 0;
const stopPulse = scheduler.repeat(() => pulses++, 1000);
scheduler.once(() => sends++, 2500);
advance(2000);
assert.equal(pulses, 2);
assert.equal(sends, 0);
stopPulse();
advance(2500);
assert.equal(sends, 1);
assert.equal(scheduler.pendingCount, 0);
assert.equal(timers.size, 0);
advance(60000);
assert.equal(pulses, 2);
assert.equal(maxTimers, 1);
const cancel = scheduler.once(() => { throw new Error("Cancelled callback ran"); }, 10);
cancel();
advance(61000);
scheduler.repeat(() => pulses++, 16);
scheduler.clear();
assert.equal(timers.size, 0);
assert.equal(scheduler.pendingCount, 0);
console.log("SCHEDULER PASS: one timer, overlapping work, stop, cancellation, and 57.5 seconds with zero idle callbacks");
