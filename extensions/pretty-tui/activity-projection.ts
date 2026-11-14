import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type ActivityGroup, type ActivityMember } from "./activity-timeline.js";
import type { TranscriptRuntime } from "./runtime-types.js";
export function initializeActivityProjection(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.transcriptMarkdownDepth = 0;
    transcriptRuntime.withTranscriptMarkdown = <T>(callback: () => T): T => {
        transcriptRuntime.transcriptMarkdownDepth++;
        try {
            return callback();
        }
        finally {
            transcriptRuntime.transcriptMarkdownDepth--;
        }
    };
    transcriptRuntime.transcriptMarkdownActive = () => transcriptRuntime.transcriptMarkdownDepth > 0;
    transcriptRuntime.setCleanGroupMembers = (lastToolCallId: string, toolCallIds: string[]) => {
        transcriptRuntime.cleanGroupToolCallIds.set(lastToolCallId, toolCallIds);
        for (const toolCallId of toolCallIds)
            transcriptRuntime.cleanToolCallGroupOwners.set(toolCallId, lastToolCallId);
    };
    transcriptRuntime.isCleanGroupRevealed = (toolCallId: string): boolean => {
        if (transcriptRuntime.cleanCompactToolCallIds.has(toolCallId))
            return true;
        const activityGroup = transcriptRuntime.activityTimeline.groupForTool(toolCallId);
        if (activityGroup && transcriptRuntime.activityGroupRevealed(activityGroup))
            return true;
        const legacyOwner = transcriptRuntime.cleanToolCallGroupOwners.get(toolCallId);
        const legacyIds = legacyOwner ? transcriptRuntime.cleanGroupToolCallIds.get(legacyOwner) : undefined;
        return legacyIds?.some((id) => transcriptRuntime.cleanCompactToolCallIds.has(id)) ?? false;
    };
    transcriptRuntime.cleanThemeForToolCall = (toolCallId: string): any => {
        const directTheme = transcriptRuntime.cleanToolThemes.get(toolCallId);
        if (directTheme)
            return directTheme;
        const activityGroup = transcriptRuntime.activityTimeline.groupForTool(toolCallId);
        // Prefer a real tool renderer theme over the Markdown-derived fallback.
        // A group that starts with Thought installs the fallback first; returning
        // it here made later third-party success dots use the heading color.
        if (activityGroup) {
            for (const id of activityGroup.toolCallIds) {
                const activityTheme = transcriptRuntime.cleanToolThemes.get(id);
                if (activityTheme) {
                    transcriptRuntime.activityFallbackThemes.set(activityGroup.id, activityTheme);
                    return activityTheme;
                }
            }
        }
        const cachedActivityTheme = activityGroup
            ? transcriptRuntime.activityFallbackThemes.get(activityGroup.id)
            : undefined;
        if (cachedActivityTheme)
            return cachedActivityTheme;
        const legacyOwner = transcriptRuntime.cleanToolCallGroupOwners.get(toolCallId);
        const legacyIds = legacyOwner ? transcriptRuntime.cleanGroupToolCallIds.get(legacyOwner) : undefined;
        return legacyIds?.map((id) => transcriptRuntime.cleanToolThemes.get(id)).find(Boolean);
    };
    transcriptRuntime.activityGroupOwner = (group: ActivityGroup): string | undefined => {
        for (let index = group.toolCallIds.length - 1; index >= 0; index--) {
            const toolCallId = group.toolCallIds[index];
            if (transcriptRuntime.settledSummaries.has(toolCallId))
                return toolCallId;
        }
        if (transcriptRuntime.cleanRun.activeToolCallId && group.toolCallIds.includes(transcriptRuntime.cleanRun.activeToolCallId)) {
            return transcriptRuntime.cleanRun.activeToolCallId;
        }
        if (transcriptRuntime.cleanRun.lastCompletedToolCallId && group.toolCallIds.includes(transcriptRuntime.cleanRun.lastCompletedToolCallId)) {
            return transcriptRuntime.cleanRun.lastCompletedToolCallId;
        }
        return group.toolCallIds[group.toolCallIds.length - 1];
    };
    transcriptRuntime.fallbackActivityTheme = undefined;
    transcriptRuntime.defaultActivityTheme = () => {
        if (transcriptRuntime.currentExtensionUi?.theme?.fg)
            return transcriptRuntime.currentExtensionUi.theme;
        const markdownTheme = getMarkdownTheme();
        return transcriptRuntime.fallbackActivityTheme ??= {
            fg: (color: string, text: string) => {
                if (color === "accent")
                    return markdownTheme.listBullet(text);
                if (color === "mdHeading")
                    return markdownTheme.heading(text);
                // Session UI normally supplies Pi's active Theme above. Keep portable
                // semantic fallbacks for early startup and isolated renderer tests.
                if (color === "warning")
                    return `\x1b[33m${text}\x1b[39m`;
                if (color === "error")
                    return `\x1b[31m${text}\x1b[39m`;
                if (color === "success")
                    return `\x1b[32m${text}\x1b[39m`;
                if (color === "syntaxComment")
                    return markdownTheme.codeBlock(text);
                if (color === "thinkingLow" || color === "mdLink")
                    return markdownTheme.link(text);
                if (color === "dim" || color === "muted" || color === "thinkingText") {
                    return markdownTheme.quote(text);
                }
                return text;
            },
            bold: markdownTheme.bold,
            italic: markdownTheme.italic,
        };
    };
    transcriptRuntime.activityGroupTheme = (group: ActivityGroup): any => {
        // A Thought can render before its tools are constructed and install a
        // Markdown fallback. Always promote a real tool theme once available so
        // light mode receives explicit, high-contrast text colors.
        for (const toolCallId of group.toolCallIds) {
            const toolTheme = transcriptRuntime.cleanToolThemes.get(toolCallId);
            if (toolTheme) {
                transcriptRuntime.activityFallbackThemes.set(group.id, toolTheme);
                return toolTheme;
            }
        }
        const cached = transcriptRuntime.activityFallbackThemes.get(group.id);
        if (cached)
            return cached;
        const fallback = transcriptRuntime.defaultActivityTheme();
        transcriptRuntime.activityFallbackThemes.set(group.id, fallback);
        return fallback;
    };
    transcriptRuntime.activityGroupRevealed = (group: ActivityGroup): boolean => !transcriptRuntime.collapsedActivityGroups.has(group.id) &&
        (transcriptRuntime.cleanToolsExpanded || transcriptRuntime.revealedActivityGroups.has(group.id));
    transcriptRuntime.activityGroupCollapsible = (group: ActivityGroup): boolean => transcriptRuntime.activityTimeline.hasWork(group);
    transcriptRuntime.activityMemberPosition = (group: ActivityGroup, member: ActivityMember) => ({
        first: group.members[0]?.id === member.id,
        last: group.members[group.members.length - 1]?.id === member.id,
    });
    transcriptRuntime.collapseLabel = "[↑ Collapse]";
    transcriptRuntime.collapsePrefix = "  └─ ";
    transcriptRuntime.renderActivityCollapse = (group: ActivityGroup, width: number): string => {
        const theme = transcriptRuntime.activityGroupTheme(group);
        return truncateToWidth(theme.fg("dim", transcriptRuntime.collapsePrefix) + theme.fg("mdLink", transcriptRuntime.collapseLabel), Math.max(1, width), "");
    };
    transcriptRuntime.withActivityCollapse = (group: ActivityGroup, member: ActivityMember, width: number, lines: string[]): string[] => transcriptRuntime.activityMemberPosition(group, member).last && transcriptRuntime.activityGroupRevealed(group)
        ? [...lines, transcriptRuntime.renderActivityCollapse(group, width)]
        : lines;
    transcriptRuntime.activityCollapseClicked = (group: ActivityGroup, member: ActivityMember, event: any, row: number): boolean => transcriptRuntime.activityGroupRevealed(group) &&
        transcriptRuntime.activityMemberPosition(group, member).last &&
        event.type === "click" && event.button === "left" && event.y === row &&
        event.x >= visibleWidth(transcriptRuntime.collapsePrefix) &&
        event.x < Math.min(event.width, visibleWidth(transcriptRuntime.collapsePrefix + transcriptRuntime.collapseLabel));
    transcriptRuntime.refreshActivityGroup = (group: ActivityGroup): void => {
        for (const child of group.members) {
            if (child.kind === "tool" && child.toolCallId) {
                transcriptRuntime.toolComponents.get(child.toolCallId)?.updateDisplay?.();
            }
            else if (child.kind === "thinking" && child.messageKey) {
                transcriptRuntime.thinkingComponents.get(child.messageKey)?.invalidate?.();
            }
            else if (child.kind === "update") {
                transcriptRuntime.activityUpdateComponents.get(child.id)?.invalidate?.();
            }
        }
    };
    transcriptRuntime.requestActivityRender = (group?: ActivityGroup): void => {
        if (group)
            transcriptRuntime.refreshActivityGroup(group);
        transcriptRuntime.currentTui?.requestRender?.();
    };
    transcriptRuntime.revealActivityGroup = (group: ActivityGroup, ui?: any): void => {
        transcriptRuntime.collapsedActivityGroups.delete(group.id);
        transcriptRuntime.revealedActivityGroups.add(group.id);
        for (const toolCallId of group.toolCallIds)
            transcriptRuntime.cleanCompactToolCallIds.add(toolCallId);
        transcriptRuntime.refreshActivityGroup(group);
        (ui ?? transcriptRuntime.currentTui)?.requestRender?.();
    };
    transcriptRuntime.collapseActivityGroup = (group: ActivityGroup, ui?: any): void => {
        transcriptRuntime.revealedActivityGroups.delete(group.id);
        if (transcriptRuntime.cleanToolsExpanded)
            transcriptRuntime.collapsedActivityGroups.add(group.id);
        else
            transcriptRuntime.collapsedActivityGroups.delete(group.id);
        for (const toolCallId of group.toolCallIds) {
            transcriptRuntime.cleanCompactToolCallIds.delete(toolCallId);
            const component = transcriptRuntime.toolComponents.get(toolCallId);
            if (component?.expanded)
                component.setExpanded(false);
        }
        for (const child of group.members)
            transcriptRuntime.expandedThinkingMembers.delete(child.id);
        transcriptRuntime.refreshActivityGroup(group);
        (ui ?? transcriptRuntime.currentTui)?.requestRender?.();
    };
}
