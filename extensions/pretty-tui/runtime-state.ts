import { PRETTY_DEFAULTS } from "../integrated/defaults.js";
import { uiScheduler } from "../shared/scheduler.js";
import { setSideBorders } from "./full-frame.js";
import { NestedTools } from "./nested-tools.js";
import { AssistantMessageComponent, copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, truncateToWidth } from "@earendil-works/pi-tui";
import { readSection } from "../integrated/settings-store.js";
import { ActivityTimeline } from "./activity-timeline.js";
const TRANSIENT_UI_STATUS_MS = 10000;
import type { TranscriptRuntime, LatestActivityStatus } from "./runtime-types.js";
export function initializeTranscriptState(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.cwd = process.cwd();
    transcriptRuntime.config = readSection("prettyTui");
    transcriptRuntime.activeForSession = typeof transcriptRuntime.config.enabled === "boolean" ? transcriptRuntime.config.enabled : PRETTY_DEFAULTS.enabled;
    transcriptRuntime.sideBordersEnabled = typeof transcriptRuntime.config.sideBorders === "boolean" ? transcriptRuntime.config.sideBorders : PRETTY_DEFAULTS.sideBorders;
    setSideBorders(transcriptRuntime.sideBordersEnabled);
    transcriptRuntime.configuredMode = transcriptRuntime.config.mode ?? transcriptRuntime.config.bash?.mode;
    transcriptRuntime.renderMode = transcriptRuntime.configuredMode === "full" || transcriptRuntime.configuredMode === "compact" || transcriptRuntime.configuredMode === "clean"
        ? transcriptRuntime.configuredMode : PRETTY_DEFAULTS.mode;
    transcriptRuntime.cleanToolsExpanded = false;
    transcriptRuntime.fullThinkingHidden = false;
    transcriptRuntime.compactThinkingHidden = true;
    transcriptRuntime.cleanContextCompacted = false;
    transcriptRuntime.fullscreenTui = false;
    transcriptRuntime.mouseClickHitTests = new WeakMap<object, (event: any) => boolean>();
    transcriptRuntime.currentTui = undefined;
    transcriptRuntime.currentPromptEditor = undefined;
    transcriptRuntime.errorChatContainer = undefined;
    transcriptRuntime.runtimeErrorDescriptors = new WeakMap<object, {
        source: string;
        title: string;
        content: string;
    }>();
    transcriptRuntime.errorDescriptor = (component: any) => {
        const runtime = transcriptRuntime.runtimeErrorDescriptors.get(component);
        if (runtime)
            return runtime;
        if (!(component instanceof AssistantMessageComponent))
            return undefined;
        const message = (component as any).lastMessage;
        if (message?.stopReason !== "error" || (message.content ?? []).some((item: any) => item.type === "toolCall" || item.type === "thinking" || item.type === "text" && item.text?.length))
            return undefined;
        return { source: "assistant:error", title: "Error", content: String(message.errorMessage ?? "") };
    };
    transcriptRuntime.errorRun = (component: any) => {
        const children: any[] = transcriptRuntime.errorChatContainer?.children ?? [];
        const index = children.indexOf(component);
        const descriptor = transcriptRuntime.errorDescriptor(component);
        const same = (other: any) => {
            const value = transcriptRuntime.errorDescriptor(other);
            return descriptor && value && value.source === descriptor.source &&
                value.title === descriptor.title && value.content === descriptor.content;
        };
        if (index < 0 || !descriptor)
            return { hidden: false, count: 1, compact: false };
        let count = 1;
        while (index + count < children.length && same(children[index + count]))
            count++;
        return { hidden: index > 0 && Boolean(same(children[index - 1])), count,
            compact: index > 0 && Boolean(transcriptRuntime.errorDescriptor(children[index - 1])) };
    };
    transcriptRuntime.runningColor = (theme: any, text: string): string => typeof transcriptRuntime.currentPromptEditor?.borderColor === "function"
        ? transcriptRuntime.currentPromptEditor.borderColor(text)
        : theme.fg("border", text);
    transcriptRuntime.currentExtensionUi = undefined;
    transcriptRuntime.changingAllToolsExpansion = false;
    transcriptRuntime.latestActivityWidgetKey = "pretty-tui-latest-activity";
    transcriptRuntime.latestActivityStatus = undefined;
    transcriptRuntime.latestActivityWidgetInstalled = false;
    transcriptRuntime.latestActivityStatusTimer = undefined;
    transcriptRuntime.latestActivityStatusGeneration = 0;
    transcriptRuntime.renderLatestActivityStatus = (status: LatestActivityStatus, width: number, theme: any): string => {
        const severity = status.severity ?? "status";
        const icon = severity === "error" ? "✕" : severity === "success" ? "✓" : "◇";
        const color = severity === "error"
            ? "error"
            : severity === "success"
                ? "success"
                : "dim";
        const detail = status.detail?.trim() ? ` — ${status.detail.trim()}` : "";
        return truncateToWidth(` ${theme.fg(color, `${icon} ${status.title}`)}${theme.fg("dim", detail)}`, Math.max(1, width), "…");
    };
    transcriptRuntime.refreshLatestActivityWidget = () => {
        if (!transcriptRuntime.currentExtensionUi?.setWidget)
            return;
        if (!transcriptRuntime.latestActivityStatus) {
            if (transcriptRuntime.latestActivityWidgetInstalled) {
                transcriptRuntime.currentExtensionUi.setWidget(transcriptRuntime.latestActivityWidgetKey, undefined);
                transcriptRuntime.latestActivityWidgetInstalled = false;
            }
            return;
        }
        if (transcriptRuntime.latestActivityWidgetInstalled) {
            transcriptRuntime.currentTui?.requestRender?.();
            return;
        }
        transcriptRuntime.currentExtensionUi.setWidget(transcriptRuntime.latestActivityWidgetKey, (_tui: any, theme: any) => ({
            render: (width: number) => transcriptRuntime.latestActivityStatus ? [transcriptRuntime.renderLatestActivityStatus(transcriptRuntime.latestActivityStatus, width, theme)]
                : [],
            invalidate() { },
        }), { placement: "aboveEditor" });
        transcriptRuntime.latestActivityWidgetInstalled = true;
    };
    transcriptRuntime.clearLatestActivityStatus = () => {
        transcriptRuntime.latestActivityStatusGeneration++;
        if (transcriptRuntime.latestActivityStatusTimer)
            transcriptRuntime.latestActivityStatusTimer();
        transcriptRuntime.latestActivityStatusTimer = undefined;
        transcriptRuntime.latestActivityStatus = undefined;
        if (transcriptRuntime.latestActivityWidgetInstalled) {
            transcriptRuntime.currentExtensionUi?.setWidget?.(transcriptRuntime.latestActivityWidgetKey, undefined);
            transcriptRuntime.latestActivityWidgetInstalled = false;
        }
    };
    transcriptRuntime.setLatestActivityStatus = (status: LatestActivityStatus) => {
        const generation = ++transcriptRuntime.latestActivityStatusGeneration;
        if (transcriptRuntime.latestActivityStatusTimer)
            transcriptRuntime.latestActivityStatusTimer();
        transcriptRuntime.latestActivityStatus = status;
        transcriptRuntime.refreshLatestActivityWidget();
        transcriptRuntime.latestActivityStatusTimer = uiScheduler.once(() => {
            if (generation !== transcriptRuntime.latestActivityStatusGeneration)
                return;
            transcriptRuntime.clearLatestActivityStatus();
            transcriptRuntime.currentTui?.requestRender?.();
        }, TRANSIENT_UI_STATUS_MS);
    };
    transcriptRuntime.copyTranscriptText = (text: string) => {
        // Code-block copy must preserve leading/trailing whitespace and indentation.
        // Answers are normalized separately by assistantAnswerText().
        if (!text.trim())
            return;
        const copyText = text;
        if (typeof transcriptRuntime.currentTui?.copyTextToClipboard === "function") {
            // Fullscreen uses Pi's native clipboard path and native flash feedback.
            void Promise.resolve(transcriptRuntime.currentTui.copyTextToClipboard(copyText)).catch(() => {
                transcriptRuntime.currentTui?.flash?.("Copy failed");
            });
            return;
        }
        void copyToClipboard(copyText)
            .then(() => transcriptRuntime.setLatestActivityStatus({ title: "Copied!", severity: "success" }))
            .catch(() => transcriptRuntime.setLatestActivityStatus({ title: "Copy failed", severity: "error" }));
    };
    transcriptRuntime.responseAnswerTexts = new Map<string, string>();
    transcriptRuntime.responseRunStartedAt = undefined;
    transcriptRuntime.RUNNING_DOT_INTERVAL_MS = 800;
    transcriptRuntime.workingElapsedTimer = undefined;
    transcriptRuntime.stopWorkingElapsedTimer = () => {
        if (transcriptRuntime.workingElapsedTimer)
            transcriptRuntime.workingElapsedTimer();
        transcriptRuntime.workingElapsedTimer = undefined;
    };
    transcriptRuntime.startWorkingElapsedTimer = () => {
        if (transcriptRuntime.workingElapsedTimer)
            return;
        // Share one redraw clock between the elapsed label and Running-dot pulse.
        transcriptRuntime.workingElapsedTimer = uiScheduler.repeat(() => transcriptRuntime.currentTui?.requestRender?.(), transcriptRuntime.RUNNING_DOT_INTERVAL_MS);
    };
    transcriptRuntime.responseHasAssistantMessage = false;
    transcriptRuntime.assistantAnswerText = (message: any): string => {
        if (typeof message?.content === "string")
            return message.content.trim();
        if (!Array.isArray(message?.content))
            return "";
        return message.content
            .filter((item: any) => item?.type === "text" && typeof item.text === "string" && item.text.trim())
            .map((item: any) => item.text.trim())
            .join("\n\n")
            .trim();
    };
    transcriptRuntime.formatResponseDuration = (durationMs: number): string => {
        const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
        if (totalSeconds < 60)
            return `${totalSeconds}s`;
        const totalMinutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (totalMinutes < 60)
            return `${totalMinutes}m ${seconds}s`;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    };
    transcriptRuntime.activityTimeline = new ActivityTimeline();
    transcriptRuntime.nestedTools = new NestedTools();
    transcriptRuntime.refreshNestedTools = (id: string) => {
        const owner = transcriptRuntime.toolComponents.get(transcriptRuntime.nestedTools.root(id));
        owner?.updateDisplay?.();
        owner?.ui?.requestRender?.();
        transcriptRuntime.currentTui?.requestRender?.();
    };
    transcriptRuntime.revealedActivityGroups = new Set<string>();
    transcriptRuntime.collapsedActivityGroups = new Set<string>();
    transcriptRuntime.expandedThinkingMembers = new Set<string>();
    transcriptRuntime.thinkingComponents = new Map<string, any>();
    transcriptRuntime.activityFallbackThemes = new Map<string, any>();
    transcriptRuntime.activityUpdateComponents = new Map<string, Component>();
    transcriptRuntime.activityUpdateMarkdownComponents = new Map<string, {
        content: string;
        theme: any;
        component: Markdown;
    }>();
    transcriptRuntime.activityUpdateSequence = 0;
    transcriptRuntime.flushDeferredCacheNotices = undefined;
    transcriptRuntime.assistantBoundaryKeys = new Set<string>();
    transcriptRuntime.cleanCompactToolCallIds = new Set<string>();
    transcriptRuntime.cleanGroupToolCallIds = new Map<string, string[]>();
    transcriptRuntime.cleanToolCallGroupOwners = new Map<string, string>();
    transcriptRuntime.toolComponents = new Map<string, any>();
    transcriptRuntime.cleanToolThemes = new Map<string, any>();
    transcriptRuntime.cleanToolNames = new Map<string, string>();
    transcriptRuntime._renderCleanGroupSummary = (_lastToolCallId: string, _width: number): string[] => [];
    // Dead in upstream pi-pretty-tui (assigned, never invoked); kept for parity.
    void transcriptRuntime._renderCleanGroupSummary;
}
