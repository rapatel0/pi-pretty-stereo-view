import { createBashTool, createBashToolDefinition, createEditTool, createEditToolDefinition, createFindTool, createFindToolDefinition, createGrepTool, createGrepToolDefinition, createLsTool, createLsToolDefinition, createReadTool, createReadToolDefinition, createWriteTool, createWriteToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TranscriptRuntime } from "./runtime-types.js";
import { Text } from "@earendil-works/pi-tui";
export function installBuiltinTools(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.nativeDefinitions = {
        read: createReadToolDefinition(transcriptRuntime.cwd), bash: createBashToolDefinition(transcriptRuntime.cwd),
        edit: createEditToolDefinition(transcriptRuntime.cwd), write: createWriteToolDefinition(transcriptRuntime.cwd),
        grep: createGrepToolDefinition(transcriptRuntime.cwd), find: createFindToolDefinition(transcriptRuntime.cwd), ls: createLsToolDefinition(transcriptRuntime.cwd),
    };
    transcriptRuntime.registerStyledTool = (definition: any) => {
        const native = transcriptRuntime.nativeDefinitions[definition.name];
        const select = (kind: "renderCall" | "renderResult", args: any[]) => {
            const context = args.at(-1);
            const useNative = transcriptRuntime.renderMode === "full" || transcriptRuntime.renderMode === "compact" && context.expanded;
            const namespace = useNative ? "nativeFull" : "pretty";
            const state = context.state[namespace] ??= { state: {} };
            const scoped = { ...context, state: state.state, lastComponent: state[kind] };
            const renderer = useNative ? native[kind] : definition[kind];
            const rendererArgs = args.slice(0, -1);
            let omitted = 0;
            if (useNative && definition.name === "write" && kind === "renderCall" && !context.expanded && typeof rendererArgs[0]?.content === "string") {
                const lines = rendererArgs[0].content.split("\n");
                while (lines.length && lines.at(-1) === "") lines.pop();
                omitted = Math.max(0, lines.length - 10);
                if (omitted) rendererArgs[0] = { ...rendererArgs[0], content: lines.slice(-10).join("\n") };
            }
            const component = renderer?.(...rendererArgs, scoped);
            state[kind] = component;
            if (omitted && component) {
                const notice = new Text(args[1].fg("muted", `… ${omitted} earlier ${omitted === 1 ? "line" : "lines"}`), 0, 0);
                return {
                    render(width: number) {
                        const lines = component.render(width);
                        return [lines[0] ?? "", ...notice.render(width), ...lines.slice(1)];
                    },
                    invalidate() { component.invalidate?.(); notice.invalidate(); },
                };
            }
            return component;
        };
        pi.registerTool({ ...definition,
            renderCall: (...args: any[]) => select("renderCall", args),
            renderResult: (...args: any[]) => select("renderResult", args),
        });
    };
    transcriptRuntime.read = createReadTool(transcriptRuntime.cwd);
    transcriptRuntime.readLabel = transcriptRuntime.read.label || transcriptRuntime.read.name;
    transcriptRuntime.registerStyledTool({
        ...transcriptRuntime.read,
        renderShell: "self",
        renderCall(args: any, theme: any, context: any) {
            if (transcriptRuntime.hideCleanTool(context.toolCallId, context.expanded, context.executionStarted))
                return transcriptRuntime.cleanToolCall(theme, transcriptRuntime.readLabel, context.toolCallId);
            const range = transcriptRuntime.readLineRange(args.offset, args.limit);
            return transcriptRuntime.call(theme, transcriptRuntime.readLabel, `${args.path}${range}`, context.state);
        },
        renderResult(toolResult: any, options: any, theme: any, context: any) {
            const output = transcriptRuntime.textContent(toolResult);
            if (transcriptRuntime.hideCleanTool(context.toolCallId, options.expanded, context.executionStarted))
                return transcriptRuntime.hiddenToolResult(context, options, output);
            if (options.isPartial)
                return transcriptRuntime.partialResult(context, theme, "Reading…");
            const image = toolResult.content?.find((item: any) => item.type === "image");
            const failed = transcriptRuntime.completeStatus(context);
            if (image)
                return transcriptRuntime.result(theme, "Read image", "", false, failed);
            const lines = transcriptRuntime.nonEmptyLines(output);
            const truncated = toolResult.details?.truncation?.truncated ? " · truncated" : "";
            return transcriptRuntime.result(theme, failed ? (output.split("\n")[0] || "Read failed") : `Read ${lines} ${lines === 1 ? "line" : "lines"}${truncated}`, output, options.expanded, failed);
        },
    } as any);
    transcriptRuntime.bash = createBashTool(transcriptRuntime.cwd);
    transcriptRuntime.bashLabel = transcriptRuntime.bash.label || transcriptRuntime.bash.name;
    transcriptRuntime.registerStyledTool({
        ...transcriptRuntime.bash,
        renderShell: "self",
        renderCall(args: any, theme: any, context: any) {
            if (transcriptRuntime.hideCleanTool(context.toolCallId, context.expanded, context.executionStarted))
                return transcriptRuntime.cleanToolCall(theme, transcriptRuntime.bashLabel, context.toolCallId);
            const command = typeof args.command === "string" ? args.command : "";
            if (transcriptRuntime.useCompactToolView(context.toolCallId, context.expanded)) {
                const commandLines = command.split(/\r\n|\r|\n/);
                const firstLine = commandLines[0] ?? "";
                const omitted = commandLines.length - 1;
                const detail = omitted > 0
                    ? `${firstLine} … (${omitted} more ${omitted === 1 ? "line" : "lines"})`
                    : firstLine;
                return transcriptRuntime.call(theme, transcriptRuntime.bashLabel, detail, context.state);
            }
            return transcriptRuntime.call(theme, transcriptRuntime.bashLabel, command, context.state);
        },
        renderResult(toolResult: any, options: any, theme: any, context: any) {
            const output = transcriptRuntime.textContent(toolResult);
            if (transcriptRuntime.hideCleanTool(context.toolCallId, options.expanded, context.executionStarted))
                return transcriptRuntime.hiddenToolResult(context, options, output);
            if (transcriptRuntime.useCompactToolView(context.toolCallId, options.expanded)) {
                if (options.isPartial)
                    return transcriptRuntime.partialResult(context, theme, "Running…");
                const failed = transcriptRuntime.completeStatus(context);
                return transcriptRuntime.result(theme, failed ? "Command failed" : "Done", "", false, failed);
            }
            if (options.isPartial) {
                return transcriptRuntime.bashResult(context, theme, "Running…", output, options.expanded, "running");
            }
            const failed = transcriptRuntime.isError(context);
            const outputLines = transcriptRuntime.terminalOutputLines(output);
            const lineCount = outputLines.filter((line) => line.length > 0).length;
            const summary = failed
                ? outputLines[0] || "Command failed"
                : outputLines.length > 0
                    ? `Done · ${lineCount} output ${lineCount === 1 ? "line" : "lines"}`
                    : "Done";
            return transcriptRuntime.bashResult(context, theme, summary, output, options.expanded, failed ? "error" : "success");
        },
    } as any);
    transcriptRuntime.edit = createEditTool(transcriptRuntime.cwd);
    transcriptRuntime.editLabel = transcriptRuntime.edit.label || transcriptRuntime.edit.name;
    transcriptRuntime.registerStyledTool({
        ...transcriptRuntime.edit,
        renderShell: "self",
        renderCall(args: any, theme: any, context: any) {
            if (transcriptRuntime.hideCleanTool(context.toolCallId, context.expanded, context.executionStarted))
                return transcriptRuntime.cleanToolCall(theme, transcriptRuntime.editLabel, context.toolCallId);
            const count = Array.isArray(args.edits) ? ` · ${args.edits.length} changes` : "";
            return transcriptRuntime.call(theme, transcriptRuntime.editLabel, `${args.path}${count}`, context.state);
        },
        renderResult(toolResult: any, options: any, theme: any, context: any) {
            const output = transcriptRuntime.textContent(toolResult);
            if (transcriptRuntime.hideCleanTool(context.toolCallId, options.expanded, context.executionStarted))
                return transcriptRuntime.hiddenToolResult(context, options, output);
            if (options.isPartial)
                return transcriptRuntime.partialResult(context, theme, "Editing…");
            const failed = transcriptRuntime.completeStatus(context);
            const diff = toolResult.details?.diff ?? "";
            const additions = diff.split("\n").filter((line: string) => line.startsWith("+") && !line.startsWith("+++")).length;
            const removals = diff.split("\n").filter((line: string) => line.startsWith("-") && !line.startsWith("---")).length;
            const summary = failed
                ? output.split("\n")[0] || "Edit failed"
                : diff
                    ? theme.fg("toolOutput", "Updated · ") +
                        theme.fg("success", `+${additions}`) +
                        theme.fg("toolOutput", " ") +
                        theme.fg("error", `-${removals}`)
                    : "Updated";
            return transcriptRuntime.result(theme, summary, diff || output, options.expanded, failed, !failed && Boolean(diff), (line) => {
                if (line.startsWith("+") && !line.startsWith("+++"))
                    return theme.fg("toolDiffAdded", line);
                if (line.startsWith("-") && !line.startsWith("---"))
                    return theme.fg("toolDiffRemoved", line);
                return theme.fg("toolDiffContext", line);
            }, !failed && diff ? transcriptRuntime.editDiffLayout(theme, diff) : undefined);
        },
    } as any);
    transcriptRuntime.write = createWriteTool(transcriptRuntime.cwd);
    transcriptRuntime.writeLabel = transcriptRuntime.write.label || transcriptRuntime.write.name;
    transcriptRuntime.registerStyledTool({
        ...transcriptRuntime.write,
        renderShell: "self",
        renderCall(args: any, theme: any, context: any) {
            if (transcriptRuntime.hideCleanTool(context.toolCallId, context.expanded, context.executionStarted))
                return transcriptRuntime.cleanToolCall(theme, transcriptRuntime.writeLabel, context.toolCallId);
            const content = typeof args.content === "string" ? args.content : "";
            const path = String(args.path ?? "");
            if (transcriptRuntime.useCompactToolView(context.toolCallId, context.expanded)) {
                const lines = content.replace(/\t/g, "    ").split("\n");
                while (lines.length > 0 && lines[lines.length - 1] === "")
                    lines.pop();
                const total = lines.length;
                return transcriptRuntime.call(theme, transcriptRuntime.writeLabel, `${path} · ${total} ${total === 1 ? "line" : "lines"}`, context.state);
            }
            return transcriptRuntime.writeCall(theme, transcriptRuntime.writeLabel, path, content, context.expanded, context.state);
        },
        renderResult(toolResult: any, options: any, theme: any, context: any) {
            const output = transcriptRuntime.textContent(toolResult);
            if (transcriptRuntime.hideCleanTool(context.toolCallId, options.expanded, context.executionStarted))
                return transcriptRuntime.hiddenToolResult(context, options, output);
            if (options.isPartial)
                return transcriptRuntime.partialResult(context, theme, "Writing…");
            const failed = transcriptRuntime.completeStatus(context);
            return transcriptRuntime.result(theme, failed ? output.split("\n")[0] || "Write failed" : "Written", output, options.expanded, failed);
        },
    } as any);
    transcriptRuntime.grep = createGrepTool(transcriptRuntime.cwd);
    transcriptRuntime.grepLabel = transcriptRuntime.grep.label || transcriptRuntime.grep.name;
    transcriptRuntime.registerStyledTool({
        ...transcriptRuntime.grep,
        renderShell: "self",
        renderCall(args: any, theme: any, context: any) {
            if (transcriptRuntime.hideCleanTool(context.toolCallId, context.expanded, context.executionStarted))
                return transcriptRuntime.cleanToolCall(theme, transcriptRuntime.grepLabel, context.toolCallId);
            const where = args.path ? ` · ${args.path}` : "";
            const glob = args.glob ? ` · ${args.glob}` : "";
            return transcriptRuntime.call(theme, transcriptRuntime.grepLabel, `${args.pattern}${where}${glob}`, context.state);
        },
        renderResult(toolResult: any, options: any, theme: any, context: any) {
            const output = transcriptRuntime.textContent(toolResult);
            if (transcriptRuntime.hideCleanTool(context.toolCallId, options.expanded, context.executionStarted))
                return transcriptRuntime.hiddenToolResult(context, options, output);
            if (options.isPartial)
                return transcriptRuntime.partialResult(context, theme, "Searching…");
            const failed = transcriptRuntime.completeStatus(context);
            const matches = transcriptRuntime.nonEmptyLines(output);
            return transcriptRuntime.result(theme, failed ? output.split("\n")[0] : `Found ${matches} matches`, output, options.expanded, failed);
        },
    } as any);
    transcriptRuntime.find = createFindTool(transcriptRuntime.cwd);
    transcriptRuntime.findLabel = transcriptRuntime.find.label || transcriptRuntime.find.name;
    transcriptRuntime.registerStyledTool({
        ...transcriptRuntime.find,
        renderShell: "self",
        renderCall(args: any, theme: any, context: any) {
            if (transcriptRuntime.hideCleanTool(context.toolCallId, context.expanded, context.executionStarted))
                return transcriptRuntime.cleanToolCall(theme, transcriptRuntime.findLabel, context.toolCallId);
            return transcriptRuntime.call(theme, transcriptRuntime.findLabel, `${args.pattern}${args.path ? ` · ${args.path}` : ""}`, context.state);
        },
        renderResult(toolResult: any, options: any, theme: any, context: any) {
            const output = transcriptRuntime.textContent(toolResult);
            if (transcriptRuntime.hideCleanTool(context.toolCallId, options.expanded, context.executionStarted))
                return transcriptRuntime.hiddenToolResult(context, options, output);
            if (options.isPartial)
                return transcriptRuntime.partialResult(context, theme, "Searching…");
            const failed = transcriptRuntime.completeStatus(context);
            const matches = transcriptRuntime.nonEmptyLines(output);
            return transcriptRuntime.result(theme, failed ? output.split("\n")[0] : `Found ${matches} paths`, output, options.expanded, failed);
        },
    } as any);
    transcriptRuntime.ls = createLsTool(transcriptRuntime.cwd);
    transcriptRuntime.lsLabel = transcriptRuntime.ls.label || transcriptRuntime.ls.name;
    transcriptRuntime.registerStyledTool({
        ...transcriptRuntime.ls,
        renderShell: "self",
        renderCall(args: any, theme: any, context: any) {
            if (transcriptRuntime.hideCleanTool(context.toolCallId, context.expanded, context.executionStarted))
                return transcriptRuntime.cleanToolCall(theme, transcriptRuntime.lsLabel, context.toolCallId);
            return transcriptRuntime.call(theme, transcriptRuntime.lsLabel, args.path ?? ".", context.state);
        },
        renderResult(toolResult: any, options: any, theme: any, context: any) {
            const output = transcriptRuntime.textContent(toolResult);
            if (transcriptRuntime.hideCleanTool(context.toolCallId, options.expanded, context.executionStarted))
                return transcriptRuntime.hiddenToolResult(context, options, output);
            if (options.isPartial)
                return transcriptRuntime.partialResult(context, theme, "Listing…");
            const failed = transcriptRuntime.completeStatus(context);
            const entries = transcriptRuntime.nonEmptyLines(output);
            return transcriptRuntime.result(theme, failed ? output.split("\n")[0] : `Listed ${entries} entries`, output, options.expanded, failed);
        },
    } as any);
}
