import { uiScheduler } from "../shared/scheduler.js";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
const CLEAN_TOOL_ACTIVITY_MIN_MS = 1000;
import type { TranscriptRuntime, DisplayValue, ToolActivityHold } from "./runtime-types.js";
export function initializeToolActivity(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.settledSummaries = new Map<string, {
        count: number;
        failed: number;
        thoughtCount: number;
        activity: DisplayValue;
    }>();
    transcriptRuntime.toolActivityHolds = new Map<string, ToolActivityHold>();
    transcriptRuntime.legacySummaryLastToolCallIds = new Map<string, string>();
    transcriptRuntime.knownToolCallIds = new Set<string>();
    transcriptRuntime.cleanRun = {
        count: 0,
        failed: 0,
        currentToolCallIds: [],
        activeToolCallIds: new Set(),
        groups: [],
        active: false,
        settled: false,
    };
    transcriptRuntime.clearToolActivityHolds = () => {
        for (const hold of transcriptRuntime.toolActivityHolds.values()) {
            if (hold.timer)
                hold.timer();
        }
        transcriptRuntime.toolActivityHolds.clear();
    };
    transcriptRuntime.heldActivity = (hold: ToolActivityHold): string => Date.now() < hold.until ? hold.name : hold.after;
    transcriptRuntime.scheduleToolActivityRelease = (hold: ToolActivityHold) => {
        if (hold.timer)
            hold.timer();
        const delay = Math.max(0, hold.until - Date.now());
        hold.timer = uiScheduler.once(() => {
            hold.timer = undefined;
            if (Date.now() < hold.until) {
                transcriptRuntime.scheduleToolActivityRelease(hold);
                return;
            }
            if (transcriptRuntime.toolActivityHolds.get(hold.toolCallId) === hold) {
                transcriptRuntime.toolActivityHolds.delete(hold.toolCallId);
            }
            if (transcriptRuntime.cleanRun.lastCompletedToolCallId === hold.toolCallId && !transcriptRuntime.cleanRun.activeToolCallId) {
                transcriptRuntime.cleanRun.activeToolName = undefined;
                transcriptRuntime.cleanRun.activity = hold.after;
            }
            transcriptRuntime.cleanRun.requestRender?.();
        }, delay);
    };
    transcriptRuntime.beginToolActivity = (toolCallId: string, name: string, started = false) => {
        const previous = transcriptRuntime.toolActivityHolds.get(toolCallId);
        if (previous) {
            if (previous.timer)
                previous.timer();
            previous.name = name;
            previous.started ||= started;
            transcriptRuntime.cleanRun.activeToolName = name;
            transcriptRuntime.cleanRun.activity = name;
            return;
        }
        const startedAt = Date.now();
        transcriptRuntime.toolActivityHolds.set(toolCallId, {
            toolCallId,
            name,
            until: startedAt + CLEAN_TOOL_ACTIVITY_MIN_MS,
            after: "thinking",
            started,
        });
        transcriptRuntime.cleanRun.activeToolName = name;
        transcriptRuntime.cleanRun.activity = name;
    };
    transcriptRuntime.holdToolActivity = (toolCallId: string, name: string) => {
        let hold = transcriptRuntime.toolActivityHolds.get(toolCallId);
        if (!hold) {
            const now = Date.now();
            hold = {
                toolCallId,
                name,
                until: now + CLEAN_TOOL_ACTIVITY_MIN_MS,
                after: "thinking",
                started: true,
            };
            transcriptRuntime.toolActivityHolds.set(toolCallId, hold);
        }
        hold.name = name;
        hold.started = true;
        hold.after = "thinking";
        transcriptRuntime.scheduleToolActivityRelease(hold);
    };
    transcriptRuntime.activityValueForHold = (toolCallId: string, after: string): DisplayValue => {
        const hold = transcriptRuntime.toolActivityHolds.get(toolCallId);
        if (!hold)
            return after;
        hold.after = after;
        return () => transcriptRuntime.heldActivity(hold);
    };
    transcriptRuntime.liveCleanToolCount = (): number => Math.max(transcriptRuntime.cleanRun.count, transcriptRuntime.cleanRun.currentToolCallIds.length);
    transcriptRuntime.thoughtCountForTool = (toolCallId: string | undefined): number => toolCallId ? transcriptRuntime.activityTimeline.groupForTool(toolCallId)?.thoughtCount ?? 0 : 0;
    transcriptRuntime.currentCleanActivity = (): string => {
        if (transcriptRuntime.cleanRun.activeToolCallId) {
            return transcriptRuntime.cleanRun.activeToolName ?? transcriptRuntime.cleanRun.activity ?? "thinking";
        }
        if (transcriptRuntime.cleanRun.lastCompletedToolCallId) {
            const hold = transcriptRuntime.toolActivityHolds.get(transcriptRuntime.cleanRun.lastCompletedToolCallId);
            if (hold)
                return transcriptRuntime.heldActivity(hold);
        }
        return transcriptRuntime.cleanRun.activeToolName ?? transcriptRuntime.cleanRun.activity ?? (transcriptRuntime.cleanRun.active ? "thinking" : "done");
    };
    pi.on("session_shutdown", transcriptRuntime.clearToolActivityHolds);
}
