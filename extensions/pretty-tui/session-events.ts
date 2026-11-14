import { NESTED_SNAPSHOT_ENTRY } from "./nested-tools.js";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { assistantMessageKey, assistantTerminalState, thinkingText } from "./activity-timeline.js";
const RESPONSE_FOOTER_ENTRY_TYPE = "pretty-tui-response-footer";
import type { TranscriptRuntime, ResponseFooterData, ToolSummaryData } from "./runtime-types.js";
export function installSessionLifecycle(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    pi.on("session_start", (_event, ctx) => {
        transcriptRuntime.fullThinkingHidden = false;
        transcriptRuntime.compactThinkingHidden = true;
        transcriptRuntime.restoreCleanSession(ctx);
    });
    pi.on("session_tree", (_event, ctx) => transcriptRuntime.restoreCleanSession(ctx));
    pi.on("session_before_compact", () => {
        // Pi emits this for manual, threshold, and overflow-recovery compaction.
        // Seal the activity group before the compaction indicator is rendered so
        // completed work never remains labelled Running(... · thinking). A
        // lifecycle boundary overrides the minimum per-tool activity hold.
        transcriptRuntime.clearToolActivityHolds();
        transcriptRuntime.finishCleanGroup("done");
        transcriptRuntime.settleLastCleanGroup();
        transcriptRuntime.cleanRun.activity = "done";
        transcriptRuntime.cleanRun.requestRender?.();
    });
    pi.on("session_compact", () => {
        // Compaction is a hard chronological boundary. Keep tools completed before
        // it in their own group so expanded hierarchy lines never cross the summary.
        transcriptRuntime.finishCleanGroup("done");
        transcriptRuntime.settleLastCleanGroup();
        // Pre-compaction tools have been summarized intentionally. Their durable
        // fallback rows should not be replayed beside the compacted transcript.
        transcriptRuntime.cleanContextCompacted = true;
        transcriptRuntime.cleanRun.requestRender?.();
    });
    pi.on("session_compact_failed", () => {
        // The pre-compaction work is still complete even when compaction is
        // cancelled or fails. Keep it settled and let a retry start a new group.
        transcriptRuntime.settleLastCleanGroup();
        transcriptRuntime.cleanRun.activity = "done";
        transcriptRuntime.cleanRun.requestRender?.();
    });
    transcriptRuntime.hasVisibleAssistantText = (message: any): boolean => message?.role === "assistant" && transcriptRuntime.messageHasVisibleText(message);
    transcriptRuntime.closeAtAssistantBoundary = (message: any, activity: string): boolean => {
        const key = assistantMessageKey(message);
        if (transcriptRuntime.assistantBoundaryKeys.has(key)) {
            // A later snapshot can introduce thinking after text already sealed this
            // message. Seal that newly-created thought group too, but do not let
            // repeated text updates close a different, subsequent tool group.
            const thought = transcriptRuntime.activityTimeline.memberForThinking(key);
            const thoughtGroup = thought ? transcriptRuntime.activityTimeline.groupForMember(thought.id) : undefined;
            if (!thoughtGroup || transcriptRuntime.activityTimeline.currentGroup()?.id !== thoughtGroup.id ||
                transcriptRuntime.activityTimeline.isSettled(thoughtGroup.id))
                return false;
        }
        transcriptRuntime.assistantBoundaryKeys.add(key);
        transcriptRuntime.cleanRun.activity = activity;
        transcriptRuntime.finishCleanGroup(activity);
        return true;
    };
    transcriptRuntime.pendingToolCalls = (message: any): any[] => transcriptRuntime.messageContentItems(message).filter((item: any) => item.type === "toolCall" && item.id);
    transcriptRuntime._conciseActivityText = (value: string): string => value
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean)
        ?.replace(/^#{1,6}\s+/u, "")
        .replace(/^\*\*(.*?)\*\*$/u, "$1") ?? "";
    // Dead in upstream pi-pretty-tui; kept for parity.
    void transcriptRuntime._conciseActivityText;
    transcriptRuntime.trackThinkingActivity = (message: any): void => {
        if (message?.role !== "assistant")
            return;
        const thinking = thinkingText(message);
        if (thinking)
            transcriptRuntime.activityTimeline.addThinking(assistantMessageKey(message), thinking);
    };
    transcriptRuntime.trackPendingToolActivity = (message: any): boolean => {
        const toolCalls = transcriptRuntime.pendingToolCalls(message);
        if (toolCalls.length === 0)
            return false;
        for (const toolCall of toolCalls) {
            transcriptRuntime.activityTimeline.addTool(toolCall.id, toolCall.name ?? "tool");
            transcriptRuntime.flushDeferredCacheNotices?.(toolCall.id);
            if (!transcriptRuntime.cleanRun.currentToolCallIds.includes(toolCall.id)) {
                transcriptRuntime.cleanRun.currentToolCallIds.push(toolCall.id);
            }
            transcriptRuntime.cleanToolNames.set(toolCall.id, transcriptRuntime.cleanToolNames.get(toolCall.id) ?? toolCall.name);
        }
        const toolCall = toolCalls[toolCalls.length - 1];
        if (transcriptRuntime.cleanRun.lastCompletedToolCallId === toolCall.id)
            return false;
        transcriptRuntime.setCleanGroupMembers(toolCall.id, transcriptRuntime.cleanRun.currentToolCallIds.slice());
        transcriptRuntime.cleanRun.active = true;
        transcriptRuntime.cleanRun.activeToolCallId = toolCall.id;
        transcriptRuntime.beginToolActivity(toolCall.id, transcriptRuntime.cleanToolNames.get(toolCall.id) ?? toolCall.name);
        return true;
    };
    transcriptRuntime.clearPendingToolActivities = () => {
        for (const [toolCallId, hold] of transcriptRuntime.toolActivityHolds) {
            if (hold.started)
                continue;
            if (hold.timer)
                hold.timer();
            transcriptRuntime.toolActivityHolds.delete(toolCallId);
            if (transcriptRuntime.cleanRun.activeToolCallId === toolCallId) {
                transcriptRuntime.cleanRun.activeToolCallId = undefined;
                transcriptRuntime.cleanRun.activeToolName = undefined;
            }
        }
    };
}
export function installRunLifecycle(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    // A delivered steering message is also a chronological group boundary.
    // message_start runs before Pi adds the user component to the transcript,
    // so settling here keeps the previous parent row above that message.
    pi.on("message_start", (event) => {
        if (event.message.role === "custom" && event.message.display !== false) {
            transcriptRuntime.addPersistentActivityUpdate(event.message);
            return;
        }
        if (event.message.role !== "user")
            return;
        transcriptRuntime.finishCleanGroup("done");
        transcriptRuntime.settleLastCleanGroup();
    });
    // A visible assistant response is the boundary between tool groups. Seal
    // the prior group directly as Done; the response text already communicates
    // current activity and does not need a duplicate response status.
    pi.on("message_update", (event) => {
        if (transcriptRuntime.hasVisibleAssistantText(event.message)) {
            transcriptRuntime.trackThinkingActivity(event.message);
            transcriptRuntime.clearToolActivityHolds();
            transcriptRuntime.closeAtAssistantBoundary(event.message, "done");
            return;
        }
        transcriptRuntime.trackThinkingActivity(event.message);
        transcriptRuntime.trackPendingToolActivity(event.message);
    });
    pi.on("message_end", (event) => {
        if (event.message?.role === "assistant")
            transcriptRuntime.responseHasAssistantMessage = true;
        if (transcriptRuntime.hasVisibleAssistantText(event.message)) {
            transcriptRuntime.trackThinkingActivity(event.message);
            transcriptRuntime.closeAtAssistantBoundary(event.message, "done");
            transcriptRuntime.cleanRun.activity = "done";
            transcriptRuntime.settleLastCleanGroup();
            return;
        }
        transcriptRuntime.trackThinkingActivity(event.message);
        transcriptRuntime.trackPendingToolActivity(event.message);
        if (assistantTerminalState(event.message)) {
            transcriptRuntime.clearToolActivityHolds();
            transcriptRuntime.finishCleanGroup("done");
            transcriptRuntime.settleLastCleanGroup();
            transcriptRuntime.cleanRun.activity = "done";
        }
    });
    pi.on("agent_start", () => {
        // A retry can start another low-level agent loop. Keep the accumulated
        // count until the whole run reaches agent_settled.
        if (!transcriptRuntime.cleanRun.active) {
            transcriptRuntime.clearToolActivityHolds();
            transcriptRuntime.responseRunStartedAt = Date.now();
            transcriptRuntime.cleanRun.count = 0;
            transcriptRuntime.cleanRun.failed = 0;
            transcriptRuntime.cleanRun.currentToolCallIds = [];
            transcriptRuntime.cleanRun.activeToolCallIds.clear();
            transcriptRuntime.cleanRun.groups = [];
            transcriptRuntime.cleanRun.lastCompletedToolCallId = undefined;
            transcriptRuntime.cleanRun.settled = false;
        }
        // Retries share the original start time but only the newest low-level
        // run may supply a candidate final answer.
        transcriptRuntime.responseHasAssistantMessage = false;
        transcriptRuntime.cleanRun.active = true;
        transcriptRuntime.cleanRun.activeToolCallIds.clear();
        transcriptRuntime.cleanRun.activeToolCallId = undefined;
        transcriptRuntime.cleanRun.activeToolName = undefined;
        transcriptRuntime.cleanRun.activity = "thinking";
        transcriptRuntime.startWorkingElapsedTimer();
    });
    pi.on("tool_execution_start", (event) => {
        if ((event as any).parentToolCallId) {
            transcriptRuntime.nestedTools.start(event);
            transcriptRuntime.refreshNestedTools(event.toolCallId);
            return;
        }
        transcriptRuntime.activityTimeline.addTool(event.toolCallId, event.toolName);
        transcriptRuntime.flushDeferredCacheNotices?.(event.toolCallId);
        if (!transcriptRuntime.cleanRun.currentToolCallIds.includes(event.toolCallId)) {
            transcriptRuntime.cleanRun.currentToolCallIds.push(event.toolCallId);
        }
        transcriptRuntime.cleanRun.activeToolCallIds.add(event.toolCallId);
        const displayName = transcriptRuntime.cleanToolNames.get(event.toolCallId) ?? event.toolName;
        transcriptRuntime.cleanToolNames.set(event.toolCallId, displayName);
        transcriptRuntime.setCleanGroupMembers(event.toolCallId, transcriptRuntime.cleanRun.currentToolCallIds.slice());
        transcriptRuntime.cleanRun.active = true;
        transcriptRuntime.cleanRun.activeToolCallId = event.toolCallId;
        transcriptRuntime.beginToolActivity(event.toolCallId, displayName, true);
        transcriptRuntime.requestActivityRender(transcriptRuntime.activityTimeline.groupForTool(event.toolCallId));
    });
    pi.on("tool_execution_update", (event) => {
        if ((event as any).parentToolCallId) {
            transcriptRuntime.nestedTools.update(event);
            transcriptRuntime.refreshNestedTools(event.toolCallId);
        }
        else {
            transcriptRuntime.nestedTools.absorb(event.toolCallId, (event.partialResult as any)?.details?.calls, !(event.partialResult as any)?.details?.callsTruncated);
            transcriptRuntime.refreshNestedTools(event.toolCallId);
        }
    });
    pi.on("tool_execution_end", (event) => {
        if ((event as any).parentToolCallId) {
            transcriptRuntime.nestedTools.update(event, true);
            transcriptRuntime.refreshNestedTools(event.toolCallId);
            return;
        }
        transcriptRuntime.nestedTools.absorb(event.toolCallId, (event.result as any)?.details?.calls, !(event.result as any)?.details?.callsTruncated);
        transcriptRuntime.nestedTools.finish(event.toolCallId);
        const snapshot = transcriptRuntime.nestedTools.snapshot(event.toolCallId);
        if (snapshot)
            pi.appendEntry(NESTED_SNAPSHOT_ENTRY, snapshot);
        const activityName = transcriptRuntime.cleanRun.activeToolCallId === event.toolCallId
            ? transcriptRuntime.cleanRun.activeToolName ?? transcriptRuntime.cleanToolNames.get(event.toolCallId) ?? event.toolName
            : transcriptRuntime.cleanToolNames.get(event.toolCallId) ?? event.toolName;
        // Keep the tool activity visible until at least one second after start;
        // this only delays the status transition, never the tool result itself.
        transcriptRuntime.holdToolActivity(event.toolCallId, activityName);
        transcriptRuntime.cleanRun.count++;
        if (event.isError)
            transcriptRuntime.cleanRun.failed++;
        transcriptRuntime.cleanRun.lastCompletedToolCallId = event.toolCallId;
        transcriptRuntime.cleanRun.activeToolCallIds.delete(event.toolCallId);
        if (transcriptRuntime.cleanRun.activeToolCallId === event.toolCallId) {
            transcriptRuntime.cleanRun.activeToolCallId = [...transcriptRuntime.cleanRun.currentToolCallIds]
                .reverse()
                .find((toolCallId) => transcriptRuntime.cleanRun.activeToolCallIds.has(toolCallId));
            transcriptRuntime.cleanRun.activeToolName = transcriptRuntime.cleanRun.activeToolCallId
                ? transcriptRuntime.cleanToolNames.get(transcriptRuntime.cleanRun.activeToolCallId)
                : undefined;
            transcriptRuntime.cleanRun.activity = transcriptRuntime.cleanRun.activeToolName ?? "thinking";
        }
        const visibleSummaryToolCallId = transcriptRuntime.cleanRun.activeToolCallId ?? transcriptRuntime.cleanRun.lastCompletedToolCallId;
        transcriptRuntime.setCleanGroupMembers(visibleSummaryToolCallId, transcriptRuntime.cleanRun.currentToolCallIds.slice());
        transcriptRuntime.requestActivityRender(transcriptRuntime.activityTimeline.groupForTool(event.toolCallId));
        // Tool success and failure remain owned by the activity group. The bottom
        // line is reserved for transient UI status messages.
    });
    pi.on("agent_end", () => {
        // No summary is appended here: this event may be followed by an automatic
        // retry or compaction. The live row remains available until settled.
        transcriptRuntime.clearPendingToolActivities();
        transcriptRuntime.cleanRun.activeToolCallIds.clear();
        transcriptRuntime.cleanRun.activeToolCallId = undefined;
        transcriptRuntime.cleanRun.activeToolName = undefined;
        transcriptRuntime.cleanRun.activity = "thinking";
    });
    pi.on("agent_settled", (_event, ctx) => {
        transcriptRuntime.stopWorkingElapsedTimer();
        if (transcriptRuntime.cleanRun.settled)
            return;
        for (const rootId of transcriptRuntime.nestedTools.finishAll()) {
            const snapshot = transcriptRuntime.nestedTools.snapshot(rootId);
            if (snapshot)
                pi.appendEntry(NESTED_SNAPSHOT_ENTRY, snapshot);
            transcriptRuntime.refreshNestedTools(rootId);
        }
        transcriptRuntime.clearPendingToolActivities();
        // Finalize the last group after retries/compaction have definitely ended.
        transcriptRuntime.finishCleanGroup("done");
        for (const group of transcriptRuntime.cleanRun.groups) {
            group.activity = "done";
            transcriptRuntime.settledSummaries.set(group.lastToolCallId, {
                count: group.count,
                failed: group.failed,
                thoughtCount: group.thoughtCount ?? 0,
                activity: transcriptRuntime.activityValueForHold(group.lastToolCallId, "done"),
            });
        }
        transcriptRuntime.cleanRun.active = false;
        transcriptRuntime.cleanRun.activeToolCallIds.clear();
        transcriptRuntime.cleanRun.activeToolCallId = undefined;
        transcriptRuntime.cleanRun.activeToolName = undefined;
        transcriptRuntime.cleanRun.activity = "done";
        transcriptRuntime.cleanRun.settled = true;
        for (const group of transcriptRuntime.activityTimeline.groups())
            transcriptRuntime.refreshActivityGroup(group);
        transcriptRuntime.currentTui?.requestRender?.();
        if (transcriptRuntime.responseRunStartedAt !== undefined) {
            // message_end runs before later extensions can replace the message and
            // before Pi persists it. Read the committed branch at the final boundary
            // so Copy matches the transcript even when another extension redacts it.
            const finalEntry = transcriptRuntime.responseHasAssistantMessage ? ctx.sessionManager.getBranch().reverse().find((entry) => entry.type === "message" && entry.message.role === "assistant")
                : undefined;
            const answer = finalEntry && finalEntry.type === "message"
                ? transcriptRuntime.assistantAnswerText(finalEntry.message)
                : "";
            if (answer && finalEntry)
                transcriptRuntime.responseAnswerTexts.set(finalEntry.id, answer);
            pi.appendEntry<ResponseFooterData>(RESPONSE_FOOTER_ENTRY_TYPE, {
                answerEntryId: answer ? finalEntry?.id : undefined,
                durationMs: Math.max(0, Date.now() - transcriptRuntime.responseRunStartedAt),
                outcome: finalEntry?.type === "message" && assistantTerminalState(finalEntry.message)
                    ? "stopped"
                    : "completed",
            });
            transcriptRuntime.responseRunStartedAt = undefined;
            transcriptRuntime.responseHasAssistantMessage = false;
        }
        const groups = transcriptRuntime.cleanRun.groups.slice();
        if (transcriptRuntime.renderMode !== "clean" || groups.length === 0)
            return;
        const count = groups.reduce((total, group) => total + group.count, 0);
        const failed = groups.reduce((total, group) => total + group.failed, 0);
        const thoughtCount = groups.reduce((total, group) => total + (group.thoughtCount ?? 0), 0);
        const lastToolCallId = groups[groups.length - 1]?.lastToolCallId;
        pi.appendEntry<ToolSummaryData>("pretty-tui-tool-summary", {
            count,
            failed,
            thoughtCount,
            lastToolCallId,
            groups: groups.map(({ count, failed, thoughtCount, lastToolCallId, toolCallIds }) => ({
                count,
                failed,
                thoughtCount,
                lastToolCallId,
                toolCallIds,
            })),
        });
    });
}
