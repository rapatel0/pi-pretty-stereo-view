import { randomUUID } from "node:crypto";
import { uiScheduler } from "../../shared/scheduler.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSettingsRecord as isRecord } from "../../integrated/settings-store.js";

export type WorkKind = "subagent" | "process";
export interface WorkItem {
  id: string;
  kind: WorkKind;
  label: string;
  status: string;
  observedAt: number;
  startedAt?: number;
  sessionFile?: string;
  partialText?: string;
  result?: string;
  error?: string;
  parentAgentId?: string;
  workflowId?: string;
}

export class WorkState {
  private readonly items = new Map<string, WorkItem>();
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(): void { for (const listener of this.listeners) listener(); }
  clear(): void { this.items.clear(); this.changed(); }
  get(kind: WorkKind, id: string): WorkItem | undefined { return this.items.get(`${kind}:${id}`); }
  list(kind: WorkKind): WorkItem[] {
    return [...this.items.values()].filter((item) => item.kind === kind).sort((a, b) => b.observedAt - a.observedAt);
  }
  observe(kind: WorkKind, value: unknown, status?: string): void {
    if (!isRecord(value) || typeof value.id !== "string") return;
    const previous = this.get(kind, value.id);
    const item: WorkItem = {
      ...previous,
      id: value.id, kind,
      label: String(value.description ?? value.name ?? value.command ?? previous?.label ?? value.id),
      status: status ?? (typeof value.status === "string" ? value.status : previous?.status ?? "unknown"),
      observedAt: Date.now(),
    };
    if (status === "pending" || status === "running" || (item.status === "running" && previous?.status !== "running")) {
      delete item.result;
      delete item.error;
      delete item.partialText;
    }
    if (!["running", "queued", "pending", "ready"].includes(item.status)) delete item.partialText;
    for (const key of ["sessionFile", "partialText", "result", "error", "parentAgentId", "workflowId"] as const) {
      if (typeof value[key] === "string") item[key] = value[key];
    }
    if (typeof value.startedAt === "number") item.startedAt = value.startedAt;
    this.items.set(`${kind}:${item.id}`, item);
    this.changed();
  }
  rebuild(branch: readonly unknown[]): void {
    this.clear();
    for (const entry of branch) {
      if (!isRecord(entry)) continue;
      if (entry.customType === "subagents:record") this.observe("subagent", entry.data);
      if (entry.type === "message" && isRecord(entry.message) && entry.message.role === "toolResult") {
        this.observeTool(String(entry.message.toolName), entry.message, {});
      }
    }
  }
  observeTool(name: string, result: unknown, input: unknown): void {
    if (!name.startsWith("bg_task") || !isRecord(result)) return;
    const params = isRecord(input) ? input : {};
    const details = result.details;
    if (isRecord(details)) {
      this.observe("process", details);
      if (Array.isArray(details.tasks)) for (const item of details.tasks) this.observe("process", item);
    }
    if (!Array.isArray(result.content)) return;
    const text = result.content.filter(isRecord).filter((part) => part.type === "text").map((part) => part.text).join("\n");
    try {
      const data = JSON.parse(text);
      for (const item of Array.isArray(data) ? data : [data]) this.observe("process", item);
    } catch { /* The producer also returns documented compact text. */ }
    const launch = text.match(/Started background \S+ (.+?)\. Status: ([\w-]+)\./);
    if (launch) {
      const id = launch[1]!.match(/\(([^()]+)\)$/)?.[1] ?? launch[1]!;
      this.observe("process", { ...params, id, name: params.name ?? launch[1], result: text }, launch[2]);
    }
    for (const line of text.split("\n")) {
      const row = line.match(/^([\w-]+) (running|starting|completed|failed|stopped|exited|error|unknown)\b/);
      if (row) this.observe("process", { id: row[1], result: text }, row[2]);
      const status = line.match(/Background task ([\w-]+) is ([\w-]+)/);
      if (status) this.observe("process", { id: status[1], result: text }, status[2]);
    }
    if (typeof params.id === "string" && result.isError === true) {
      this.observe("process", { id: params.id, error: text }, "unknown");
    }
  }
}

export function connectSubagentEvents(pi: ExtensionAPI, state: WorkState): () => void {
  const pending = new Set<() => void>();
  const requestSnapshot = () => {
    const requestId = randomUUID();
    let cancelTimeout = () => {};
    let releaseReply = () => {};
    const cleanup = () => { cancelTimeout(); releaseReply(); pending.delete(cleanup); };
    pending.add(cleanup);
    releaseReply = pi.events.on(`subagents:rpc:list:reply:${requestId}`, (reply) => {
      if (isRecord(reply) && reply.success === true && isRecord(reply.data) && Array.isArray(reply.data.agents)) {
        for (const agent of reply.data.agents) state.observe("subagent", agent);
      }
      cleanup();
    });
    cancelTimeout = uiScheduler.once(cleanup, 1000);
    pi.events.emit("subagents:rpc:list", { requestId });
  };
  const phases: Record<string, string | undefined> = {
    created: "pending", scheduled: "queued", scheduler: undefined,
    started: "running", steered: undefined, usage: undefined, compacted: undefined,
    completed: "completed", failed: "error", disposed: "disposed", state: undefined,
  };
  const release = Object.entries(phases).map(([phase, status]) =>
    pi.events.on(`subagents:${phase}`, (data) => {
      const existing = phase === "created" && isRecord(data) && typeof data.id === "string" ? state.get("subagent", data.id) : undefined;
      state.observe("subagent", data, existing ? undefined : status);
    }));
  release.push(pi.events.on("subagents:ready", requestSnapshot));
  requestSnapshot();
  return () => {
    for (const unsubscribe of release) unsubscribe();
    for (const cleanup of pending) cleanup();
  };
}
