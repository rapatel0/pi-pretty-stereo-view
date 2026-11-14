import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TranscriptRuntime, DisplayRow, ToolStatus } from "./runtime-types.js";
export function initializeToolRenderers(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.block = (rows: DisplayRow[]): Component => ({
        render(width: number): string[] {
            const rendered: string[] = [];
            for (const row of rows) {
                const prefix = typeof row.prefix === "function" ? row.prefix() : row.prefix;
                const content = typeof row.content === "function" ? row.content() : row.content;
                const rawContinuation = row.continuation ?? " ".repeat(visibleWidth(prefix));
                const continuation = typeof rawContinuation === "function" ? rawContinuation() : rawContinuation;
                const prefixWidth = Math.max(visibleWidth(prefix), visibleWidth(continuation));
                const contentWidth = Math.max(1, width - prefixWidth);
                const wrapped = wrapTextWithAnsi(content || " ", contentWidth);
                rendered.push(prefix + (wrapped[0] ?? ""));
                for (const line of wrapped.slice(1))
                    rendered.push(continuation + line);
            }
            return rendered;
        },
        invalidate() { },
    });
    transcriptRuntime.setStatus = (context: any, status: ToolStatus) => {
        context.state.compactToolStatus = status;
    };
    transcriptRuntime.callRow = (theme: any, name: string, detail: string, state: any): DisplayRow => ({
        prefix: () => {
            const status = (state.compactToolStatus ?? "running") as ToolStatus;
            const color = status === "success" ? "success" : status === "error" ? "error" : "dim";
            if (transcriptRuntime.renderMode === "compact")
                return name === "bash" ? theme.fg("toolTitle", "$ ") : "";
            return theme.fg(color, "● ");
        },
        continuation: transcriptRuntime.renderMode === "compact" && name !== "bash" ? "" : "  ",
        content: transcriptRuntime.renderMode === "compact" ? theme.fg("muted", detail) :
            theme.fg("text", theme.bold(name)) +
                theme.fg("dim", "(") +
                theme.fg("muted", detail) +
                theme.fg("dim", ")"),
    });
    transcriptRuntime.call = (theme: any, name: string, detail: string, state: any) => transcriptRuntime.block([transcriptRuntime.callRow(theme, name, detail, state)]);
    transcriptRuntime.writeCall = (theme: any, name: string, path: string, content: string, expanded: boolean, state: any) => {
        const lines = content.replace(/\t/g, "    ").split("\n");
        while (lines.length > 0 && lines[lines.length - 1] === "")
            lines.pop();
        const total = lines.length;
        const shown = lines.slice(0, expanded ? total : 10);
        const remaining = total - shown.length;
        const rows: DisplayRow[] = [
            transcriptRuntime.callRow(theme, name, `${path} · ${total} ${total === 1 ? "line" : "lines"}`, state),
        ];
        for (let index = 0; index < shown.length; index++) {
            const isLast = index === shown.length - 1 && remaining === 0;
            rows.push({
                prefix: theme.fg("dim", isLast ? "   └ " : "   │ "),
                continuation: isLast ? "     " : theme.fg("dim", "   │ "),
                content: theme.fg("toolOutput", shown[index] || " "),
            });
        }
        if (remaining > 0) {
            rows.push({
                prefix: theme.fg("muted", "   └ "),
                continuation: "     ",
                content: theme.fg("muted", `… ${remaining} more ${remaining === 1 ? "line" : "lines"}`),
            });
        }
        return transcriptRuntime.block(rows);
    };
    transcriptRuntime.editDiffLayout = (theme: any, diff: string): ((line: string) => DisplayRow) => {
        const parse = (line: string) => /^([ +\-]) *(\d+) (.*)$/.exec(line);
        const numberWidth = diff.split("\n").reduce((width, line) => Math.max(width, parse(line)?.[2].length ?? 0), 1);
        const gutterWidth = numberWidth + 3;
        return (line) => {
            const match = parse(line);
            const marker = match?.[1] ?? (line.startsWith("+") && !line.startsWith("+++") ? "+" :
                line.startsWith("-") && !line.startsWith("---") ? "-" : " ");
            const color = marker === "+" ? "toolDiffAdded" : marker === "-" ? "toolDiffRemoved" : "toolDiffContext";
            const gutter = match ? `${match[2].padStart(numberWidth)} ${marker} ` : " ".repeat(gutterWidth);
            return {
                prefix: theme.fg(color, gutter),
                continuation: " ".repeat(gutterWidth),
                content: theme.fg(color, match ? match[3] : /^\s+\.\.\.$/.test(line) ? "..." : line),
            };
        };
    };
    transcriptRuntime.result = (theme: any, summary: string, output = "", expanded = false, error = false, summaryIsStyled = false, outputStyle: (line: string) => string = (line) => theme.fg("dim", line), outputLayout?: (line: string) => DisplayRow) => {
        const rows: DisplayRow[] = [{
                prefix: theme.fg("dim", "└  "),
                continuation: "   ",
                content: summaryIsStyled ? summary : theme.fg(error ? "error" : "toolOutput", summary),
            }];
        if (expanded && output) {
            const lines = output.split("\n");
            while (lines.length > 1 && lines[lines.length - 1] === "")
                lines.pop();
            const shown = lines.slice(0, 40);
            const omitted = lines.length - shown.length;
            for (let index = 0; index < shown.length; index++) {
                const isLast = index === shown.length - 1 && omitted === 0;
                const layout = outputLayout?.(shown[index]);
                rows.push({
                    prefix: theme.fg("dim", isLast ? "   └ " : "   │ ") + (layout?.prefix ?? ""),
                    continuation: (isLast ? "     " : theme.fg("dim", "   │ ")) + (layout?.continuation ?? ""),
                    content: layout?.content ?? outputStyle(shown[index] || " "),
                });
            }
            if (omitted > 0) {
                rows.push({
                    prefix: theme.fg("muted", "   └ "),
                    continuation: "     ",
                    content: theme.fg("muted", `… ${omitted} more lines`),
                });
            }
        }
        return transcriptRuntime.block(rows);
    };
    transcriptRuntime.isError = (renderContext: any): boolean => Boolean(renderContext?.isError);
    transcriptRuntime.partialResult = (context: any, theme: any, label: string): Component => {
        transcriptRuntime.setStatus(context, "running");
        return transcriptRuntime.result(theme, label);
    };
    transcriptRuntime.terminalOutputLines = (output: string): string[] => {
        const lines: string[] = [];
        let current = "";
        for (let index = 0; index < output.length; index++) {
            const char = output[index];
            if (char === "\r") {
                if (output[index + 1] === "\n") {
                    lines.push(current);
                    current = "";
                    index++;
                }
                else {
                    // A bare carriage return redraws the current terminal line. Progress
                    // bars such as tqdm use this to update in place.
                    current = "";
                }
            }
            else if (char === "\n") {
                lines.push(current);
                current = "";
            }
            else {
                current += char;
            }
        }
        if (current)
            lines.push(current);
        return lines;
    };
    transcriptRuntime.bashResult = (context: any, theme: any, summary: string, output: string, expanded: boolean, status: ToolStatus): Component => {
        transcriptRuntime.setStatus(context, status);
        const lines = transcriptRuntime.terminalOutputLines(output);
        const shown = expanded ? lines : lines.slice(-5);
        const omitted = lines.length - shown.length;
        const rows: DisplayRow[] = [{
                prefix: theme.fg("dim", "└  "),
                continuation: "   ",
                content: theme.fg(status === "error" ? "error" : "toolOutput", summary),
            }];
        if (omitted > 0) {
            rows.push({
                prefix: theme.fg("muted", "   │ "),
                continuation: theme.fg("muted", "   │ "),
                content: theme.fg("muted", `… ${omitted} earlier ${omitted === 1 ? "line" : "lines"}`),
            });
        }
        for (let index = 0; index < shown.length; index++) {
            const isLast = index === shown.length - 1;
            rows.push({
                prefix: theme.fg("dim", isLast ? "   └ " : "   │ "),
                continuation: isLast ? "     " : theme.fg("dim", "   │ "),
                content: theme.fg("toolOutput", shown[index] || " "),
            });
        }
        return transcriptRuntime.block(rows);
    };
    transcriptRuntime.completeStatus = (context: any): boolean => {
        const failed = transcriptRuntime.isError(context);
        transcriptRuntime.setStatus(context, failed ? "error" : "success");
        return failed;
    };
}
