import { setAssistantPaneProjector } from "../integrated/ui-runtime.js";
import { RenderMemo } from "../shared/render-cache.js";
import { type Cancel } from "../shared/scheduler.js";
import { isNativeImageRow } from "./ansi-style.js";
import { frameNativeRows, nativeFrameWidth } from "./full-frame.js";
import { ThoughtPresentation } from "./thought-presentation.js";
import { AssistantMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ActivityTimeline, assistantMessageKey, assistantTerminalState, thinkingText, visibleAssistantText, type ActivityGroup, type ActivityMember, type ActivitySeverity, } from "./activity-timeline.js";
interface PatchState {
    readonly activityTimeline: ActivityTimeline;
    readonly refreshActivityGroup: (group: ActivityGroup) => void;
    currentTui: any;
    renderMode: "full" | "compact" | "clean";
    readonly defaultActivityTheme: () => any;
    readonly renderPendingActivityUpdate: (member: ActivityMember, width: number, component?: any) => string[];
    readonly mouseClickHitTests: WeakMap<object, (event: any) => boolean>;
    cleanToolsExpanded: boolean;
    fullThinkingHidden: boolean;
    compactThinkingHidden: boolean;
    readonly thinkingComponents: Map<string, any>;
    readonly activityUpdateComponents: Map<string, Component>;
    readonly renderActivityUpdateProjection: (group: ActivityGroup, member: ActivityMember, width: number, component?: any) => string[];
    readonly activityFallbackThemes: Map<string, any>;
    readonly activityMemberPosition: (group: ActivityGroup, member: ActivityMember) => {
        first: boolean;
        last: boolean;
    };
    readonly activityGroupRevealed: (group: ActivityGroup) => boolean;
    readonly renderActivityGroupSummary: (group: ActivityGroup, width: number, collapsedDone?: boolean) => string[];
    readonly activityGroupTheme: (group: ActivityGroup) => any;
    readonly activityTreeStyle: (group: ActivityGroup, member: ActivityMember, width: number, memberTheme?: any) => {
        prefix: any;
        continuation: any;
        childWidth: number;
        prefixWidth: number;
    };
    readonly expandedThinkingMembers: Set<string>;
    readonly activityGroupOwner: (group: ActivityGroup) => string | undefined;
    readonly settledSummaries: Map<string, {
        count: number;
        failed: number;
        thoughtCount: number;
        activity: string | (() => string);
    }>;
    readonly toolActivityHolds: Map<string, {
        toolCallId: string;
        name: string;
        until: number;
        after: string;
        started: boolean;
        timer?: Cancel;
    }>;
    readonly withActivityCollapse: (group: ActivityGroup, member: ActivityMember, width: number, lines: string[]) => string[];
    readonly withTranscriptMarkdown: <T>(callback: () => T) => T;
    readonly activityGroupCollapsible: (group: ActivityGroup) => boolean;
    readonly handleActivityUpdateMouse: (group: ActivityGroup, member: ActivityMember, event: any) => {
        handled: boolean;
    } | undefined;
    readonly revealActivityGroup: (group: ActivityGroup, ui?: any) => void;
    readonly activityCollapseClicked: (group: ActivityGroup, member: ActivityMember, event: any, row: number) => boolean;
    readonly collapseActivityGroup: (group: ActivityGroup, ui?: any) => void;
}
export function installAssistantMessages(pi: ExtensionAPI, state: PatchState): void {
    // Thinking and tools are peers in the transcript-first activity timeline.
    // Assistant components keep Pi's native visible-answer Markdown renderer.
    // All modes share thought content; only clean adds activity-group framing.
    const assistantPrototype = AssistantMessageComponent.prototype as any;
    const thinkingPatchKey = Symbol.for("pretty-tui.clean-thinking");
    if (!assistantPrototype[thinkingPatchKey]) {
        const originalUpdateContent = assistantPrototype.updateContent;
        const originalRender = assistantPrototype.render;
        const originalHandleMouse = assistantPrototype.handleMouse;
        const originalSetHideThinkingBlock = assistantPrototype.setHideThinkingBlock;
        const explicitThinkingVisibility = new WeakMap<object, boolean>();
        const originalMessageKey = Symbol("pretty-tui.original-assistant-message");
        const renderedModeKey = Symbol("pretty-tui.rendered-assistant-mode");
        const renderedExpansionKey = Symbol("pretty-tui.rendered-assistant-expansion");
        const thinkingRenderMemo = new RenderMemo<string[]>();
        const assistantTerminalUpdate = (message: any): ActivityMember | undefined => {
            if (!assistantTerminalState(message))
                return undefined;
            const hasToolCalls = Array.isArray(message?.content) &&
                message.content.some((item: any) => item?.type === "toolCall");
            // Failed tools already preserve the error in their native result details;
            // avoid duplicating that payload as a second durable member.
            if (hasToolCalls)
                return undefined;
            const key = `assistant-terminal:${assistantMessageKey(message)}`;
            const existing = state.activityTimeline.memberForUpdate(key);
            if (existing)
                return existing;
            const stopReason = message?.stopReason;
            const severity: ActivitySeverity = stopReason === "aborted" ? "warning" : "error";
            const title = stopReason === "length"
                ? "Response truncated"
                : stopReason === "aborted"
                    ? "Operation aborted"
                    : "Error";
            const content = String(message?.errorMessage ?? "").trim() ||
                (stopReason === "length" ? "Response was truncated before completion." : "Unknown error");
            state.activityTimeline.boundary();
            const member = state.activityTimeline.addPendingUpdate(key, title, content, true, severity);
            state.activityTimeline.boundary();
            return member;
        };
        const eligibleThinking = (message: any) => Array.isArray(message?.content) &&
            message.content.some((item: any) => item?.type === "thinking" &&
                typeof item.thinking === "string" &&
                item.thinking.length > 0);
        const refreshGroup = (group: ActivityGroup) => {
            state.refreshActivityGroup(group);
            state.currentTui?.requestRender?.();
        };
        const thoughtPresentation = new ThoughtPresentation();
        const fullThinkingVisibility = new WeakMap<object, boolean>();
        const patchedSetHideThinkingBlock = function (this: any, hide: boolean) {
            if (state.renderMode !== "clean")
                explicitThinkingVisibility.set(this, !hide);
            if (state.renderMode === "full")
                fullThinkingVisibility.set(this, !hide);
            return originalSetHideThinkingBlock.call(this, hide);
        };
        const panelAssistantViews = new WeakMap<object, {
            rows: Map<number, {
                sourceY: number;
                inset: number;
            }>;
            width: number;
            height: number;
        }>();
        const renderPanelAssistant = createRenderPanelAssistant({
            get originalRender() { return originalRender; },
            get state() { return state; },
            get originalMessageKey() { return originalMessageKey; },
            get assistantTerminalUpdate() { return assistantTerminalUpdate; },
            get panelAssistantViews() { return panelAssistantViews; }
        });
        const patchedUpdateContent = function (this: any, message: any, isStreaming = this.isStreaming) {
            setAssistantPaneProjector(this);
            this[originalMessageKey] = message;
            this[renderedModeKey] = state.renderMode;
            this[renderedExpansionKey] = state.cleanToolsExpanded;
            this.lastMessage = message;
            if (state.renderMode !== "clean") {
                this.hideThinkingBlock = state.renderMode === "full"
                    ? !(fullThinkingVisibility.get(this) ?? !state.fullThinkingHidden)
                    : !(explicitThinkingVisibility.get(this) ?? !state.compactThinkingHidden);
                originalUpdateContent.call(this, state.renderMode === "compact" && assistantTerminalState(message)
                    ? { ...message, errorMessage: undefined, stopReason: "stop" } : message, isStreaming);
                this.lastMessage = message;
                if (eligibleThinking(message))
                    state.thinkingComponents.set(assistantMessageKey(message), this);
                return;
            }
            const groupedThinking = eligibleThinking(message);
            if (groupedThinking) {
                const key = assistantMessageKey(message);
                state.activityTimeline.addThinking(key, thinkingText(message));
                state.thinkingComponents.set(key, this);
            }
            const previousHideThinkingBlock = this.hideThinkingBlock;
            this.hideThinkingBlock = false;
            // Shared thought presentation owns thinking completely. Removing it from
            // Pi's native content tree also removes the native MouseRegion that would
            // otherwise toggle a second, unrelated `Thinking...` block.
            const displayMessage = groupedThinking && Array.isArray(message?.content)
                ? { ...message, content: message.content.filter((item: any) => item.type !== "thinking") }
                : message;
            try {
                originalUpdateContent.call(this, assistantTerminalState(message)
                    ? { ...displayMessage, errorMessage: undefined, stopReason: "stop" }
                    : displayMessage, isStreaming);
            }
            finally {
                this.hideThinkingBlock = previousHideThinkingBlock;
            }
            this.lastMessage = message;
            if (groupedThinking) {
                const owner = this;
                const activity: Component = {
                    render: width => state.withTranscriptMarkdown(() => renderAssistantTranscript.call(owner, width, "activity")),
                    invalidate: () => owner.invalidate(),
                    handleMouse: event => patchedHandleMouse.call(owner, event),
                };
                const chat: Component = {
                    render: width => state.withTranscriptMarkdown(() => renderAssistantTranscript.call(owner, width, "chat")),
                    invalidate: () => owner.invalidate(),
                    handleMouse: event => {
                        const terminal = assistantTerminalUpdate(message);
                        const offset = terminal ? state.renderPendingActivityUpdate(terminal, event.width).length : 0;
                        if (event.y >= offset && visibleAssistantText(message))
                            return originalHandleMouse?.call(owner, { ...event, y: event.y - offset });
                        return undefined;
                    },
                };
                setAssistantPaneProjector(owner, () => {
                    if (state.renderMode !== "clean" || assistantPrototype.updateContent !== patchedUpdateContent) return undefined;
                    return {
                        revision: message, activity,
                        chat: visibleAssistantText(message) || assistantTerminalState(message) ? chat : undefined,
                        thinking: thinkingText(message),
                        text: [visibleAssistantText(message), assistantTerminalState(message) ? message.errorMessage : ""].filter(Boolean).join("\n\n"),
                        reveal: () => {
                            const member = state.activityTimeline.memberForThinking(assistantMessageKey(message));
                            const group = member && state.activityTimeline.groupForMember(member.id);
                            if (member && group) {
                                state.expandedThinkingMembers.add(member.id);
                                state.revealActivityGroup(group);
                            }
                        },
                    };
                });
            }
        };
        const renderAssistantTranscript = createRenderAssistantTranscript({
            get originalMessageKey() { return originalMessageKey; },
            get renderedModeKey() { return renderedModeKey; },
            get state() { return state; },
            get renderedExpansionKey() { return renderedExpansionKey; },
            get patchedUpdateContent() { return patchedUpdateContent; },
            get renderPanelAssistant() { return renderPanelAssistant; },
            get assistantTerminalUpdate() { return assistantTerminalUpdate; },
            get eligibleThinking() { return eligibleThinking; },
            get originalRender() { return originalRender; },
            get explicitThinkingVisibility() { return explicitThinkingVisibility; },
            get thinkingRenderMemo() { return thinkingRenderMemo; },
            get thoughtPresentation() { return thoughtPresentation; }
        });
        const patchedRender = function (this: any, width: number): string[] {
            return state.withTranscriptMarkdown(() => renderAssistantTranscript.call(this, width));
        };
        const handleAssistantTranscriptMouse = function (this: any, event: any) {
            const message = this[originalMessageKey] ?? this.lastMessage;
            if (state.renderMode !== "clean") {
                patchedRender.call(this, event.width);
                const view = panelAssistantViews.get(this);
                const row = view?.rows.get(event.y);
                if (!view || !row)
                    return undefined;
                return originalHandleMouse.call(this, { ...event,
                    x: Math.max(0, event.x - row.inset), y: row.sourceY, width: view.width, height: view.height,
                });
            }
            if (!eligibleThinking(message)) {
                const terminalMember = assistantTerminalUpdate(message);
                const terminalGroup = terminalMember
                    ? state.activityTimeline.groupForMember(terminalMember.id)
                    : undefined;
                return terminalMember && terminalGroup && state.activityGroupCollapsible(terminalGroup)
                    ? state.handleActivityUpdateMouse(terminalGroup, terminalMember, event)
                    : originalHandleMouse.call(this, event);
            }
            const key = assistantMessageKey(message);
            const member = state.activityTimeline.memberForThinking(key);
            const group = member ? state.activityTimeline.groupForMember(member.id) : undefined;
            if (!member || !group)
                return originalHandleMouse.call(this, event);
            const position = state.activityMemberPosition(group, member);
            const isLeftClick = event.type === "click" && event.button === "left";
            // A completed assistant message can contain both the final Thought and
            // visible Markdown. The Markdown is rendered after the activity rows;
            // route clicks in that suffix back to Pi's native component so links,
            // text selection, and code-block Copy controls keep working.
            let activityHeight: number | undefined;
            if (visibleAssistantText(message)) {
                const visibleLines = originalRender.call(this, event.width);
                const renderedLines = patchedRender.call(this, event.width);
                activityHeight = Math.max(0, renderedLines.length - visibleLines.length);
                if (event.y >= activityHeight) {
                    return originalHandleMouse.call(this, {
                        ...event,
                        y: event.y - activityHeight,
                        height: visibleLines.length,
                    });
                }
            }
            if (!state.activityGroupRevealed(group)) {
                if (!isLeftClick)
                    return undefined;
                if (position.first)
                    state.revealActivityGroup(group);
                return { handled: true };
            }
            const summaryHeight = position.first ? state.renderActivityGroupSummary(group, event.width).length : 0;
            const collapseRow = position.last
                ? (activityHeight ?? patchedRender.call(this, event.width).length) - 1
                : -1;
            if ((position.first && event.y > 0 && event.y <= summaryHeight && isLeftClick) ||
                state.activityCollapseClicked(group, member, event, collapseRow)) {
                state.collapseActivityGroup(group);
                return { handled: true };
            }
            if (position.last && event.y === collapseRow)
                return undefined;
            if (isLeftClick) {
                if (state.expandedThinkingMembers.has(member.id))
                    state.expandedThinkingMembers.delete(member.id);
                else
                    state.expandedThinkingMembers.add(member.id);
                refreshGroup(group);
                return { handled: true };
            }
            return undefined;
        };
        const patchedHandleMouse = function (this: any, event: any) {
            return state.withTranscriptMarkdown(() => handleAssistantTranscriptMouse.call(this, event));
        };
        assistantPrototype[thinkingPatchKey] = {
            originalUpdateContent,
            patchedUpdateContent,
            originalRender,
            patchedRender,
            originalHandleMouse,
            patchedHandleMouse,
        };
        assistantPrototype.setHideThinkingBlock = patchedSetHideThinkingBlock;
        assistantPrototype.updateContent = patchedUpdateContent;
        assistantPrototype.render = patchedRender;
        assistantPrototype.handleMouse = patchedHandleMouse;
        pi.on("session_shutdown", () => {
            const patch = assistantPrototype[thinkingPatchKey];
            if (!patch)
                return;
            if (assistantPrototype.setHideThinkingBlock === patchedSetHideThinkingBlock) {
                assistantPrototype.setHideThinkingBlock = originalSetHideThinkingBlock;
            }
            if (patch.patchedUpdateContent === assistantPrototype.updateContent) {
                assistantPrototype.updateContent = patch.originalUpdateContent;
            }
            if (patch.patchedRender === assistantPrototype.render) {
                assistantPrototype.render = patch.originalRender;
            }
            if (patch.patchedHandleMouse === assistantPrototype.handleMouse) {
                assistantPrototype.handleMouse = patch.originalHandleMouse;
            }
            if (assistantPrototype.updateContent === patch.originalUpdateContent &&
                assistantPrototype.render === patch.originalRender &&
                assistantPrototype.handleMouse === patch.originalHandleMouse) {
                delete assistantPrototype[thinkingPatchKey];
            }
        });
    }
}
function createRenderPanelAssistant(dependencies: {
    readonly originalRender: any;
    readonly state: PatchState;
    readonly originalMessageKey: symbol;
    readonly assistantTerminalUpdate: (message: any) => ActivityMember | undefined;
    readonly panelAssistantViews: WeakMap<object, {
        rows: Map<number, {
            sourceY: number;
            inset: number;
        }>;
        width: number;
        height: number;
    }>;
}) {
    return function (this: any, width: number): string[] {
        const innerWidth = nativeFrameWidth(width);
        const nativeLines = dependencies.originalRender.call(this, innerWidth);
        const rows = new Map<number, {
            sourceY: number;
            inset: number;
        }>();
        const thoughtRows = new Set<number>();
        const output: string[] = [];
        const children = this.contentContainer.children;
        let sourceY = 0;
        let thoughtRun = 0;
        const previews: string[] = [];
        if (dependencies.state.renderMode === "compact") {
            const message = this[dependencies.originalMessageKey] ?? this.lastMessage;
            let run: string[] = [];
            const finishRun = () => {
                if (run.length)
                    previews.push(run.join("\n\n").split(/\r\n|\r|\n/).find((line) => line.trim())?.trim() ?? "");
                run = [];
            };
            for (const item of message?.content ?? []) {
                if (item.type === "thinking") {
                    if (item.thinking?.trim())
                        run.push(item.thinking.trim());
                }
                else
                    finishRun();
            }
            finishRun();
        }
        for (let index = 0; index < children.length; index++) {
            const child = children[index];
            const childLines = child.render(innerWidth);
            const isThought = Boolean(child.onMouse && child.child);
            if (isThought || child instanceof Markdown && childLines.length) {
                let height = childLines.length;
                // Adjacent native text blocks belong to the same answer card. Keep
                // native paragraph order and source coordinates, not copied text.
                if (!isThought) {
                    while (children[index + 1] instanceof Markdown) {
                        height += children[++index].render(innerWidth).length;
                    }
                }
                const runIndex = thoughtRun;
                const hidden = isThought && (this.thinkingVisibilityOverrides.get(thoughtRun++) ?? this.hideThinkingBlock);
                const source = dependencies.state.renderMode === "compact" && hidden
                    ? [dependencies.state.defaultActivityTheme().fg("thinkingText", truncateToWidth(previews[runIndex] ?? "", innerWidth, "…"))]
                    : nativeLines.slice(sourceY, sourceY + height);
                const role = isThought ? "mdLink" : "text";
                const baseLabel = isThought ? this.isStreaming ? "thinking" : "thought" : "Assistant";
                const label = isThought && dependencies.state.renderMode === "compact" ? `${baseLabel} ${hidden ? "▸" : "▾"}` : baseLabel;
                const frame = frameNativeRows(label, source, width, dependencies.state.defaultActivityTheme(), undefined, child, role, "", role);
                for (const [y, nativeY] of frame.sourceRows) {
                    rows.set(output.length + y, { sourceY: sourceY + nativeY, inset: frame.inset });
                    if (isThought)
                        thoughtRows.add(output.length + y);
                }
                if (isThought && height) {
                    rows.set(output.length, { sourceY, inset: frame.inset });
                    thoughtRows.add(output.length);
                }
                output.push(...frame.lines);
                sourceY += height;
            }
            else {
                for (let y = 0; y < childLines.length; y++)
                    rows.set(output.length + y, { sourceY: sourceY + y, inset: 0 });
                output.push(...nativeLines.slice(sourceY, sourceY + childLines.length));
                sourceY += childLines.length;
            }
        }
        if (dependencies.state.renderMode === "compact") {
            const terminal = dependencies.assistantTerminalUpdate(this[dependencies.originalMessageKey] ?? this.lastMessage);
            if (terminal)
                output.push(...dependencies.state.renderPendingActivityUpdate(terminal, width, this));
        }
        dependencies.panelAssistantViews.set(this, { rows, width: innerWidth, height: nativeLines.length });
        dependencies.state.mouseClickHitTests.set(this, (event) => thoughtRows.has(event.y));
        return dependencies.state.renderMode === "compact" && width < 8
            ? output.map((line) => isNativeImageRow(line) ? line : truncateToWidth(line, Math.max(1, width), "")) : output;
    };
}
function createRenderAssistantTranscript(dependencies: {
    readonly originalMessageKey: symbol;
    readonly renderedModeKey: symbol;
    readonly state: PatchState;
    readonly renderedExpansionKey: symbol;
    readonly patchedUpdateContent: (this: any, message: any, isStreaming?: any) => void;
    readonly renderPanelAssistant: (this: any, width: number) => string[];
    readonly assistantTerminalUpdate: (message: any) => ActivityMember | undefined;
    readonly eligibleThinking: (message: any) => any;
    readonly originalRender: any;
    readonly explicitThinkingVisibility: WeakMap<object, boolean>;
    readonly thinkingRenderMemo: RenderMemo<string[]>;
    readonly thoughtPresentation: ThoughtPresentation;
}) {
    return function (this: any, width: number, pane: "combined" | "chat" | "activity" = "combined"): string[] {
        const message = this[dependencies.originalMessageKey] ?? this.lastMessage;
        if (message &&
            (this[dependencies.renderedModeKey] !== dependencies.state.renderMode || this[dependencies.renderedExpansionKey] !== dependencies.state.cleanToolsExpanded)) {
            dependencies.patchedUpdateContent.call(this, message, this.isStreaming);
        }
        if (dependencies.state.renderMode !== "clean")
            return dependencies.renderPanelAssistant.call(this, width);
        const terminalMember = dependencies.assistantTerminalUpdate(message);
        if (!dependencies.eligibleThinking(message)) {
            if (pane === "activity") return [];
            if (!terminalMember)
                return dependencies.originalRender.call(this, width);
            const terminalGroup = dependencies.state.activityTimeline.groupForMember(terminalMember.id);
            if (!terminalGroup)
                return dependencies.originalRender.call(this, width);
            dependencies.state.activityUpdateComponents.set(terminalMember.id, this);
            return [
                ...dependencies.state.renderActivityUpdateProjection(terminalGroup, terminalMember, width, this),
                ...(visibleAssistantText(message) ? dependencies.originalRender.call(this, width) : []),
            ];
        }
        const key = assistantMessageKey(message);
        const member = dependencies.state.activityTimeline.memberForThinking(key);
        const group = member ? dependencies.state.activityTimeline.groupForMember(member.id) : undefined;
        if (!member || !group) {
            // Timeline ownership can be briefly unavailable during transcript
            // rebuilds. Fail open to Pi's filtered native renderer so visible
            // assistant text is never lost.
            return dependencies.originalRender.call(this, width);
        }
        dependencies.state.thinkingComponents.set(key, this);
        if (!dependencies.state.activityFallbackThemes.has(group.id)) {
            dependencies.state.activityFallbackThemes.set(group.id, dependencies.state.defaultActivityTheme());
        }
        const position = dependencies.state.activityMemberPosition(group, member);
        const visibleLines = visibleAssistantText(message) ? dependencies.originalRender.call(this, width) : [];
        // Native errors are filtered above; append the shared alert exactly once
        // while preserving any partial visible answer outside the thought block.
        const terminalLines = terminalMember
            ? dependencies.state.renderPendingActivityUpdate(terminalMember, width)
            : [];
        const appendTail = (activityLines: string[]) => {
            dependencies.state.mouseClickHitTests.set(this, (event) => dependencies.state.renderMode === "clean" &&
                event.y >= (position.first ? 1 : 0) && event.y < activityLines.length);
            return [
                ...(pane === "chat" ? [] : activityLines),
                ...(pane === "activity" ? [] : terminalLines),
                ...(pane === "activity" ? [] : visibleLines),
            ];
        };
        const revealed = dependencies.state.activityGroupRevealed(group);
        if (!revealed) {
            const activityLines = position.first
                ? ["", ...dependencies.state.renderActivityGroupSummary(group, width, true)]
                : [];
            return appendTail(activityLines);
        }
        const groupTheme = dependencies.state.activityGroupTheme(group);
        const { prefix, continuation, childWidth } = dependencies.state.activityTreeStyle(group, member, width, groupTheme);
        // Clean mode owns thought disclosure: revealing a group shows the thought
        // member, while only a member click (or Ctrl+O) reveals its full text.
        const expanded = dependencies.state.expandedThinkingMembers.has(member.id) || (dependencies.explicitThinkingVisibility.get(this) ?? dependencies.state.cleanToolsExpanded);
        const settledOwner = position.first ? dependencies.state.activityGroupOwner(group) : undefined;
        // A group without tools has no durable summary, so its own boundary is
        // the signal that it finished.
        const stableSummary = !position.first || (settledOwner
            ? Boolean(dependencies.state.settledSummaries.has(settledOwner) && !dependencies.state.toolActivityHolds.has(settledOwner))
            : dependencies.state.activityTimeline.isSettled(group.id));
        const cacheable = !expanded && !this.isStreaming && stableSummary;
        const cacheInputs = [width, message, groupTheme, group.members.length, position.last];
        const cached = cacheable ? dependencies.thinkingRenderMemo.read(this, cacheInputs) : undefined;
        if (cached)
            return appendTail(cached);
        const stateLabel = this.isStreaming ? "thinking" : "thought";
        const header = dependencies.thoughtPresentation.header(stateLabel, childWidth, groupTheme);
        let contentLines: string[] = [header];
        if (expanded) {
            contentLines.push(...dependencies.thoughtPresentation.details(this, member.thinking ?? thinkingText(message), groupTheme, Math.max(1, childWidth - visibleWidth("  │ "))));
        }
        const decorated = contentLines.map((line, index) => truncateToWidth((index === 0 ? prefix : continuation) + line, Math.max(1, width), ""));
        const output = dependencies.state.withActivityCollapse(group, member, width, position.first ? ["", ...dependencies.state.renderActivityGroupSummary(group, width), ...decorated] : decorated);
        if (cacheable) {
            dependencies.thinkingRenderMemo.write(this, cacheInputs, output);
        }
        return appendTail(output);
    };
}
