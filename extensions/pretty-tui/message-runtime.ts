import { installMarkdown } from "./markdown.js";
import { installMouseInput } from "./mouse-input.js";
import { installInteractiveMode } from "./interactive-mode.js";
import { installAssistantMessages } from "./assistant-messages.js";
import { installCustomMessages } from "./custom-messages.js";
import { installUserMessages } from "./user-messages.js";
import { installEditorFrame } from "./editor-frame.js";
import { isNativeImageRow } from "./ansi-style.js";
import { frameNativeRows, nativeFrameWidth } from "./full-frame.js";
import { CompactionSummaryMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { type ActivityGroup, type ActivityMember, type ActivitySeverity } from "./activity-timeline.js";
import type { TranscriptRuntime } from "./runtime-types.js";
export function installMessageRuntime(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    pi.on("session_shutdown", transcriptRuntime.stopWorkingElapsedTimer);
    installEditorFrame(pi, {
        setEditor(editor) {
            transcriptRuntime.currentPromptEditor = editor;
            if (editor?.tui)
                transcriptRuntime.currentTui = editor.tui;
        },
        get startedAt() { return transcriptRuntime.responseRunStartedAt; },
        get sideBorders() { return transcriptRuntime.sideBordersEnabled; },
        duration: transcriptRuntime.formatResponseDuration,
    });
    // Clean uses content-sized bubbles; compact/full share full-width panels.
    // Keep Pi's Markdown, mouse handling and OSC 133 zones in every mode.
    installUserMessages(pi, transcriptRuntime);
    transcriptRuntime.customMessageKey = (message: any): string => {
        if (message?.timestamp !== undefined) {
            const parsed = typeof message.timestamp === "string"
                ? Date.parse(message.timestamp)
                : Number(message.timestamp);
            return Number.isFinite(parsed) ? String(parsed) : String(message.timestamp);
        }
        return `${message?.customType ?? "custom"}:${JSON.stringify(message?.content ?? "")}`;
    };
    transcriptRuntime.customMessageText = (message: any): string => typeof message?.content === "string"
        ? message.content
        : Array.isArray(message?.content)
            ? message.content
                .filter((item: any) => item?.type === "text" && typeof item.text === "string")
                .map((item: any) => item.text)
                .join("\n")
            : "";
    transcriptRuntime.hasWorkActivity = (group: ActivityGroup | undefined): boolean => transcriptRuntime.activityTimeline.hasWork(group);
    transcriptRuntime.addPersistentActivityUpdate = (message: any): ActivityMember => {
        const key = transcriptRuntime.customMessageKey(message);
        const title = transcriptRuntime.humanizeCustomType(message?.customType ?? "update");
        const content = transcriptRuntime.customMessageText(message);
        const existingGroup = transcriptRuntime.activityTimeline.currentGroup();
        const joinsWork = transcriptRuntime.hasWorkActivity(existingGroup);
        const member = joinsWork
            ? transcriptRuntime.activityTimeline.addUpdate(key, title, content, true, "info") ??
                transcriptRuntime.activityTimeline.addPendingUpdate(key, title, content, true, "info")
            : transcriptRuntime.activityTimeline.addPendingUpdate(key, title, content, true, "info");
        // A displayed custom message without current model/tool work is an
        // independent durable update, never a pending member of the next run.
        if (!transcriptRuntime.hasWorkActivity(existingGroup))
            transcriptRuntime.activityTimeline.boundary();
        return member;
    };
    transcriptRuntime.nativeCustomBoundaryKeys = new Set<string>();
    transcriptRuntime.closeCleanAtNativeCustomBoundary = () => transcriptRuntime.activityTimeline.boundary();
    transcriptRuntime.closeCleanAtStandaloneAlert = () => transcriptRuntime.activityTimeline.boundary();
    installCustomMessages(pi, transcriptRuntime);
    transcriptRuntime.compactionPrototype = CompactionSummaryMessageComponent.prototype as any;
    transcriptRuntime.compactionPatchKey = Symbol.for("pretty-tui.compaction-panel");
    if (!transcriptRuntime.compactionPrototype[transcriptRuntime.compactionPatchKey]) {
        const originalRender = transcriptRuntime.compactionPrototype.render;
        const originalHandleMouse = transcriptRuntime.compactionPrototype.handleMouse;
        const views = new WeakMap<object, {
            width: number;
            sourceOffset: number;
            frame: ReturnType<typeof frameNativeRows>;
        }>();
        const render = function (this: any, width: number): string[] {
            if (transcriptRuntime.renderMode === "clean") {
                views.delete(this);
                transcriptRuntime.mouseClickHitTests.delete(this);
                return originalRender.call(this, width);
            }
            const innerWidth = nativeFrameWidth(width);
            const region = this.children[0];
            // Native content begins with its [compaction] label and a spacer. The
            // panel title replaces those two rows; the summary itself is untouched.
            const content = region.child.children;
            const sourceOffset = content.slice(0, 2).reduce((height: number, child: any) => height + child.render(innerWidth).length, 0);
            const source = content.slice(2).flatMap((child: any) => child.render(innerWidth));
            const theme = transcriptRuntime.defaultActivityTheme();
            const frame = frameNativeRows(`compaction ${this.expanded ? "▾" : "▸"}`, source, width, theme, undefined, this, "customMessageLabel", "", "customMessageLabel", "customMessageBg");
            views.set(this, { width: innerWidth, sourceOffset, frame });
            transcriptRuntime.mouseClickHitTests.set(this, (event) => event.y === 0 || frame.sourceRows.has(event.y));
            return frame.lines.map((line) => isNativeImageRow(line) ? line : truncateToWidth(line, Math.max(1, width), ""));
        };
        const handleMouse = function (this: any, event: any) {
            if (transcriptRuntime.renderMode === "clean")
                return originalHandleMouse?.call(this, event);
            render.call(this, event.width);
            const view = views.get(this);
            if (!view)
                return undefined;
            if (event.y === 0 && event.type === "click" && event.button === "left") {
                this.setExpanded(!this.expanded);
                transcriptRuntime.currentTui?.requestRender?.();
                return { handled: true };
            }
            const sourceY = view.frame.sourceRows.get(event.y);
            if (sourceY === undefined)
                return undefined;
            const result = this.children[0].handleMouse?.({ ...event,
                x: Math.max(0, event.x - view.frame.inset), y: sourceY + view.sourceOffset,
                width: view.width, height: view.frame.sourceRows.size + view.sourceOffset,
            });
            if (result?.handled)
                transcriptRuntime.currentTui?.requestRender?.();
            return result;
        };
        transcriptRuntime.compactionPrototype[transcriptRuntime.compactionPatchKey] = { originalRender, originalHandleMouse };
        transcriptRuntime.compactionPrototype.render = render;
        transcriptRuntime.compactionPrototype.handleMouse = handleMouse;
        pi.on("session_shutdown", () => {
            if (transcriptRuntime.compactionPrototype.render === render)
                transcriptRuntime.compactionPrototype.render = originalRender;
            if (transcriptRuntime.compactionPrototype.handleMouse === handleMouse)
                transcriptRuntime.compactionPrototype.handleMouse = originalHandleMouse;
            if (transcriptRuntime.compactionPrototype.render === originalRender && transcriptRuntime.compactionPrototype.handleMouse === originalHandleMouse) {
                delete transcriptRuntime.compactionPrototype[transcriptRuntime.compactionPatchKey];
            }
        });
    }
    // Thinking and tools are peers in the transcript-first activity timeline.
    // Assistant components keep Pi's native visible-answer Markdown renderer.
    // All modes share thought content; only clean adds activity-group framing.
    installAssistantMessages(pi, transcriptRuntime);
    transcriptRuntime.orderContextEntriesForTranscript = (entries: any[]): any[] => {
        if (!Array.isArray(entries) || entries[0]?.type !== "compaction")
            return entries;
        const [compaction, ...contextEntries] = entries;
        const parentIndex = contextEntries.findIndex((entry: any) => entry?.id === compaction.parentId);
        const compactionTime = Date.parse(compaction.timestamp ?? "");
        const firstNewerIndex = Number.isFinite(compactionTime)
            ? contextEntries.findIndex((entry: any) => {
                const entryTime = Date.parse(entry?.timestamp ?? "");
                return Number.isFinite(entryTime) && entryTime >= compactionTime;
            })
            : -1;
        const insertionIndex = parentIndex >= 0
            ? parentIndex + 1
            : firstNewerIndex >= 0
                ? firstNewerIndex
                : contextEntries.length;
        return [
            ...contextEntries.slice(0, insertionIndex),
            compaction,
            ...contextEntries.slice(insertionIndex),
        ];
    };
    transcriptRuntime.appendRuntimeActivityUpdate = (mode: any, message: string, severity: ActivitySeverity): boolean => {
        const [firstLine, ...remainingLines] = String(message).split("\n");
        const fallbackTitle = severity === "warning"
            ? "Warning"
            : severity === "error"
                ? "Error"
                : "Info";
        const title = firstLine || fallbackTitle;
        const content = remainingLines.join("\n");
        // Warnings and errors are standalone hard boundaries; only ordinary notices
        // join the work in progress.
        const standalone = severity === "warning" || severity === "error";
        const updateKey = `runtime:${severity}:${++transcriptRuntime.activityUpdateSequence}`;
        if (standalone)
            transcriptRuntime.closeCleanAtStandaloneAlert();
        const existingGroup = transcriptRuntime.activityTimeline.currentGroup();
        const joinsWork = !standalone && transcriptRuntime.hasWorkActivity(existingGroup);
        const member = joinsWork
            ? transcriptRuntime.activityTimeline.addUpdate(updateKey, title, content, false, severity) ??
                transcriptRuntime.activityTimeline.addPendingUpdate(updateKey, title, content, false, severity)
            : transcriptRuntime.activityTimeline.addPendingUpdate(updateKey, title, content, false, severity);
        if (!joinsWork)
            transcriptRuntime.activityTimeline.boundary();
        const group = transcriptRuntime.activityTimeline.groupForMember(member.id);
        if (!group || !mode.chatContainer?.addChild)
            return false;
        const component: Component = {
            render: (width: number) => transcriptRuntime.renderActivityUpdateProjection(group, member, width, component),
            invalidate() { },
            handleMouse: (event: any) => transcriptRuntime.handleActivityUpdateMouse(group, member, event),
        } as Component;
        if (severity === "error")
            transcriptRuntime.runtimeErrorDescriptors.set(component, {
                source: "runtime:error", title, content,
            });
        transcriptRuntime.errorChatContainer = mode.chatContainer;
        transcriptRuntime.activityUpdateComponents.set(member.id, component);
        mode.chatContainer.addChild(component);
        mode.ui?.requestRender?.();
        return true;
    };
    installInteractiveMode(pi, transcriptRuntime);
    installMouseInput(pi, transcriptRuntime);
    // Refine Pi's Markdown presentation while preserving its parser and themes.
    installMarkdown(pi, transcriptRuntime);
    transcriptRuntime.textContent = (result: any): string => result.content
        ?.filter((item: any) => item.type === "text")
        .map((item: any) => item.text)
        .join("\n") ?? "";
    transcriptRuntime.nonEmptyLines = (value: string): number => value ? value.split("\n").filter((line) => line.length > 0).length : 0;
    transcriptRuntime.readLineRange = (offset: unknown, limit: unknown): string => {
        if (offset == null && limit == null)
            return "";
        const parse = (value: unknown): number | undefined => {
            if (typeof value === "string" && value.trim() !== "")
                value = Number(value);
            return typeof value === "number" && Number.isFinite(value) ? value : undefined;
        };
        const start = offset == null ? 1 : parse(offset);
        if (start === undefined)
            return "";
        if (limit == null)
            return ` · lines ${start}+`;
        const count = parse(limit);
        if (count === undefined)
            return "";
        return ` · lines ${start}–${start + count - 1}`;
    };
}
