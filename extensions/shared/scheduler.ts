export type Cancel = () => void;
type Timer = ReturnType<typeof setTimeout>;
interface Clock {
  now(): number;
  setTimeout(callback: () => void, delay: number): Timer;
  clearTimeout(timer: Timer): void;
}
interface Job { due: number; callback: () => void; interval?: number }

/** One native timer owns all pending UI work. An empty queue owns no timer. */
export class UiScheduler {
  private readonly jobs = new Map<symbol, Job>();
  private timer: Timer | undefined;
  private firing = false;
  private recurringExecutions = 0;
  constructor(private readonly clock: Clock = { now: Date.now, setTimeout, clearTimeout }) {}
  get pendingCount(): number { return this.jobs.size; }
  get recurringCallbacks(): number { return this.recurringExecutions; }
  get recurringCount(): number { return [...this.jobs.values()].filter((job) => job.interval !== undefined).length; }
  once(callback: () => void, delay: number): Cancel { return this.add(callback, delay); }
  repeat(callback: () => void, interval: number): Cancel {
    if (!Number.isFinite(interval) || interval <= 0) throw new Error("The redraw interval must be positive");
    return this.add(callback, interval, interval);
  }
  clear(): void {
    this.jobs.clear();
    this.arm();
  }
  private add(callback: () => void, delay: number, interval?: number): Cancel {
    const key = Symbol();
    this.jobs.set(key, { callback, interval, due: this.clock.now() + Math.max(0, delay) });
    this.arm();
    return () => { this.jobs.delete(key); this.arm(); };
  }
  private arm(): void {
    if (this.firing) return;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.jobs.size) return;
    const due = Math.min(...[...this.jobs.values()].map((job) => job.due));
    this.timer = this.clock.setTimeout(() => this.flush(), Math.max(0, due - this.clock.now()));
  }
  private flush(): void {
    this.timer = undefined;
    this.firing = true;
    try {
      const now = this.clock.now();
      for (const [key, job] of [...this.jobs]) {
        if (!this.jobs.has(key) || job.due > now) continue;
        if (job.interval === undefined) this.jobs.delete(key);
        else { job.due = now + job.interval; this.recurringExecutions++; }
        job.callback();
      }
    } finally {
      this.firing = false;
      this.arm();
    }
  }
}
export const uiScheduler = new UiScheduler();
