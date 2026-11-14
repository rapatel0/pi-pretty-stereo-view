import { NestedTools } from "./nested-tools.js";
import { AssistantMessageComponent, InteractiveMode, ToolExecutionComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { ActivityTimeline, assistantMessageKey, visibleAssistantText, type ActivityGroup, type ActivityMember, type ActivitySeverity } from "./activity-timeline.js";
interface PatchState {
    renderMode: "full" | "compact" | "clean";
    cleanToolsExpanded: boolean;
    readonly nestedTools: NestedTools;
    readonly collapsedActivityGroups: Set<string>;
    changingAllToolsExpansion: boolean;
    readonly cleanCompactToolCallIds: Set<string>;
    readonly revealedActivityGroups: Set<string>;
    readonly expandedThinkingMembers: Set<string>;
    readonly thinkingComponents: Map<string, any>;
    currentTui: any;
    errorChatContainer: any;
    fullscreenTui: boolean;
    readonly orderContextEntriesForTranscript: (entries: any[]) => any[];
    readonly activityTimeline: ActivityTimeline;
    readonly activityUpdateComponents: Map<string, Component>;
    readonly activityUpdateMarkdownComponents: Map<string, {
        content: string;
        theme: any;
        component: Markdown;
    }>;
    readonly appendRuntimeActivityUpdate: (mode: any, message: string, severity: ActivitySeverity) => boolean;
    fullThinkingHidden: boolean;
    compactThinkingHidden: boolean;
    readonly setLatestActivityStatus: (status: {
        title: string;
        detail?: string;
        severity?: "error" | "status" | "success";
    }) => void;
    readonly renderActivityUpdateProjection: (group: ActivityGroup, member: ActivityMember, width: number, component?: any) => string[];
    readonly handleActivityUpdateMouse: (group: ActivityGroup, member: ActivityMember, event: any) => {
        handled: boolean;
    } | undefined;
    readonly toolComponents: Map<string, any>;
    readonly refreshActivityGroup: (group: ActivityGroup) => void;
    flushDeferredCacheNotices: ((toolCallId: string) => void) | undefined;
    readonly messageContentItems: (message: any) => any[];
    activityUpdateSequence: number;
    readonly clearLatestActivityStatus: () => void;
    currentExtensionUi: any;
}
export function installInteractiveMode(pi: ExtensionAPI, state: PatchState): void {
    const interactiveModePrototype = InteractiveMode.prototype as any;
    const toolsExpansionPatchKey = Symbol.for("pretty-tui.clean-tool-expansion");
    if (!interactiveModePrototype[toolsExpansionPatchKey]) {
        const originalSetToolsExpanded = interactiveModePrototype.setToolsExpanded;
        const originalToggleToolOutputExpansion = interactiveModePrototype.toggleToolOutputExpansion;
        const originalRenderSessionEntries = interactiveModePrototype.renderSessionEntries;
        const originalSwitchTuiMode = interactiveModePrototype.switchTuiMode;
        const originalShowExtensionNotify = interactiveModePrototype.showExtensionNotify;
        const originalToggleThinkingBlockVisibility = interactiveModePrototype.toggleThinkingBlockVisibility;
        const originalShowStatus = interactiveModePrototype.showStatus;
        const originalShowWarning = interactiveModePrototype.showWarning;
        const originalShowError = interactiveModePrototype.showError;
        const originalAddCacheMissNotice = interactiveModePrototype.addCacheMissNotice;
        const originalMaybeShowCacheMissNotice = interactiveModePrototype.maybeShowCacheMissNotice;
        const originalAddMessageToChat = interactiveModePrototype.addMessageToChat;
        const cacheMessageContexts = new WeakMap<object, any>();
        const pendingCacheNotices = new Map<string, {
            key: string;
            title: string;
            content: string;
            toolCallIds: string[];
        }>();
        // The interactive-mode instance that owns the chat container. Tool events
        // carry no `this`, so deferred notices need this handle to mount.
        const cacheNoticeHost: {
            current?: any;
        } = {};
        const cacheNoticeOwners = new WeakMap<object, any>();
        const patchedToggleToolOutputExpansion = function (this: any) {
            if (state.renderMode !== "clean") {
                return originalToggleToolOutputExpansion.call(this);
            }
            this.showStatus("Activity details expand individually in clean mode\nClick a group, tool, thought, or section to expand/collapse it.");
        };
        const patchedSetToolsExpanded = createPatchedSetToolsExpanded({
            get state() { return state; },
            get originalSetToolsExpanded() { return originalSetToolsExpanded; }
        });
        const patchedRenderSessionEntries = createPatchedRenderSessionEntries({
            get state() { return state; },
            get cacheMessageContexts() { return cacheMessageContexts; },
            get originalRenderSessionEntries() { return originalRenderSessionEntries; }
        });
        const patchedSwitchTuiMode = function (this: any, ...args: any[]) {
            const result = originalSwitchTuiMode.apply(this, args);
            state.currentTui = this.ui;
            state.fullscreenTui = state.currentTui?.mode === "fullscreen";
            return result;
        };
        // Pi's own showExtensionNotify only dispatches to showStatus/showWarning/
        // showError, and all three are replaced above. Delegating back to it would
        // therefore re-enter these patches instead of restoring native behaviour,
        // which sent info notifications into the transient UI flash. Route straight
        // to the original method that matches the severity instead.
        const nativeExtensionNotify = createNativeExtensionNotify({
            get originalShowError() { return originalShowError; },
            get originalShowWarning() { return originalShowWarning; },
            get originalShowStatus() { return originalShowStatus; },
            get originalShowExtensionNotify() { return originalShowExtensionNotify; }
        });
        const patchedShowExtensionNotify = function (this: any, message: string, type?: "info" | "warning" | "error") {
            const severity: ActivitySeverity = type ?? "info";
            if (state.renderMode === "full")
                return nativeExtensionNotify.call(this, message, severity);
            if (!state.appendRuntimeActivityUpdate(this, message, severity)) {
                nativeExtensionNotify.call(this, message, severity);
            }
        };
        const patchedToggleThinkingBlockVisibility = createPatchedToggleThinkingBlockVisibility({
            get state() { return state; },
            get originalToggleThinkingBlockVisibility() { return originalToggleThinkingBlockVisibility; }
        });
        const patchedShowStatus = function (this: any, message: string) {
            if (state.renderMode === "full")
                return originalShowStatus.call(this, message);
            const [firstLine, ...remainingLines] = String(message).split("\n");
            state.setLatestActivityStatus({
                title: firstLine || "Status",
                detail: remainingLines.join("\n"),
                severity: "status",
            });
            this.ui?.requestRender?.();
        };
        const patchedShowWarning = function (this: any, message: string) {
            if (state.renderMode === "full")
                return originalShowWarning.call(this, message);
            if (!state.appendRuntimeActivityUpdate(this, message, "warning")) {
                return originalShowWarning.call(this, message);
            }
        };
        const patchedShowError = function (this: any, message: string) {
            if (state.renderMode === "full")
                return originalShowError.call(this, message);
            if (!state.appendRuntimeActivityUpdate(this, message, "error")) {
                return originalShowError.call(this, message);
            }
        };
        // CacheMiss itself carries no assistant/message ID. Bind it at Pi's
        // calling sites, rather than depend on private chat-container children or
        // instanceof checks (these can be wrapped or come from another module).
        const patchedAddMessageToChat = function (this: any, message: any, ...args: any[]) {
            state.errorChatContainer = this.chatContainer;
            if (message?.role === "assistant")
                cacheMessageContexts.set(this, message);
            else
                cacheMessageContexts.delete(this);
            return originalAddMessageToChat.call(this, message, ...args);
        };
        const patchedMaybeShowCacheMissNotice = function (this: any, message: any, ...args: any[]) {
            const previous = cacheMessageContexts.get(this);
            cacheMessageContexts.set(this, message);
            try {
                return originalMaybeShowCacheMissNotice.call(this, message, ...args);
            }
            finally {
                if (previous)
                    cacheMessageContexts.set(this, previous);
                else
                    cacheMessageContexts.delete(this);
            }
        };
        // One projection component per activity update member. Cache notices are
        // also mounted immediately after the tool that anchors them, so container
        // order matches group order even when the notice arrives before the tools.
        const mountActivityUpdate = createMountActivityUpdate({
            get state() { return state; }
        });
        // Live cache misses arrive before the message's tools execute, so their
        // members do not exist yet. Attach the notice once its first tool joins the
        // group; this keeps it inside the tree instead of above it.
        const flushPendingCacheNotices = createFlushPendingCacheNotices({
            get pendingCacheNotices() { return pendingCacheNotices; },
            get state() { return state; },
            get mountActivityUpdate() { return mountActivityUpdate; },
            get cacheNoticeHost() { return cacheNoticeHost; }
        });
        state.flushDeferredCacheNotices = flushPendingCacheNotices;
        const patchedAddCacheMissNotice = createPatchedAddCacheMissNotice({
            get originalAddCacheMissNotice() { return originalAddCacheMissNotice; },
            get cacheMessageContexts() { return cacheMessageContexts; },
            get cacheNoticeOwners() { return cacheNoticeOwners; },
            get state() { return state; },
            get cacheNoticeHost() { return cacheNoticeHost; },
            get pendingCacheNotices() { return pendingCacheNotices; },
            get mountActivityUpdate() { return mountActivityUpdate; }
        });
        interactiveModePrototype[toolsExpansionPatchKey] = {
            originalSetToolsExpanded,
            patchedSetToolsExpanded,
            originalToggleToolOutputExpansion,
            patchedToggleToolOutputExpansion,
            originalRenderSessionEntries,
            patchedRenderSessionEntries,
            originalSwitchTuiMode,
            patchedSwitchTuiMode,
            originalShowExtensionNotify,
            patchedShowExtensionNotify,
            originalToggleThinkingBlockVisibility,
            patchedToggleThinkingBlockVisibility,
            originalShowStatus,
            patchedShowStatus,
            originalShowWarning,
            patchedShowWarning,
            originalShowError,
            patchedShowError,
            originalAddCacheMissNotice,
            patchedAddCacheMissNotice,
            originalMaybeShowCacheMissNotice,
            patchedMaybeShowCacheMissNotice,
            originalAddMessageToChat,
            patchedAddMessageToChat,
        };
        interactiveModePrototype.setToolsExpanded = patchedSetToolsExpanded;
        interactiveModePrototype.toggleToolOutputExpansion = patchedToggleToolOutputExpansion;
        interactiveModePrototype.renderSessionEntries = patchedRenderSessionEntries;
        interactiveModePrototype.switchTuiMode = patchedSwitchTuiMode;
        interactiveModePrototype.showExtensionNotify = patchedShowExtensionNotify;
        interactiveModePrototype.toggleThinkingBlockVisibility = patchedToggleThinkingBlockVisibility;
        interactiveModePrototype.showStatus = patchedShowStatus;
        interactiveModePrototype.showWarning = patchedShowWarning;
        interactiveModePrototype.showError = patchedShowError;
        if (typeof originalAddCacheMissNotice === "function") {
            interactiveModePrototype.addCacheMissNotice = patchedAddCacheMissNotice;
            if (typeof originalMaybeShowCacheMissNotice === "function") {
                interactiveModePrototype.maybeShowCacheMissNotice = patchedMaybeShowCacheMissNotice;
            }
            if (typeof originalAddMessageToChat === "function") {
                interactiveModePrototype.addMessageToChat = patchedAddMessageToChat;
            }
        }
        pi.on("session_shutdown", () => {
            state.fullscreenTui = false;
            state.errorChatContainer = undefined;
            state.currentTui = undefined;
            state.clearLatestActivityStatus();
            state.currentExtensionUi = undefined;
            const patch = interactiveModePrototype[toolsExpansionPatchKey];
            if (!patch)
                return;
            if (patch.patchedToggleToolOutputExpansion === interactiveModePrototype.toggleToolOutputExpansion) {
                interactiveModePrototype.toggleToolOutputExpansion = patch.originalToggleToolOutputExpansion;
            }
            if (patch.patchedSetToolsExpanded === interactiveModePrototype.setToolsExpanded) {
                interactiveModePrototype.setToolsExpanded = patch.originalSetToolsExpanded;
            }
            if (patch.patchedRenderSessionEntries === interactiveModePrototype.renderSessionEntries) {
                interactiveModePrototype.renderSessionEntries = patch.originalRenderSessionEntries;
            }
            if (patch.patchedSwitchTuiMode === interactiveModePrototype.switchTuiMode) {
                interactiveModePrototype.switchTuiMode = patch.originalSwitchTuiMode;
            }
            if (patch.patchedShowExtensionNotify === interactiveModePrototype.showExtensionNotify) {
                interactiveModePrototype.showExtensionNotify = patch.originalShowExtensionNotify;
            }
            if (patch.patchedToggleThinkingBlockVisibility === interactiveModePrototype.toggleThinkingBlockVisibility) {
                interactiveModePrototype.toggleThinkingBlockVisibility = patch.originalToggleThinkingBlockVisibility;
            }
            if (patch.patchedShowStatus === interactiveModePrototype.showStatus) {
                interactiveModePrototype.showStatus = patch.originalShowStatus;
            }
            if (patch.patchedShowWarning === interactiveModePrototype.showWarning) {
                interactiveModePrototype.showWarning = patch.originalShowWarning;
            }
            if (patch.patchedShowError === interactiveModePrototype.showError) {
                interactiveModePrototype.showError = patch.originalShowError;
            }
            if (patch.patchedAddCacheMissNotice === interactiveModePrototype.addCacheMissNotice) {
                interactiveModePrototype.addCacheMissNotice = patch.originalAddCacheMissNotice;
            }
            if (patch.patchedMaybeShowCacheMissNotice === interactiveModePrototype.maybeShowCacheMissNotice) {
                interactiveModePrototype.maybeShowCacheMissNotice = patch.originalMaybeShowCacheMissNotice;
            }
            if (patch.patchedAddMessageToChat === interactiveModePrototype.addMessageToChat) {
                interactiveModePrototype.addMessageToChat = patch.originalAddMessageToChat;
            }
            if (interactiveModePrototype.setToolsExpanded === patch.originalSetToolsExpanded &&
                interactiveModePrototype.toggleToolOutputExpansion === patch.originalToggleToolOutputExpansion &&
                interactiveModePrototype.renderSessionEntries === patch.originalRenderSessionEntries &&
                interactiveModePrototype.switchTuiMode === patch.originalSwitchTuiMode &&
                interactiveModePrototype.showExtensionNotify === patch.originalShowExtensionNotify &&
                interactiveModePrototype.toggleThinkingBlockVisibility === patch.originalToggleThinkingBlockVisibility &&
                interactiveModePrototype.showStatus === patch.originalShowStatus &&
                interactiveModePrototype.showWarning === patch.originalShowWarning &&
                interactiveModePrototype.showError === patch.originalShowError &&
                interactiveModePrototype.addCacheMissNotice === patch.originalAddCacheMissNotice &&
                interactiveModePrototype.maybeShowCacheMissNotice === patch.originalMaybeShowCacheMissNotice &&
                interactiveModePrototype.addMessageToChat === patch.originalAddMessageToChat) {
                delete interactiveModePrototype[toolsExpansionPatchKey];
            }
        });
    }
}
function createPatchedSetToolsExpanded(dependencies: {
    readonly state: PatchState;
    readonly originalSetToolsExpanded: any;
}) {
    return function (this: any, expanded: boolean) {
        dependencies.state.cleanToolsExpanded = expanded;
        dependencies.state.nestedTools.clearExpansion();
        dependencies.state.collapsedActivityGroups.clear();
        dependencies.state.changingAllToolsExpansion = true;
        if (!expanded) {
            dependencies.state.cleanCompactToolCallIds.clear();
            dependencies.state.revealedActivityGroups.clear();
            dependencies.state.expandedThinkingMembers.clear();
        }
        try {
            return dependencies.originalSetToolsExpanded.call(this, expanded);
        }
        finally {
            dependencies.state.changingAllToolsExpansion = false;
            for (const component of dependencies.state.thinkingComponents.values())
                component.invalidate?.();
            this.ui?.requestRender?.();
        }
    };
}
function createPatchedRenderSessionEntries(dependencies: {
    readonly state: PatchState;
    readonly cacheMessageContexts: WeakMap<object, any>;
    readonly originalRenderSessionEntries: any;
}) {
    return function (this: any, entries: any[], options?: any) {
        dependencies.state.currentTui = this.ui;
        dependencies.state.errorChatContainer = this.chatContainer;
        dependencies.state.fullscreenTui = dependencies.state.currentTui?.mode === "fullscreen";
        // buildContextEntries() prepends the latest compaction for model context,
        // while Pi's live compaction UI appends it chronologically. Keep reloads
        // and transcript rebuilds consistent with that live presentation.
        const orderedEntries = dependencies.state.orderContextEntriesForTranscript(entries);
        dependencies.cacheMessageContexts.delete(this);
        // Pi re-derives notices on each rebuild (including when its display
        // setting changes). Remove old projections, not their work groups.
        for (const group of dependencies.state.activityTimeline.groups()) {
            for (const member of [...group.members]) {
                if (member.updateKey?.startsWith("cache-miss:") || member.updateKey?.startsWith("runtime:cache-miss:")) {
                    dependencies.state.activityTimeline.discardUpdate(member.updateKey);
                    dependencies.state.activityUpdateComponents.delete(member.id);
                    dependencies.state.activityUpdateMarkdownComponents.delete(member.id);
                }
            }
        }
        return dependencies.originalRenderSessionEntries.call(this, orderedEntries, options);
    };
}
function createNativeExtensionNotify(dependencies: {
    readonly originalShowError: any;
    readonly originalShowWarning: any;
    readonly originalShowStatus: any;
    readonly originalShowExtensionNotify: any;
}) {
    return function (this: any, text: string, severity: ActivitySeverity): void {
        const direct = severity === "error"
            ? dependencies.originalShowError : severity === "warning"
            ? dependencies.originalShowWarning : dependencies.originalShowStatus;
        try {
            if (typeof direct === "function")
                direct.call(this, text);
            else
                dependencies.originalShowExtensionNotify.call(this, text, severity === "info" ? undefined : severity);
        }
        catch {
            // This host has no transcript to write to. The notification is already
            // recorded in the activity timeline, and it does not belong in the
            // transient UI flash, which only carries Pi UI state messages.
        }
    };
}
function createPatchedToggleThinkingBlockVisibility(dependencies: {
    readonly state: PatchState;
    readonly originalToggleThinkingBlockVisibility: any;
}) {
    return function (this: any) {
        if (dependencies.state.renderMode !== "clean") {
            if (dependencies.state.renderMode === "full") {
                this.hideThinkingBlock = dependencies.state.fullThinkingHidden;
                dependencies.state.fullThinkingHidden = !dependencies.state.fullThinkingHidden;
            }
            else {
                this.hideThinkingBlock = dependencies.state.compactThinkingHidden;
                dependencies.state.compactThinkingHidden = !dependencies.state.compactThinkingHidden;
            }
            return dependencies.originalToggleThinkingBlockVisibility.call(this);
        }
        // Do not change Pi's persisted hideThinkingBlock setting in clean mode.
        // Thought details use the activity hierarchy instead: click one thought,
        // Keyboard visibility toggles only explain these local controls.
        this.showStatus("Thought details expand individually in clean mode\nClick a thought to expand/collapse its details.");
    };
}
function createMountActivityUpdate(dependencies: {
    readonly state: PatchState;
}) {
    return (mode: any, group: ActivityGroup, member: ActivityMember, _nativeNodes: Component[] = [], after?: Component): void => {
        const container = mode?.chatContainer;
        const existing = dependencies.state.activityUpdateComponents.get(member.id);
        if (existing) {
            const children: Component[] | undefined = container?.children;
            if (after && children) {
                const target = children.indexOf(existing);
                const anchorIndex = children.indexOf(after);
                if (target >= 0 && anchorIndex >= 0 && target !== anchorIndex + 1) {
                    children.splice(target, 1);
                    children.splice(children.indexOf(after) + 1, 0, existing);
                }
            }
            return;
        }
        // A mode switch can keep existing components rather than rebuild them.
        const component: Component = {
            render: (width: number) => dependencies.state.renderActivityUpdateProjection(group, member, width),
            invalidate() { },
            handleMouse: (event: any) => dependencies.state.renderMode === "clean"
                ? dependencies.state.handleActivityUpdateMouse(group, member, event)
                : undefined,
        } as Component;
        dependencies.state.activityUpdateComponents.set(member.id, component);
        const index = after && container?.children ? container.children.indexOf(after) : -1;
        if (index >= 0) {
            container.children.splice(index + 1, 0, component);
            return;
        }
        container?.addChild?.(component);
    };
}
function createFlushPendingCacheNotices(dependencies: {
    readonly pendingCacheNotices: Map<string, {
        key: string;
        title: string;
        content: string;
        toolCallIds: string[];
    }>;
    readonly state: PatchState;
    readonly mountActivityUpdate: (mode: any, group: ActivityGroup, member: ActivityMember, _nativeNodes?: Component[], after?: Component) => void;
    readonly cacheNoticeHost: {
        current?: any;
    };
}) {
    return (toolCallId: string): void => {
        if (dependencies.pendingCacheNotices.size === 0)
            return;
        for (const [messageKey, pending] of [...dependencies.pendingCacheNotices]) {
            if (!pending.toolCallIds.includes(toolCallId))
                continue;
            dependencies.pendingCacheNotices.delete(messageKey);
            const anchorMember = dependencies.state.activityTimeline.memberForTool(toolCallId);
            if (!anchorMember)
                continue;
            const member = dependencies.state.activityTimeline.addUpdateAfterMember(anchorMember.id, pending.key, pending.title, pending.content, "warning") ?? dependencies.state.activityTimeline.addStandaloneUpdate(pending.key, pending.title, pending.content, "warning");
            const group = dependencies.state.activityTimeline.groupForMember(member.id);
            if (!group)
                continue;
            dependencies.mountActivityUpdate(dependencies.cacheNoticeHost.current, group, member, [], dependencies.state.toolComponents.get(toolCallId));
            dependencies.state.refreshActivityGroup(group);
            dependencies.cacheNoticeHost.current?.ui?.requestRender?.();
        }
    };
}
function createPatchedAddCacheMissNotice(dependencies: {
    readonly originalAddCacheMissNotice: any;
    readonly cacheMessageContexts: WeakMap<object, any>;
    readonly cacheNoticeOwners: WeakMap<object, any>;
    readonly state: PatchState;
    readonly cacheNoticeHost: {
        current?: any;
    };
    readonly pendingCacheNotices: Map<string, {
        key: string;
        title: string;
        content: string;
        toolCallIds: string[];
    }>;
    readonly mountActivityUpdate: (mode: any, group: ActivityGroup, member: ActivityMember, _nativeNodes?: Component[], after?: Component) => void;
}) {
    return function (this: any, miss: any) {
        if (!this.chatContainer?.addChild) {
            return dependencies.originalAddCacheMissNotice.call(this, miss);
        }
        // Let Pi decide thresholds, formatting and cause labels. Capture its
        // native nodes rather than duplicating cache heuristics or matching text.
        const nativeNodes: Component[] = [];
        const captureHost = Object.create(this);
        captureHost.chatContainer = Object.create(this.chatContainer);
        captureHost.chatContainer.addChild = (node: Component) => nativeNodes.push(node);
        dependencies.originalAddCacheMissNotice.call(captureHost, miss);
        const text = nativeNodes.flatMap((node) => node.render(4096))
            .map((line) => stripTerminalSequences(line).trim()).filter(Boolean).join("\n");
        if (!text)
            return;
        // Rebuilds have already restored the *whole* branch. Use the assistant
        // physically preceding this insertion, not currentGroup() (the last one).
        const children: any[] = this.chatContainer.children ?? [];
        let message: any = dependencies.cacheMessageContexts.get(this);
        for (let index = children.length - 1; !message && index >= 0; index--) {
            const child = children[index];
            if (dependencies.cacheNoticeOwners.has(child)) {
                message = dependencies.cacheNoticeOwners.get(child);
                break;
            }
            if (child instanceof ToolExecutionComponent)
                continue;
            if (child instanceof AssistantMessageComponent) {
                message = (child as any).lastMessage;
                break;
            }
            break; // never cross a user/custom/compaction boundary
        }
        // Live Pi may have inserted a provider diagnostic after the assistant.
        if (!message && this.streamingComponent && children.includes(this.streamingComponent)) {
            message = this.streamingMessage;
        }
        let anchor: ActivityMember | undefined;
        const calls = dependencies.state.messageContentItems(message).filter((item: any) => item.type === "toolCall");
        for (let index = calls.length - 1; index >= 0; index--) {
            anchor = dependencies.state.activityTimeline.memberForTool(calls[index].id);
            if (anchor)
                break;
        }
        if (!anchor && message && !visibleAssistantText(message)) {
            anchor = dependencies.state.activityTimeline.memberForThinking(assistantMessageKey(message));
        }
        const key = message
            ? `cache-miss:${assistantMessageKey(message)}`
            : `runtime:cache-miss:${++dependencies.state.activityUpdateSequence}`;
        const [title, ...details] = text.split("\n");
        const content = details.join("\n");
        dependencies.cacheNoticeHost.current = this;
        if (!anchor && calls.length > 0) {
            // The tools have not started yet: their group does not exist. Defer so
            // the notice lands after the tool instead of floating above the tree.
            dependencies.pendingCacheNotices.set(key, {
                key, title, content, toolCallIds: calls.map((call: any) => call.id),
            });
            return;
        }
        const member = (anchor && dependencies.state.activityTimeline.addUpdateAfterMember(anchor.id, key, title, content, "warning")) || dependencies.state.activityTimeline.addStandaloneUpdate(key, title, content, "warning");
        const group = dependencies.state.activityTimeline.groupForMember(member.id);
        if (!group)
            return;
        dependencies.mountActivityUpdate(this, group, member, nativeNodes, anchor?.toolCallId ? dependencies.state.toolComponents.get(anchor.toolCallId) : undefined);
        const component = dependencies.state.activityUpdateComponents.get(member.id);
        if (component && message)
            dependencies.cacheNoticeOwners.set(component, message);
        dependencies.state.refreshActivityGroup(group);
        this.ui?.requestRender?.();
    };
}
