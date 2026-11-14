import { uiScheduler, type Cancel } from "../shared/scheduler.js";
export interface RenderScheduler {
  schedule(delayMs?: number): void;
  cancel(): void;
}

export function createRenderScheduler(render: () => void, defaultDelayMs: number): RenderScheduler {
  let pending: { timer: Cancel; deadline: number } | null = null;

  return {
    schedule(delayMs = defaultDelayMs) {
      const deadline = Date.now() + delayMs;
      if (pending) {
        if (deadline >= pending.deadline) return;
        pending.timer();
      }

      const timer = uiScheduler.once(() => {
        pending = null;
        render();
      }, delayMs);
      pending = { timer, deadline };
    },
    cancel() {
      if (!pending) return;
      pending.timer();
      pending = null;
    },
  };
}
