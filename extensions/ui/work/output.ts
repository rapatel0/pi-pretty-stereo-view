import { matchesKey } from "../../shared/keys.js";
import { closeSync, fstatSync, openSync, readSync, watch, type FSWatcher } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { isSettingsRecord as isRecord } from "../../integrated/settings-store.js";
import type { WorkItem, WorkState } from "./state.js";

export function readWorkOutput(item: WorkItem): string {
  if (item.error) return item.error;
  if (item.result) return item.result;
  if (!item.sessionFile && item.partialText) return item.partialText;
  if (!item.sessionFile && item.kind === "process") return "No process output was observed. Run bg_task_status to refresh the snapshot.";
  if (!item.sessionFile) return "Live output is unavailable. This agent has no published session file. Final output appears after completion.";
  let descriptor: number | undefined;
  try {
    descriptor = openSync(item.sessionFile, "r");
    const size = fstatSync(descriptor).size;
    const offset = Math.max(0, size - 256 * 1024);
    const buffer = Buffer.alloc(size - offset);
    const count = readSync(descriptor, buffer, 0, buffer.length, offset);
    let lines = buffer.subarray(0, count).toString("utf8").split("\n");
    if (offset > 0) lines = lines.slice(1);
    const text: string[] = offset > 0 ? ["[Latest 256 KiB of the session]"] : [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const message = entry.message;
        if (!isRecord(message) || !["assistant", "toolResult"].includes(String(message.role))) continue;
        const content = typeof message.content === "string" ? message.content : Array.isArray(message.content)
          ? message.content.filter(isRecord).filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
        if (content) text.push(`${message.role}: ${content}`);
      } catch { /* A writer can leave the last JSON line incomplete. */ }
    }
    const persisted = text.join("\n\n");
    if (item.partialText && !persisted.includes(item.partialText)) return `${persisted}\n\n${item.partialText}`.trim();
    return persisted || "The agent has no text output yet.";
  } catch (error) {
    return item.partialText ?? `Cannot read agent output: ${String(error)}`;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export async function openWorkOutput(ctx: ExtensionContext, state: WorkState, item: WorkItem): Promise<void> {
  let watcher: FSWatcher | undefined;
  let watchedFile: string | undefined;
  let release = () => {};
  try {
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      let offset: number | undefined;
      const refresh = () => {
        const current = state.get(item.kind, item.id) ?? item;
        if (current.sessionFile !== watchedFile || (!watcher && current.sessionFile)) {
          watcher?.close();
          watcher = undefined;
          watchedFile = current.sessionFile;
          if (watchedFile) {
            try {
              watcher = watch(watchedFile, { persistent: false }, () => tui.requestRender());
              watcher.on("error", () => { watcher?.close(); watcher = undefined; });
            } catch { /* Render exposes the read error. Public events still refresh the view. */ }
          }
        }
        tui.requestRender();
      };
      release = state.subscribe(refresh);
      refresh();
      return {
        render(width: number): string[] {
          const current = state.get(item.kind, item.id) ?? item;
          const body = wrapTextWithAnsi(stripTerminalSequences(readWorkOutput(current)), Math.max(1, width));
          const height = Math.max(1, Math.min(30, tui.terminal.rows - 6));
          const top = Math.max(0, Math.min(offset ?? Math.max(0, body.length - height), Math.max(0, body.length - height)));
          return [truncateToWidth(`${current.label} · ${current.status} · Esc closes`, width, ""), ...body.slice(top, top + height)];
        },
        invalidate() {},
        handleInput(data: string) {
          if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { done(); return; }
          if (matchesKey(data, "up")) offset = Math.max(0, (offset ?? 0) - 1);
          if (matchesKey(data, "down")) offset = (offset ?? 0) + 1;
          if (matchesKey(data, "home")) offset = 0;
          if (matchesKey(data, "end")) offset = undefined;
          tui.requestRender();
        },
      };
    }, { overlay: true, overlayOptions: { width: "85%", maxHeight: "85%" } });
  } finally {
    release();
    watcher?.close();
  }
}
