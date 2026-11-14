import { RenderMemo } from "../shared/render-cache.js";
import { isThirdPartyTool, renderToolProjection, toolLabel, type ToolProjection } from "../shared/tool-presentation.js";
import { NestedTools } from "./nested-tools.js";
import { ToolExecutionComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { ActivityTimeline, type ActivityGroup, type ActivityMember } from "./activity-timeline.js";
interface PatchState {
    readonly nestedTools: NestedTools;
    renderMode: "full" | "compact" | "clean";
    readonly revealActivityGroup: (group: ActivityGroup, ui?: any) => void;
    readonly collapseActivityGroup: (group: ActivityGroup, ui?: any) => void;
    readonly activityTimeline: ActivityTimeline;
    readonly cleanRun: {
        activeToolCallId?: string;
        lastCompletedToolCallId?: string;
        activeToolName?: string;
        activity?: string;
        requestRender?: () => void;
        count: number;
        failed: number;
        currentToolCallIds: string[];
        activeToolCallIds: Set<string>;
        groups: {
            count: number;
            failed: number;
            thoughtCount?: number;
            lastToolCallId: string;
            toolCallIds?: string[];
            activity?: string;
        }[];
        active: boolean;
        settled: boolean;
    };
    readonly cleanToolNames: Map<string, string>;
    readonly setCleanGroupMembers: (lastToolCallId: string, toolCallIds: string[]) => void;
    readonly beginToolActivity: (toolCallId: string, name: string, started?: boolean) => void;
    changingAllToolsExpansion: boolean;
    readonly activityGroupRevealed: (group: ActivityGroup) => boolean;
    readonly toolComponents: Map<string, any>;
    readonly knownToolCallIds: Set<string>;
    readonly defaultActivityTheme: () => any;
    readonly mouseClickHitTests: WeakMap<object, (event: any) => boolean>;
    readonly activityMemberPosition: (group: ActivityGroup, member: ActivityMember) => {
        first: boolean;
        last: boolean;
    };
    readonly renderActivityGroupSummary: (group: ActivityGroup, width: number, collapsedDone?: boolean) => string[];
    readonly activityCollapseClicked: (group: ActivityGroup, member: ActivityMember, event: any, row: number) => boolean;
    readonly cleanThemeForToolCall: (toolCallId: string) => any;
    readonly activityGroupTheme: (group: ActivityGroup) => any;
    readonly activityTreeStyle: (group: ActivityGroup, member: ActivityMember, width: number, memberTheme?: any) => {
        prefix: any;
        continuation: any;
        childWidth: number;
        prefixWidth: number;
    };
    readonly withActivityCollapse: (group: ActivityGroup, member: ActivityMember, width: number, lines: string[]) => string[];
}
export function installToolComponents(pi: ExtensionAPI, state: PatchState): void {
    // A tool component can be created from the streamed assistant message
    // before Pi dispatches tool_execution_start. Mark its activity at the
    // component's own execution boundary too, so the first clean render names it.
    const toolExecutionPrototype = ToolExecutionComponent.prototype as any;
    const toolExecutionPatchKey = Symbol.for("pretty-tui.clean-tool-execution");
    if (!toolExecutionPrototype[toolExecutionPatchKey]) {
        const originalMarkExecutionStarted = toolExecutionPrototype.markExecutionStarted;
        const originalSetExpanded = toolExecutionPrototype.setExpanded;
        const originalToolRender = toolExecutionPrototype.render;
        const originalToolHandleMouse = toolExecutionPrototype.handleMouse;
        const renderedModeKey = Symbol("pretty-tui.tool-rendered-mode");
        const toolRenderMemo = new RenderMemo<string[]>();
        const standaloneViews = new WeakMap<object, {
            projection: ToolProjection;
            offset: number;
            width: number;
        }>();
        const projectTool = (owner: any, width: number, theme: any, mode: "compact" | "full") => renderToolProjection(owner, width, theme, {
            mode, nested: state.nestedTools, nestedExpanded: Boolean(owner.expanded), panels: state.renderMode !== "clean",
            renderNative: (nativeWidth) => originalToolRender.call(owner, nativeWidth),
        });
        const handleProjectionMouse = (owner: any, projection: ToolProjection, event: any) => {
            const isClick = event.type === "click" && event.button === "left";
            const action = projection.actions.get(event.y);
            if (isClick && action) {
                state.nestedTools.toggle(action, Boolean(owner.expanded));
                owner.updateDisplay?.();
                owner.ui?.requestRender?.();
                return { handled: true };
            }
            if (isClick && projection.toggleRows.has(event.y)) {
                originalSetExpanded.call(owner, !owner.expanded);
                owner.ui?.requestRender?.();
                return { handled: true };
            }
            const native = projection.native;
            const sourceY = projection.sourceRows?.get(event.y);
            if (native && (projection.sourceRows ? sourceY !== undefined : event.y >= native.y && event.y < native.y + native.height)) {
                return originalToolHandleMouse.call(owner, {
                    ...event, x: Math.max(0, event.x - native.x),
                    y: sourceY ?? event.y - native.y + native.sourceY,
                    width: native.width, height: native.height + native.sourceY,
                });
            }
            // Projected rows must never be interpreted as native renderer rows.
            return isClick ? { handled: true } : undefined;
        };
        const revealCleanGroup = state.revealActivityGroup;
        const collapseCleanGroup = state.collapseActivityGroup;
        const patchedMarkExecutionStarted = function (this: any) {
            state.activityTimeline.addTool(this.toolCallId, this.toolName);
            if (!state.cleanRun.currentToolCallIds.includes(this.toolCallId)) {
                state.cleanRun.currentToolCallIds.push(this.toolCallId);
            }
            state.cleanRun.activeToolCallIds.add(this.toolCallId);
            const displayName = toolLabel(this.toolName, this.toolDefinition?.label);
            state.cleanToolNames.set(this.toolCallId, displayName);
            state.setCleanGroupMembers(this.toolCallId, state.cleanRun.currentToolCallIds.slice());
            if (typeof this.ui?.requestRender === "function") {
                state.cleanRun.requestRender = () => this.ui.requestRender();
            }
            state.cleanRun.active = true;
            state.cleanRun.activeToolCallId = this.toolCallId;
            state.beginToolActivity(this.toolCallId, displayName, true);
            return originalMarkExecutionStarted.call(this);
        };
        const patchedSetExpanded = function (this: any, expanded: boolean) {
            const group = state.activityTimeline.groupForTool(this.toolCallId);
            if (state.renderMode === "clean" &&
                !state.changingAllToolsExpansion &&
                expanded &&
                !this.expanded &&
                group &&
                !state.activityGroupRevealed(group)) {
                revealCleanGroup(group, this.ui);
                return;
            }
            return originalSetExpanded.call(this, expanded);
        };
        const patchedToolRender = function (this: any, width: number): string[] {
            state.toolComponents.set(this.toolCallId, this);
            state.knownToolCallIds.add(this.toolCallId);
            const member = state.activityTimeline.addTool(this.toolCallId, this.toolName);
            state.cleanToolNames.set(this.toolCallId, toolLabel(this.toolName, this.toolDefinition?.label));
            if (this[renderedModeKey] !== state.renderMode) {
                this[renderedModeKey] = state.renderMode;
                this.updateDisplay();
            }
            const group = state.activityTimeline.groupForMember(member.id);
            if (state.renderMode !== "clean" || !group) {
                const projection = state.renderMode !== "clean"
                    ? projectTool(this, width, state.defaultActivityTheme(), state.renderMode)
                    : undefined;
                if (!projection) {
                    standaloneViews.delete(this);
                    state.mouseClickHitTests.delete(this);
                    return originalToolRender.call(this, width);
                }
                const offset = state.renderMode === "full" ? 2 : 1;
                standaloneViews.set(this, { projection, offset, width });
                state.mouseClickHitTests.set(this, (event) => event.width === width && (projection.actions.has(event.y - offset) || projection.toggleRows.has(event.y - offset) ||
                    Boolean(projection.sourceRows?.has(event.y - offset))));
                return [...Array<string>(offset).fill(""), ...projection.lines];
            }
            standaloneViews.delete(this);
            const position = state.activityMemberPosition(group, member);
            let renderedHeight = 0;
            let nestedClickActions: Map<number, string> | undefined;
            const renderedSummaryHeight = position.first ? state.renderActivityGroupSummary(group, width).length : 0;
            state.mouseClickHitTests.set(this, (event) => {
                if (state.renderMode !== "clean")
                    return false;
                if (event.width !== width)
                    return false;
                const summaryHeight = renderedSummaryHeight;
                if (position.first && event.y > 0 && event.y <= summaryHeight)
                    return true;
                if (!state.activityGroupRevealed(group))
                    return false;
                const height = renderedHeight;
                if (position.last && event.y === height - 1) {
                    return state.activityCollapseClicked(group, member, { ...event, type: "click", button: "left" }, height - 1);
                }
                const contentY = event.y - (position.first ? summaryHeight + 1 : 0);
                if (nestedClickActions)
                    return nestedClickActions.has(contentY);
                return contentY >= 0 && event.y < height - (position.last ? 1 : 0);
            });
            if (!state.activityGroupRevealed(group)) {
                const lines = position.first ? ["", ...state.renderActivityGroupSummary(group, width, true)] : [];
                renderedHeight = lines.length;
                return lines;
            }
            const childTheme = state.cleanThemeForToolCall(this.toolCallId) ?? state.activityGroupTheme(group);
            const { prefix: childPrefix, continuation, childWidth, } = state.activityTreeStyle(group, member, width, childTheme);
            // Other extensions (notably FFF in override mode) can register their own
            // grep/find renderers under built-in names. Their default boxed shell is
            // not one of our self-rendering specialized tools.
            const cacheable = state.nestedTools.count(this.toolCallId) === 0 && !this.expanded && Boolean(this.result) && !this.isPartial;
            const cacheInputs = [width, childWidth, this.result, this.args, this.callRendererComponent,
                this.resultRendererComponent, childTheme, position.last, group.members.length];
            const cached = cacheable ? toolRenderMemo.read(this, cacheInputs) : undefined;
            let decoratedContent: string[];
            if (cached) {
                decoratedContent = cached;
            }
            else {
                let contentLines: string[];
                const projection = projectTool(this, childWidth, childTheme, "compact");
                if (projection) {
                    contentLines = projection.lines;
                    if (state.nestedTools.count(this.toolCallId) > 0)
                        nestedClickActions = projection.actions;
                }
                else {
                    const lines = originalToolRender.call(this, childWidth);
                    if (lines.length === 0)
                        return lines;
                    contentLines = lines[0] === "" ? lines.slice(1) : lines;
                }
                decoratedContent = contentLines.map((line: string, index: number) => truncateToWidth((index === 0 ? childPrefix : continuation) + line, Math.max(1, width), ""));
                if (cacheable) {
                    toolRenderMemo.write(this, cacheInputs, decoratedContent);
                }
            }
            const lines = state.withActivityCollapse(group, member, width, position.first ? ["", ...state.renderActivityGroupSummary(group, width), ...decoratedContent] : decoratedContent);
            renderedHeight = lines.length;
            return lines;
        };
        const patchedToolHandleMouse = function (this: any, event: any) {
            const member = state.activityTimeline.memberForTool(this.toolCallId);
            const group = member ? state.activityTimeline.groupForMember(member.id) : undefined;
            const isLeftClick = event.type === "click" && event.button === "left";
            if (state.renderMode !== "clean" || !member || !group) {
                patchedToolRender.call(this, event.width);
                const view = standaloneViews.get(this);
                if (view)
                    return handleProjectionMouse(this, view.projection, {
                        ...event, y: event.y - view.offset, height: view.projection.lines.length,
                    });
                return originalToolHandleMouse.call(this, event);
            }
            const position = state.activityMemberPosition(group, member);
            const revealed = state.activityGroupRevealed(group);
            if (!revealed && position.first && isLeftClick) {
                revealCleanGroup(group, this.ui);
                return { handled: true };
            }
            if (!revealed)
                return isLeftClick ? { handled: true } : undefined;
            const summaryHeight = position.first ? state.renderActivityGroupSummary(group, event.width).length : 0;
            const onSummary = position.first && event.y > 0 && event.y <= summaryHeight && isLeftClick;
            const onCollapse = position.last && state.activityCollapseClicked(group, member, event, patchedToolRender.call(this, event.width).length - 1);
            if (onSummary || onCollapse) {
                state.changingAllToolsExpansion = true;
                try {
                    collapseCleanGroup(group, this.ui);
                }
                finally {
                    state.changingAllToolsExpansion = false;
                }
                return { handled: true };
            }
            if (state.nestedTools.count(this.toolCallId) > 0 || isThirdPartyTool(this)) {
                const theme = state.cleanThemeForToolCall(this.toolCallId) ?? state.activityGroupTheme(group);
                const { childWidth, prefixWidth } = state.activityTreeStyle(group, member, event.width, theme);
                const projection = projectTool(this, childWidth, theme, "compact");
                if (projection)
                    return handleProjectionMouse(this, projection, {
                        ...event, x: Math.max(0, event.x - prefixWidth),
                        y: event.y - (position.first ? summaryHeight + 1 : 0),
                        width: childWidth, height: projection.lines.length,
                    });
            }
            if (!this.result && isLeftClick) {
                originalSetExpanded.call(this, !this.expanded);
                this.ui?.requestRender?.();
                return { handled: true };
            }
            const { prefixWidth } = state.activityTreeStyle(group, member, event.width, state.cleanThemeForToolCall(this.toolCallId));
            return originalToolHandleMouse.call(this, {
                ...event,
                x: Math.max(0, event.x - prefixWidth),
                y: event.y - summaryHeight + (position.first ? 0 : 1),
                width: Math.max(1, event.width - prefixWidth),
            });
        };
        toolExecutionPrototype[toolExecutionPatchKey] = {
            originalMarkExecutionStarted,
            patchedMarkExecutionStarted,
            originalSetExpanded,
            patchedSetExpanded,
            originalRender: originalToolRender,
            patchedRender: patchedToolRender,
            originalHandleMouse: originalToolHandleMouse,
            patchedHandleMouse: patchedToolHandleMouse,
        };
        toolExecutionPrototype.markExecutionStarted = patchedMarkExecutionStarted;
        toolExecutionPrototype.setExpanded = patchedSetExpanded;
        toolExecutionPrototype.render = patchedToolRender;
        toolExecutionPrototype.handleMouse = patchedToolHandleMouse;
        pi.on("session_shutdown", () => {
            const patch = toolExecutionPrototype[toolExecutionPatchKey];
            if (!patch)
                return;
            if (patch.patchedMarkExecutionStarted === toolExecutionPrototype.markExecutionStarted) {
                toolExecutionPrototype.markExecutionStarted = patch.originalMarkExecutionStarted;
            }
            if (patch.patchedSetExpanded === toolExecutionPrototype.setExpanded) {
                toolExecutionPrototype.setExpanded = patch.originalSetExpanded;
            }
            if (patch.patchedRender === toolExecutionPrototype.render) {
                toolExecutionPrototype.render = patch.originalRender;
            }
            if (patch.patchedHandleMouse === toolExecutionPrototype.handleMouse) {
                toolExecutionPrototype.handleMouse = patch.originalHandleMouse;
            }
            if (toolExecutionPrototype.markExecutionStarted === patch.originalMarkExecutionStarted &&
                toolExecutionPrototype.setExpanded === patch.originalSetExpanded &&
                toolExecutionPrototype.render === patch.originalRender &&
                toolExecutionPrototype.handleMouse === patch.originalHandleMouse) {
                delete toolExecutionPrototype[toolExecutionPatchKey];
            }
        });
    }
}
