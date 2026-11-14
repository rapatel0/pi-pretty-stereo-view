import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { panelBottom, panelContent, panelTop } from "../sidebar/panel.js";
import type { WorkItem, WorkKind, WorkState } from "./state.js";

export class WorkPanel implements Component {
  private rows: WorkItem[] = [];
  constructor(
    private readonly theme: Theme,
    private readonly state: WorkState,
    private readonly kind: WorkKind,
    private readonly open: (item: WorkItem) => void,
  ) {}
  invalidate(): void {}
  render(width: number): string[] {
    if (width < 1) return [];
    this.rows = this.state.list(this.kind);
    const title = this.kind === "subagent" ? "Subagents" : "Processes";
    const lines = [panelTop(this.theme, title, width)];
    for (const item of this.rows) {
      const age = Math.max(0, Math.floor((Date.now() - item.observedAt) / 1000));
      const label = stripTerminalSequences(`${item.status} · ${item.label} · seen ${age}s ago`);
      lines.push(panelContent(this.theme, label, item.status === "error" ? "error" : "dim", Math.max(1, width - 4)));
    }
    if (!this.rows.length) lines.push(panelContent(this.theme, "No observed work", "dim", Math.max(1, width - 4)));
    lines.push(panelBottom(this.theme, width));
    return lines.map((line) => truncateToWidth(line, width, ""));
  }
  handleMouse(event: TuiMouseEvent): { handled: true } | undefined {
    if (event.type !== "click" || event.button !== "left") return;
    const item = this.rows[event.y - 1];
    if (!item) return;
    queueMicrotask(() => this.open(item));
    return { handled: true };
  }
}
