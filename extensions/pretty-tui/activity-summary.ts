import { fillToWidth } from "../shared/text.js";
import { installToolComponents } from "./tool-components.js";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { type ActivityGroup } from "./activity-timeline.js";
const RESPONSE_FOOTER_ENTRY_TYPE = "pretty-tui-response-footer";
import type { TranscriptRuntime, ResponseFooterData, DisplayValue, DisplayRow, ToolSummaryGroup, ToolSummaryData } from "./runtime-types.js";
export function initializeActivitySummaries(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    // A tool component can be created from the streamed assistant message
    // before Pi dispatches tool_execution_start. Mark its activity at the
    // component's own execution boundary too, so the first clean render names it.
    installToolComponents(pi, transcriptRuntime);
    transcriptRuntime.finishCleanGroup = (activity = transcriptRuntime.cleanRun.activity ?? "done") => {
        const activeGroup = transcriptRuntime.activityTimeline.currentGroup();
        if (transcriptRuntime.cleanRun.lastCompletedToolCallId && transcriptRuntime.cleanRun.count > 0) {
            const group: ToolSummaryGroup = {
                count: transcriptRuntime.cleanRun.count,
                failed: transcriptRuntime.cleanRun.failed,
                thoughtCount: transcriptRuntime.thoughtCountForTool(transcriptRuntime.cleanRun.lastCompletedToolCallId),
                lastToolCallId: transcriptRuntime.cleanRun.lastCompletedToolCallId,
                toolCallIds: transcriptRuntime.cleanRun.currentToolCallIds.slice(),
                activity,
            };
            transcriptRuntime.cleanRun.groups.push(group);
            transcriptRuntime.settledSummaries.set(group.lastToolCallId, {
                count: group.count,
                failed: group.failed,
                thoughtCount: group.thoughtCount ?? 0,
                activity: transcriptRuntime.activityValueForHold(group.lastToolCallId, activity),
            });
            transcriptRuntime.setCleanGroupMembers(group.lastToolCallId, group.toolCallIds ?? []);
        }
        transcriptRuntime.cleanRun.count = 0;
        transcriptRuntime.cleanRun.failed = 0;
        transcriptRuntime.cleanRun.currentToolCallIds = [];
        transcriptRuntime.cleanRun.activeToolCallIds.clear();
        transcriptRuntime.cleanRun.lastCompletedToolCallId = undefined;
        transcriptRuntime.cleanRun.activeToolCallId = undefined;
        transcriptRuntime.cleanRun.activeToolName = undefined;
        transcriptRuntime.activityTimeline.boundary();
        transcriptRuntime.requestActivityRender(activeGroup);
    };
    transcriptRuntime.closeCleanAtNativeCustomBoundary = () => {
        transcriptRuntime.finishCleanGroup("done");
        transcriptRuntime.settleLastCleanGroup();
    };
    transcriptRuntime.closeCleanAtStandaloneAlert = () => {
        transcriptRuntime.finishCleanGroup("done");
        transcriptRuntime.settleLastCleanGroup();
    };
    transcriptRuntime.settleLastCleanGroup = () => {
        const group = transcriptRuntime.cleanRun.groups[transcriptRuntime.cleanRun.groups.length - 1];
        if (!group)
            return;
        group.activity = "done";
        transcriptRuntime.settledSummaries.set(group.lastToolCallId, {
            count: group.count,
            failed: group.failed,
            thoughtCount: group.thoughtCount ?? 0,
            activity: transcriptRuntime.activityValueForHold(group.lastToolCallId, "done"),
        });
    };
    transcriptRuntime.summaryText = (count: number, _failed: number, thoughtCount: number, activity = "done", nestedCount = 0): string => {
        const rawActivityText = typeof activity === "string" ? activity : "done";
        const normalizedActivityText = rawActivityText.trim();
        const activityText = /^thinking(?:\.\.\.)?$/iu.test(normalizedActivityText)
            ? "thinking"
            : rawActivityText;
        const totalCalls = count + nestedCount;
        const countLabel = totalCalls > 0 ? `${totalCalls} tool ${totalCalls === 1 ? "call" : "calls"}` : "";
        const thoughtLabel = thoughtCount > 0
            ? `${thoughtCount} ${thoughtCount === 1 ? "thought" : "thoughts"}`
            : "";
        // Without tools there is no current tool name to report, and the generic
        // "thinking" placeholder would only repeat the thought count.
        const activityLabel = count > 0 && activityText !== "done" && activityText.trim()
            ? activityText
            : "";
        return [countLabel, thoughtLabel, activityLabel].filter(Boolean).join(" · ");
    };
    transcriptRuntime.summaryRow = (theme: any, count: number, failed: number, thoughtCount: number, activity: DisplayValue = "done", collapsedDone = false, nestedCount = 0): DisplayRow => ({
        prefix: () => {
            const currentActivity = typeof activity === "function" ? activity() : activity;
            const dimPhase = transcriptRuntime.responseRunStartedAt !== undefined &&
                Math.floor(Math.max(0, Date.now() - transcriptRuntime.responseRunStartedAt) / transcriptRuntime.RUNNING_DOT_INTERVAL_MS) % 2 === 1;
            const color = currentActivity === "done"
                ? collapsedDone ? "dim" : "success"
                : dimPhase ? "dim" : "accent";
            return currentActivity !== "done" && !dimPhase
                ? transcriptRuntime.runningColor(theme, "● ")
                : theme.fg(color, "● ");
        },
        continuation: "  ",
        content: () => {
            const currentActivity = typeof activity === "function" ? activity() : activity;
            const label = currentActivity === "done" ? "Done" : "Running";
            const color = label === "Done"
                ? collapsedDone ? "dim" : "success"
                : "accent";
            const detailColor = label === "Done" && collapsedDone ? "dim" : "text";
            const title = label === "Running"
                ? transcriptRuntime.runningColor(theme, theme.bold(label))
                : theme.fg(color, theme.bold(label));
            return title +
                theme.fg("dim", "(") +
                theme.fg(detailColor, transcriptRuntime.summaryText(count, failed, thoughtCount, currentActivity, nestedCount)) +
                theme.fg("dim", ")");
        },
    });
    transcriptRuntime._renderCleanGroupSummary = (lastToolCallId: string, width: number): string[] => {
        const summaryTheme = transcriptRuntime.cleanThemeForToolCall(lastToolCallId);
        if (!summaryTheme)
            return [];
        const settled = transcriptRuntime.settledSummaries.get(lastToolCallId);
        if (settled) {
            return transcriptRuntime.block([transcriptRuntime.summaryRow(summaryTheme, settled.count, settled.failed, settled.thoughtCount, settled.activity)]).render(width);
        }
        if (transcriptRuntime.cleanRun.activeToolCallId === lastToolCallId) {
            return transcriptRuntime.block([transcriptRuntime.summaryRow(summaryTheme, transcriptRuntime.liveCleanToolCount(), transcriptRuntime.cleanRun.failed, transcriptRuntime.thoughtCountForTool(lastToolCallId), () => transcriptRuntime.cleanRun.activeToolName ?? transcriptRuntime.currentCleanActivity())]).render(width);
        }
        if (transcriptRuntime.cleanRun.lastCompletedToolCallId === lastToolCallId && transcriptRuntime.cleanRun.count > 0) {
            return transcriptRuntime.block([transcriptRuntime.summaryRow(summaryTheme, transcriptRuntime.cleanRun.count, transcriptRuntime.cleanRun.failed, transcriptRuntime.thoughtCountForTool(lastToolCallId), transcriptRuntime.currentCleanActivity)]).render(width);
        }
        return [];
    };
    transcriptRuntime.renderActivityGroupSummary = (group: ActivityGroup, width: number, collapsedDone = false): string[] => {
        const fit = (lines: string[]) => lines.map((line) => truncateToWidth(line, Math.max(1, width), ""));
        const summaryTheme = transcriptRuntime.activityGroupTheme(group);
        if (!summaryTheme || !transcriptRuntime.activityTimeline.hasWork(group))
            return [];
        const owner = transcriptRuntime.activityGroupOwner(group);
        const settled = owner ? transcriptRuntime.settledSummaries.get(owner) : undefined;
        const toolCount = group.toolCallIds.length;
        const nestedCount = group.toolCallIds.reduce((count, id) => count + transcriptRuntime.nestedTools.count(id), 0);
        const live = () => transcriptRuntime.cleanRun.activeToolName ?? transcriptRuntime.currentCleanActivity();
        const currentGroup = transcriptRuntime.activityTimeline.currentGroup();
        const isLiveGroup = currentGroup?.id === group.id &&
            !transcriptRuntime.activityTimeline.isSettled(group.id) &&
            !transcriptRuntime.cleanRun.settled;
        if (settled) {
            return fit(transcriptRuntime.block([transcriptRuntime.summaryRow(summaryTheme, group.hardBoundarySplit ? toolCount : Math.max(settled.count, toolCount), group.hardBoundarySplit ? 0 : settled.failed, Math.max(settled.thoughtCount, group.thoughtCount), settled.activity, collapsedDone, nestedCount)]).render(width));
        }
        if (owner && isLiveGroup) {
            // Only the current, unsettled group may consume live run state.
            return fit(transcriptRuntime.block([transcriptRuntime.summaryRow(summaryTheme, Math.max(toolCount, transcriptRuntime.liveCleanToolCount()), transcriptRuntime.cleanRun.failed, group.thoughtCount, live, collapsedDone, nestedCount)]).render(width));
        }
        if (!owner && isLiveGroup) {
            // Thought-only current group while the model is still working.
            return fit(transcriptRuntime.block([transcriptRuntime.summaryRow(summaryTheme, toolCount, transcriptRuntime.cleanRun.failed, group.thoughtCount, "thinking", collapsedDone, nestedCount)]).render(width));
        }
        // Finished group with no durable summary: a completed Thought-only turn, or
        // a group split apart by a native custom renderer.
        return fit(transcriptRuntime.block([transcriptRuntime.summaryRow(summaryTheme, toolCount, 0, group.thoughtCount, "done", collapsedDone, nestedCount)]).render(width));
    };
}
export function installSummaryEntries(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.cleanToolCall = (theme: any, name: string, toolCallId: string): Component => {
        transcriptRuntime.knownToolCallIds.add(toolCallId);
        transcriptRuntime.cleanToolThemes.set(toolCallId, theme);
        const activityGroup = transcriptRuntime.activityTimeline.groupForTool(toolCallId);
        if (activityGroup)
            transcriptRuntime.activityFallbackThemes.set(activityGroup.id, theme);
        const isLiveGroup = !activityGroup || (transcriptRuntime.activityTimeline.currentGroup()?.id === activityGroup.id &&
            !transcriptRuntime.activityTimeline.isSettled(activityGroup.id) &&
            !transcriptRuntime.cleanRun.settled);
        return {
            render(width: number): string[] {
                if (transcriptRuntime.renderMode !== "clean")
                    return [];
                const settledSummary = transcriptRuntime.settledSummaries.get(toolCallId);
                if (settledSummary) {
                    return transcriptRuntime.block([transcriptRuntime.summaryRow(theme, settledSummary.count, settledSummary.failed, settledSummary.thoughtCount, settledSummary.activity, true)]).render(width);
                }
                if (transcriptRuntime.cleanRun.settled)
                    return [];
                if (isLiveGroup && transcriptRuntime.cleanRun.activeToolCallId === toolCallId) {
                    return transcriptRuntime.block([transcriptRuntime.summaryRow(theme, transcriptRuntime.liveCleanToolCount(), transcriptRuntime.cleanRun.failed, transcriptRuntime.thoughtCountForTool(toolCallId), () => transcriptRuntime.cleanRun.activeToolName ?? name)]).render(width);
                }
                // The active tool owns the live Running row. Keep the latest completed
                // portion hidden while that tool's minimum display time is running.
                if (isLiveGroup &&
                    transcriptRuntime.cleanRun.lastCompletedToolCallId === toolCallId &&
                    transcriptRuntime.cleanRun.count > 0 &&
                    !transcriptRuntime.cleanRun.activeToolCallId) {
                    return transcriptRuntime.block([transcriptRuntime.summaryRow(theme, transcriptRuntime.cleanRun.count, transcriptRuntime.cleanRun.failed, transcriptRuntime.thoughtCountForTool(toolCallId), transcriptRuntime.currentCleanActivity)]).render(width);
                }
                // Do not fall back to the per-component pending state here: Pi may
                // create several tool-call components before execution starts, and
                // showing that fallback would briefly expose all of them. The active
                // component is selected to render the current Running row at execution start.
                return [];
            },
            invalidate() { },
        };
    };
    transcriptRuntime.hiddenToolResult = (context: any, options: any, _output: string): Component => {
        if (options.isPartial)
            transcriptRuntime.setStatus(context, "running");
        else
            transcriptRuntime.completeStatus(context);
        return transcriptRuntime.block([]);
    };
    transcriptRuntime.hideCleanTool = (toolCallId: string, expanded: boolean, _executionStarted = false): boolean => transcriptRuntime.renderMode === "clean" && !expanded && !transcriptRuntime.isCleanGroupRevealed(toolCallId);
    transcriptRuntime.useCompactToolView = (toolCallId: string, expanded: boolean): boolean => !expanded && (transcriptRuntime.renderMode === "compact" ||
        (transcriptRuntime.renderMode === "clean" && transcriptRuntime.isCleanGroupRevealed(toolCallId)));
    pi.registerEntryRenderer<ResponseFooterData>(RESPONSE_FOOTER_ENTRY_TYPE, (entry, _options, theme) => {
        let copyStart = -1;
        let copyWidth = 0;
        return {
            render(width: number): string[] {
                const data = entry.data;
                transcriptRuntime.mouseClickHitTests.set(this, (event) => transcriptRuntime.fullscreenTui && copyStart >= 0 &&
                    event.y === 0 && event.x >= copyStart && event.x < copyStart + copyWidth);
                if (!data || width <= 0)
                    return [];
                copyStart = -1;
                copyWidth = 0;
                const answer = data.answerEntryId ? transcriptRuntime.responseAnswerTexts.get(data.answerEntryId) ?? "" : "";
                const copyLabel = "[Copy]";
                const showCopy = transcriptRuntime.fullscreenTui && Boolean(answer.trim()) && width >= 30;
                const duration = transcriptRuntime.formatResponseDuration(data.durationMs);
                const statusText = data.outcome === "stopped"
                    ? `⚠ Stopped after ${duration}`
                    : `✓ Completed in ${duration}`;
                const leading = "── ";
                const trailing = showCopy ? ` ${copyLabel} ──` : "──";
                const fixedWidth = visibleWidth(leading) + visibleWidth(trailing) + 1;
                if (width <= fixedWidth)
                    return [theme.fg("dim", "─".repeat(width))];
                const statusWidth = Math.max(1, width - fixedWidth);
                const visibleStatus = truncateToWidth(statusText, statusWidth, "…");
                const prefix = leading + visibleStatus + " ";
                const fill = fillToWidth(width, [prefix, trailing], "─");
                const line = prefix + fill + trailing;
                if (showCopy) {
                    const copyIndex = line.indexOf(copyLabel);
                    copyStart = visibleWidth(line.slice(0, copyIndex));
                    copyWidth = visibleWidth(copyLabel);
                }
                // The divider, completion text, and Copy control intentionally share
                // one quiet gray treatment; position alone communicates the hierarchy.
                return [theme.fg("dim", line)];
            },
            handleMouse(event: TuiMouseEvent) {
                if (copyStart < 0 ||
                    event.button !== "left" ||
                    (event.type !== "press" && event.type !== "click") ||
                    event.y !== 0 ||
                    event.x < copyStart ||
                    event.x >= copyStart + copyWidth) {
                    return undefined;
                }
                if (event.type === "click" && entry.data?.answerEntryId) {
                    const answer = transcriptRuntime.responseAnswerTexts.get(entry.data.answerEntryId);
                    if (answer)
                        transcriptRuntime.copyTranscriptText(answer);
                }
                return { handled: true, render: false };
            },
            invalidate() { },
        };
    });
    pi.registerEntryRenderer<ToolSummaryData>("pretty-tui-tool-summary", (entry, { expanded }, theme) => ({
        render(width: number): string[] {
            if (transcriptRuntime.renderMode !== "clean" || expanded || transcriptRuntime.cleanContextCompacted)
                return [];
            const data = entry.data;
            const groups = data?.groups?.length
                ? data.groups
                : data?.lastToolCallId
                    ? [{
                            count: data.count ?? 0,
                            failed: data.failed ?? 0,
                            thoughtCount: data.thoughtCount ?? 0,
                            lastToolCallId: data.lastToolCallId,
                        }]
                    : (() => {
                        const summaryCallId = transcriptRuntime.legacySummaryLastToolCallIds.get(entry.id);
                        return summaryCallId
                            ? [{
                                    count: data?.count ?? 0,
                                    failed: data?.failed ?? 0,
                                    thoughtCount: data?.thoughtCount ?? 0,
                                    lastToolCallId: summaryCallId,
                                }]
                            : [];
                    })();
            // The live tool components own the visual positions. Keep this durable
            // entry as a fallback only for groups whose components are unexpectedly
            // absent from an uncompacted branch.
            const missingGroups = groups.filter((group) => !transcriptRuntime.knownToolCallIds.has(group.lastToolCallId));
            if (missingGroups.length === 0)
                return [];
            // Persisted entries represent settled groups, so always normalize their
            // display to Done even when an older entry stored a transient activity.
            return transcriptRuntime.block(missingGroups.map((group) => transcriptRuntime.summaryRow(theme, group.count, group.failed, group.thoughtCount ?? 0, "done", true))).render(width);
        },
        invalidate() { },
    }));
}
