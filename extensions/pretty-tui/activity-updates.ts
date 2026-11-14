import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type ActivityGroup, type ActivityMember, type ActivitySeverity } from "./activity-timeline.js";
import type { TranscriptRuntime } from "./runtime-types.js";
export function initializeActivityUpdates(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.activityTreeStyle = (group: ActivityGroup, member: ActivityMember, width: number, memberTheme?: any) => {
        const { last } = transcriptRuntime.activityMemberPosition(group, member);
        // While expanded, the collapse action is the final sibling in the tree.
        const hasFollowingCollapse = last && transcriptRuntime.activityGroupRevealed(group);
        const rawPrefix = last && !hasFollowingCollapse ? "  └─ " : "  ├─ ";
        const rawContinuation = last && !hasFollowingCollapse ? "     " : "  │  ";
        const prefixWidth = visibleWidth(rawPrefix);
        if (width <= prefixWidth) {
            return { prefix: "", continuation: "", childWidth: Math.max(1, width), prefixWidth: 0 };
        }
        const resolvedTheme = memberTheme ?? transcriptRuntime.activityGroupTheme(group);
        return {
            prefix: resolvedTheme ? resolvedTheme.fg("dim", rawPrefix) : rawPrefix,
            continuation: resolvedTheme ? resolvedTheme.fg("dim", rawContinuation) : rawContinuation,
            childWidth: Math.max(1, width - prefixWidth),
            prefixWidth,
        };
    };
    transcriptRuntime.humanizeCustomType = (value: string): string => value
        .split(/[-_\s]+/u)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ") || "Update";
    transcriptRuntime.renderActivityUpdateMarkdown = (member: ActivityMember, width: number, theme: any): string[] => {
        const content = member.updateContent ?? "";
        if (!content)
            return [];
        let cached = transcriptRuntime.activityUpdateMarkdownComponents.get(member.id);
        if (!cached || cached.content !== content || cached.theme !== theme) {
            cached = {
                content,
                theme,
                component: new Markdown(content, 0, 0, getMarkdownTheme(), { color: (text: string) => theme.fg("muted", text) }),
            };
            transcriptRuntime.activityUpdateMarkdownComponents.set(member.id, cached);
        }
        const lines = transcriptRuntime.withTranscriptMarkdown(() => cached.component.render(Math.max(1, width)));
        while (lines.length > 0 && stripTerminalSequences(lines[lines.length - 1]).trim() === "") {
            lines.pop();
        }
        return lines;
    };
    transcriptRuntime.activityUpdateStyle = (member: ActivityMember, theme: any) => {
        const severity = member.updateSeverity ?? "info";
        const styles: Record<ActivitySeverity, {
            icon: string;
            color: string;
        }> = {
            info: { icon: "◇", color: "accent" },
            warning: { icon: "⚠", color: "warning" },
            error: { icon: "✕", color: "error" },
        };
        const style = styles[severity];
        return {
            severity,
            icon: theme.fg(style.color, `${style.icon} `),
            title: (text: string) => theme.fg(style.color, theme.bold(text)),
        };
    };
    transcriptRuntime.renderActivityUpdate = (group: ActivityGroup, member: ActivityMember, width: number, theme = transcriptRuntime.activityGroupTheme(group)): string[] => {
        if (transcriptRuntime.renderMode !== "clean" || !transcriptRuntime.activityGroupRevealed(group))
            return [];
        const { prefix, continuation, childWidth } = transcriptRuntime.activityTreeStyle(group, member, width, theme);
        const title = truncateToWidth(member.updateTitle ?? "Update", Math.max(1, childWidth - 2), "…");
        const style = transcriptRuntime.activityUpdateStyle(member, theme);
        const lines = [style.icon + style.title(title)];
        if (member.updateContent) {
            const detailWidth = Math.max(1, childWidth - visibleWidth("  │ "));
            const detailLines = transcriptRuntime.renderActivityUpdateMarkdown(member, detailWidth, theme);
            lines.push(...detailLines.map((line, index) => theme.fg("dim", index === detailLines.length - 1 ? "  └ " : "  │ ") + line));
        }
        const decorated = lines.map((line, index) => truncateToWidth((index === 0 ? prefix : continuation) + line, Math.max(1, width), ""));
        const position = transcriptRuntime.activityMemberPosition(group, member);
        return transcriptRuntime.withActivityCollapse(group, member, width, position.first ? ["", ...transcriptRuntime.renderActivityGroupSummary(group, width), ...decorated] : decorated);
    };
    transcriptRuntime.renderStandaloneError = (member: ActivityMember, width: number, component?: any): string[] => {
        const run = component && transcriptRuntime.renderMode !== "full" ? transcriptRuntime.errorRun(component) : { hidden: false, count: 1, compact: false };
        if (run.hidden)
            return [];
        const theme = transcriptRuntime.defaultActivityTheme();
        const style = transcriptRuntime.activityUpdateStyle(member, theme);
        const original = component ? transcriptRuntime.errorDescriptor(component) : undefined;
        const title = stripTerminalSequences(original?.title ?? member.updateTitle ?? "Error");
        const content = stripTerminalSequences(original?.content || member.updateContent || "");
        const heading = style.icon + style.title(title);
        const prefix = heading + (content ? theme.fg("dim", " · ") : "");
        const text = prefix + theme.fg("muted", content) + (run.count > 1 ? theme.fg("dim", ` ×${run.count}`) : "");
        // Wrap rather than truncate; all original detail lines remain accessible.
        const continuation = " ".repeat(Math.min(visibleWidth(prefix), Math.max(0, Math.floor(width / 3))));
        const rows: string[] = [];
        for (const line of text.split("\n")) {
            const wrapped = wrapTextWithAnsi(line, Math.max(1, width - visibleWidth(continuation)));
            rows.push(...wrapped.map((row, index) => (rows.length || index ? continuation : "") + row));
        }
        return [...(run.compact ? [] : [""]), ...rows.map((line) => truncateToWidth(line, Math.max(1, width), ""))];
    };
    transcriptRuntime.renderPendingActivityUpdate = (member: ActivityMember, width: number, component?: any): string[] => {
        if (member.updateSeverity === "error" && member.updateTitle !== "Response truncated") {
            return transcriptRuntime.renderStandaloneError(member, width, component);
        }
        const theme = transcriptRuntime.defaultActivityTheme();
        const title = truncateToWidth(member.updateTitle ?? "Update", Math.max(1, width - 2), "…");
        const style = transcriptRuntime.activityUpdateStyle(member, theme);
        const lines = [style.icon + style.title(title)];
        if (member.updateContent) {
            const detailWidth = Math.max(1, width - visibleWidth("  │ "));
            const details = transcriptRuntime.renderActivityUpdateMarkdown(member, detailWidth, theme);
            lines.push(...details.map((line, index) => theme.fg("dim", index === details.length - 1 ? "  └ " : "  │ ") + line));
        }
        return ["", ...lines.map((line) => truncateToWidth(line, Math.max(1, width), ""))];
    };
    transcriptRuntime.renderActivityUpdateProjection = (group: ActivityGroup, member: ActivityMember, width: number, component?: any): string[] => {
        if (transcriptRuntime.renderMode !== "clean" || !transcriptRuntime.activityGroupCollapsible(group))
            return transcriptRuntime.renderPendingActivityUpdate(member, width, component);
        const position = transcriptRuntime.activityMemberPosition(group, member);
        if (!transcriptRuntime.activityGroupRevealed(group)) {
            return position.first
                ? ["", ...transcriptRuntime.renderActivityGroupSummary(group, width, true)]
                : [];
        }
        return transcriptRuntime.renderActivityUpdate(group, member, width);
    };
    transcriptRuntime.handleActivityUpdateMouse = (group: ActivityGroup, member: ActivityMember, event: any) => {
        const isLeftClick = event.type === "click" && event.button === "left";
        if (transcriptRuntime.renderMode !== "clean" || !isLeftClick || !transcriptRuntime.activityGroupCollapsible(group))
            return undefined;
        const position = transcriptRuntime.activityMemberPosition(group, member);
        if (!transcriptRuntime.activityGroupRevealed(group)) {
            if (!position.first)
                return undefined;
            transcriptRuntime.revealActivityGroup(group);
            return { handled: true };
        }
        const summaryHeight = position.first ? transcriptRuntime.renderActivityGroupSummary(group, event.width).length : 0;
        const onSummary = position.first && event.y > 0 && event.y <= summaryHeight;
        const onCollapse = position.last && transcriptRuntime.activityCollapseClicked(group, member, event, transcriptRuntime.renderActivityUpdate(group, member, event.width).length - 1);
        if (!onSummary && !onCollapse)
            return undefined;
        transcriptRuntime.collapseActivityGroup(group);
        return { handled: true };
    };
}
