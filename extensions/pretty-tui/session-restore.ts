import { NESTED_SNAPSHOT_ENTRY } from "./nested-tools.js";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { assistantMessageKey, assistantTerminalState, thinkingText } from "./activity-timeline.js";
import type { TranscriptRuntime, ToolSummaryGroup, ToolSummaryData } from "./runtime-types.js";
export function initializeSessionRestore(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.messageContentItems = (message: any): any[] => Array.isArray(message?.content) ? message.content : [];
    transcriptRuntime.messageHasVisibleText = (message: any): boolean => typeof message?.content === "string"
        ? message.content.trim().length > 0
        : transcriptRuntime.messageContentItems(message).some((item: any) => item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0);
    transcriptRuntime.restoreCleanSession = (ctx: any) => {
        transcriptRuntime.stopWorkingElapsedTimer();
        transcriptRuntime.currentExtensionUi = ctx.ui;
        transcriptRuntime.clearLatestActivityStatus();
        transcriptRuntime.cleanToolsExpanded = ctx.ui.getToolsExpanded();
        transcriptRuntime.settledSummaries.clear();
        transcriptRuntime.legacySummaryLastToolCallIds.clear();
        transcriptRuntime.activityTimeline.clear();
        transcriptRuntime.nestedTools.clear();
        transcriptRuntime.responseAnswerTexts.clear();
        transcriptRuntime.responseRunStartedAt = undefined;
        transcriptRuntime.responseHasAssistantMessage = false;
        transcriptRuntime.nativeCustomBoundaryKeys.clear();
        transcriptRuntime.revealedActivityGroups.clear();
        transcriptRuntime.collapsedActivityGroups.clear();
        transcriptRuntime.expandedThinkingMembers.clear();
        transcriptRuntime.thinkingComponents.clear();
        transcriptRuntime.activityFallbackThemes.clear();
        transcriptRuntime.activityUpdateComponents.clear();
        transcriptRuntime.activityUpdateMarkdownComponents.clear();
        transcriptRuntime.activityUpdateSequence = 0;
        transcriptRuntime.assistantBoundaryKeys.clear();
        transcriptRuntime.knownToolCallIds.clear();
        transcriptRuntime.cleanCompactToolCallIds.clear();
        transcriptRuntime.cleanGroupToolCallIds.clear();
        transcriptRuntime.cleanToolCallGroupOwners.clear();
        transcriptRuntime.toolComponents.clear();
        transcriptRuntime.cleanToolThemes.clear();
        transcriptRuntime.cleanToolNames.clear();
        transcriptRuntime.clearToolActivityHolds();
        transcriptRuntime.cleanRun.requestRender = undefined;
        transcriptRuntime.cleanRun.count = 0;
        transcriptRuntime.cleanRun.failed = 0;
        transcriptRuntime.cleanRun.currentToolCallIds = [];
        transcriptRuntime.cleanRun.activeToolCallIds.clear();
        transcriptRuntime.cleanRun.groups = [];
        transcriptRuntime.cleanRun.activeToolCallId = undefined;
        transcriptRuntime.cleanRun.activeToolName = undefined;
        transcriptRuntime.cleanRun.lastCompletedToolCallId = undefined;
        transcriptRuntime.cleanRun.activity = undefined;
        transcriptRuntime.cleanRun.active = false;
        transcriptRuntime.cleanRun.settled = false;
        let count = 0;
        let failed = 0;
        let lastToolCallId: string | undefined;
        let lastFinishedGroup: ToolSummaryGroup | undefined;
        const inferredGroups: ToolSummaryGroup[] = [];
        const toolCalls = new Set<string>();
        const completedToolCalls = new Set<string>();
        const explicitSummaryIds = new Set<string>();
        const rememberGroup = (group: ToolSummaryGroup, entryId?: string) => {
            const thoughtCount = Math.max(group.thoughtCount ?? 0, transcriptRuntime.thoughtCountForTool(group.lastToolCallId));
            group.thoughtCount = thoughtCount;
            transcriptRuntime.settledSummaries.set(group.lastToolCallId, {
                count: group.count,
                failed: group.failed,
                thoughtCount,
                activity: "done",
            });
            if (group.toolCallIds?.length) {
                transcriptRuntime.setCleanGroupMembers(group.lastToolCallId, group.toolCallIds.slice());
            }
            if (entryId)
                transcriptRuntime.legacySummaryLastToolCallIds.set(entryId, group.lastToolCallId);
            explicitSummaryIds.add(group.lastToolCallId);
        };
        const finishGroup = () => {
            if (lastToolCallId && count > 0) {
                lastFinishedGroup = {
                    count,
                    failed,
                    thoughtCount: transcriptRuntime.thoughtCountForTool(lastToolCallId),
                    lastToolCallId,
                    toolCallIds: [...toolCalls],
                };
                inferredGroups.push(lastFinishedGroup);
                transcriptRuntime.setCleanGroupMembers(lastToolCallId, [...toolCalls]);
                if (!explicitSummaryIds.has(lastToolCallId)) {
                    transcriptRuntime.settledSummaries.set(lastToolCallId, {
                        count,
                        failed,
                        thoughtCount: lastFinishedGroup.thoughtCount ?? 0,
                        activity: "done",
                    });
                }
            }
            count = 0;
            failed = 0;
            lastToolCallId = undefined;
            toolCalls.clear();
            completedToolCalls.clear();
            transcriptRuntime.activityTimeline.boundary();
        };
        const inferredGroupsOverlapping = (group: ToolSummaryGroup): ToolSummaryGroup[] => {
            if (!group.toolCallIds?.length)
                return [];
            const persistedIds = new Set(group.toolCallIds);
            const currentGroup = lastToolCallId && count > 0
                ? [{
                        count,
                        failed,
                        thoughtCount: transcriptRuntime.thoughtCountForTool(lastToolCallId),
                        lastToolCallId,
                        toolCallIds: [...toolCalls],
                    }]
                : [];
            return [...inferredGroups, ...currentGroup].filter((inferred) => inferred.toolCallIds?.some((toolCallId) => persistedIds.has(toolCallId)));
        };
        const splitSummaryAtTranscriptBoundaries = (group: ToolSummaryGroup): ToolSummaryGroup[] => {
            if (!group.toolCallIds?.length)
                return [group];
            const persistedIds = new Set(group.toolCallIds);
            const overlappingGroups = inferredGroupsOverlapping(group);
            if (overlappingGroups.length <= 1)
                return [group];
            // Older clean-mode summaries could span steering or compaction because
            // only visible assistant text ended a live group. Prefer the transcript's
            // hard boundaries so parent rows and expanded children stay chronological.
            return overlappingGroups.map((inferred) => ({
                ...inferred,
                toolCallIds: inferred.toolCallIds?.filter((toolCallId) => persistedIds.has(toolCallId)),
            }));
        };
        const replaceInferredGroupsWithSummary = (persistedGroup: ToolSummaryGroup, restoredGroups: ToolSummaryGroup[]) => {
            const restoredOwners = new Set(restoredGroups.map((group) => group.lastToolCallId));
            for (const inferred of inferredGroupsOverlapping(persistedGroup)) {
                if (!restoredOwners.has(inferred.lastToolCallId)) {
                    transcriptRuntime.settledSummaries.delete(inferred.lastToolCallId);
                }
            }
            for (const group of restoredGroups)
                rememberGroup(group);
        };
        const consumeGroupCoveredBySummary = (groups: ToolSummaryGroup[]) => {
            if (toolCalls.size === 0)
                return;
            const coveredToolCallIds = new Set(groups.flatMap((group) => [group.lastToolCallId, ...(group.toolCallIds ?? [])]));
            if (![...toolCalls].some((toolCallId) => coveredToolCallIds.has(toolCallId)))
                return;
            // A durable summary closes the current run even if the session contains
            // an orphaned tool call without a toolResult. Do not infer a second,
            // larger Done row when the following user message closes the transcript group.
            count = 0;
            failed = 0;
            lastToolCallId = undefined;
            lastFinishedGroup = undefined;
            toolCalls.clear();
            completedToolCalls.clear();
        };
        // Use the same compaction-aware branch that Pi renders in the transcript;
        // getEntries() can also contain entries from other branches.
        const modelContextEntries = ctx.sessionManager.buildContextEntries();
        transcriptRuntime.cleanContextCompacted = modelContextEntries[0]?.type === "compaction";
        const contextEntries = transcriptRuntime.orderContextEntriesForTranscript(modelContextEntries);
        for (const entry of contextEntries) {
            if (entry.type === "custom" && entry.customType === NESTED_SNAPSHOT_ENTRY) {
                transcriptRuntime.nestedTools.restore(entry.data);
                continue;
            }
            if (entry.type === "compaction") {
                finishGroup();
                lastFinishedGroup = undefined;
                continue;
            }
            if (entry.type === "custom" && entry.customType === "pretty-tui-tool-summary") {
                const data = entry.data as ToolSummaryData | undefined;
                if (data?.groups?.length) {
                    const validGroups = data.groups.filter((group): group is ToolSummaryGroup => Boolean(group?.lastToolCallId && group.count > 0));
                    for (const group of validGroups) {
                        const restoredGroups = splitSummaryAtTranscriptBoundaries(group);
                        replaceInferredGroupsWithSummary(group, restoredGroups);
                    }
                    consumeGroupCoveredBySummary(validGroups);
                }
                else if (data?.lastToolCallId) {
                    const group = {
                        count: data.count ?? 0,
                        failed: data.failed ?? 0,
                        thoughtCount: data.thoughtCount ?? 0,
                        lastToolCallId: data.lastToolCallId,
                    };
                    rememberGroup(group);
                    consumeGroupCoveredBySummary([group]);
                }
                else if (lastFinishedGroup) {
                    // Migrate summaries written by the earlier clean-mode versions,
                    // which did not persist the final tool call id. The text message
                    // preceding this entry has already closed the group.
                    rememberGroup({
                        count: data?.count ?? lastFinishedGroup.count,
                        failed: data?.failed ?? lastFinishedGroup.failed,
                        thoughtCount: data?.thoughtCount ?? lastFinishedGroup.thoughtCount ?? 0,
                        lastToolCallId: lastFinishedGroup.lastToolCallId,
                    }, entry.id);
                }
                else if (lastToolCallId && count > 0) {
                    // Also handle a legacy entry inserted before the boundary text.
                    rememberGroup({
                        count: data?.count ?? count,
                        failed: data?.failed ?? failed,
                        thoughtCount: data?.thoughtCount ?? transcriptRuntime.thoughtCountForTool(lastToolCallId),
                        lastToolCallId,
                    }, entry.id);
                }
                transcriptRuntime.activityTimeline.boundary();
                continue;
            }
            if (entry.type === "custom_message") {
                if (entry.display !== false)
                    transcriptRuntime.addPersistentActivityUpdate(entry);
                continue;
            }
            if (entry.type !== "message")
                continue;
            const message = entry.message as any;
            if (message.role === "user") {
                finishGroup();
                lastFinishedGroup = undefined;
                continue;
            }
            if (message.role === "custom") {
                if (message.display !== false)
                    transcriptRuntime.addPersistentActivityUpdate(message);
                continue;
            }
            if (message.role === "assistant") {
                const answerText = transcriptRuntime.assistantAnswerText(message);
                if (answerText)
                    transcriptRuntime.responseAnswerTexts.set(entry.id, answerText);
                const thinking = thinkingText(message);
                if (thinking) {
                    transcriptRuntime.activityTimeline.addThinking(assistantMessageKey(message), thinking);
                }
                if (transcriptRuntime.messageHasVisibleText(message))
                    finishGroup();
                for (const item of transcriptRuntime.messageContentItems(message)) {
                    if (item.type !== "toolCall" || !item.id)
                        continue;
                    toolCalls.add(item.id);
                    transcriptRuntime.activityTimeline.addTool(item.id, item.name ?? "tool");
                }
                if (assistantTerminalState(message))
                    finishGroup();
                continue;
            }
            if (message.role === "toolResult") {
                transcriptRuntime.nestedTools.absorb(message.toolCallId, message.nestedCalls ?? message.details?.calls, !message.details?.callsTruncated);
            }
            if (message.role === "toolResult" &&
                toolCalls.has(message.toolCallId) &&
                !completedToolCalls.has(message.toolCallId)) {
                completedToolCalls.add(message.toolCallId);
                count++;
                lastToolCallId = message.toolCallId;
                if (message.isError)
                    failed++;
            }
        }
        finishGroup();
    };
}
