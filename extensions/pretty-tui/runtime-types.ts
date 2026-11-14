import { type Cancel } from "../shared/scheduler.js";
import { NestedTools } from "./nested-tools.js";
import { createBashTool, createEditTool, createFindTool, createGrepTool, createLsTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown } from "@earendil-works/pi-tui";
import { ActivityTimeline, type ActivityGroup, type ActivityMember, type ActivitySeverity } from "./activity-timeline.js";
export type PrettyTuiMode = "full" | "compact" | "clean";
export type PrettyTuiConfig = {
    enabled?: boolean;
    mode?: PrettyTuiMode;
    /** Draw the vertical side columns of frames (default true); false keeps top/bottom rules only. */
    sideBorders?: boolean;
    /** Legacy location used by the first mode implementation. */
    bash?: {
        mode?: "full" | "compact";
    };
};
export type LatestActivityStatus = {
    title: string;
    detail?: string;
    severity?: TransientStatusSeverity;
};
export type TransientStatusSeverity = "status" | "success" | "error";
export type ResponseFooterData = {
    answerEntryId?: string;
    durationMs: number;
    outcome: "completed" | "stopped";
};
export type DisplayValue = string | (() => string);
export type DisplayRow = {
    prefix: DisplayValue;
    continuation?: DisplayValue;
    content: DisplayValue;
};
export type ToolStatus = "running" | "success" | "error";
export type ToolSummaryGroup = {
    count: number;
    failed: number;
    thoughtCount?: number;
    lastToolCallId: string;
    toolCallIds?: string[];
    activity?: string;
};
export type ToolSummaryData = {
    count?: number;
    failed?: number;
    thoughtCount?: number;
    /** Identifies the last tool component for older single-group entries. */
    lastToolCallId?: string;
    /** All groups from a run, used to restore summaries after reload. */
    groups?: ToolSummaryGroup[];
};
export type ToolActivityHold = {
    toolCallId: string;
    name: string;
    until: number;
    after: string;
    started: boolean;
    timer?: Cancel;
};
export type CleanRunState = {
    activeToolCallId?: string;
    lastCompletedToolCallId?: string;
    activeToolName?: string;
    activity?: string;
    requestRender?: () => void;
    count: number;
    failed: number;
    currentToolCallIds: string[];
    activeToolCallIds: Set<string>;
    groups: ToolSummaryGroup[];
    active: boolean;
    settled: boolean;
};
export type NativeToolRenderers = {
    [toolName: string]: any;
};
export interface TranscriptRuntime {
    cwd: string;
    config: PrettyTuiConfig;
    activeForSession: boolean;
    sideBordersEnabled: boolean;
    configuredMode: PrettyTuiMode | undefined;
    renderMode: PrettyTuiMode;
    cleanToolsExpanded: boolean;
    fullThinkingHidden: boolean;
    compactThinkingHidden: boolean;
    cleanContextCompacted: boolean;
    fullscreenTui: boolean;
    mouseClickHitTests: WeakMap<object, (event: any) => boolean>;
    currentTui: any;
    currentPromptEditor: any;
    errorChatContainer: any;
    runtimeErrorDescriptors: WeakMap<object, {
        source: string;
        title: string;
        content: string;
    }>;
    errorDescriptor: (component: any) => {
        source: string;
        title: string;
        content: string;
    } | undefined;
    errorRun: (component: any) => {
        hidden: boolean;
        count: number;
        compact: boolean;
    };
    runningColor: (theme: any, text: string) => string;
    currentExtensionUi: any;
    changingAllToolsExpansion: boolean;
    latestActivityWidgetKey: "pretty-tui-latest-activity";
    latestActivityStatus: {
        title: string;
        detail?: string;
        severity?: "error" | "status" | "success";
    } | undefined;
    latestActivityWidgetInstalled: boolean;
    latestActivityStatusTimer: Cancel | undefined;
    latestActivityStatusGeneration: number;
    renderLatestActivityStatus: (status: {
        title: string;
        detail?: string;
        severity?: "error" | "status" | "success";
    }, width: number, theme: any) => string;
    refreshLatestActivityWidget: () => void;
    clearLatestActivityStatus: () => void;
    setLatestActivityStatus: (status: {
        title: string;
        detail?: string;
        severity?: "error" | "status" | "success";
    }) => void;
    copyTranscriptText: (text: string) => void;
    responseAnswerTexts: Map<string, string>;
    responseRunStartedAt: number | undefined;
    RUNNING_DOT_INTERVAL_MS: 800;
    workingElapsedTimer: Cancel | undefined;
    stopWorkingElapsedTimer: () => void;
    startWorkingElapsedTimer: () => void;
    responseHasAssistantMessage: boolean;
    assistantAnswerText: (message: any) => string;
    formatResponseDuration: (durationMs: number) => string;
    activityTimeline: ActivityTimeline;
    nestedTools: NestedTools;
    refreshNestedTools: (id: string) => void;
    revealedActivityGroups: Set<string>;
    collapsedActivityGroups: Set<string>;
    expandedThinkingMembers: Set<string>;
    thinkingComponents: Map<string, any>;
    activityFallbackThemes: Map<string, any>;
    activityUpdateComponents: Map<string, Component>;
    activityUpdateMarkdownComponents: Map<string, {
        content: string;
        theme: any;
        component: Markdown;
    }>;
    activityUpdateSequence: number;
    flushDeferredCacheNotices: ((toolCallId: string) => void) | undefined;
    assistantBoundaryKeys: Set<string>;
    cleanCompactToolCallIds: Set<string>;
    cleanGroupToolCallIds: Map<string, string[]>;
    cleanToolCallGroupOwners: Map<string, string>;
    toolComponents: Map<string, any>;
    cleanToolThemes: Map<string, any>;
    cleanToolNames: Map<string, string>;
    _renderCleanGroupSummary: (_lastToolCallId: string, _width: number) => string[];
    transcriptMarkdownDepth: number;
    withTranscriptMarkdown: <T>(callback: () => T) => T;
    transcriptMarkdownActive: () => boolean;
    setCleanGroupMembers: (lastToolCallId: string, toolCallIds: string[]) => void;
    isCleanGroupRevealed: (toolCallId: string) => boolean;
    cleanThemeForToolCall: (toolCallId: string) => any;
    activityGroupOwner: (group: ActivityGroup) => string | undefined;
    fallbackActivityTheme: any;
    defaultActivityTheme: () => any;
    activityGroupTheme: (group: ActivityGroup) => any;
    activityGroupRevealed: (group: ActivityGroup) => boolean;
    activityGroupCollapsible: (group: ActivityGroup) => boolean;
    activityMemberPosition: (group: ActivityGroup, member: ActivityMember) => {
        first: boolean;
        last: boolean;
    };
    collapseLabel: "[↑ Collapse]";
    collapsePrefix: "  └─ ";
    renderActivityCollapse: (group: ActivityGroup, width: number) => string;
    withActivityCollapse: (group: ActivityGroup, member: ActivityMember, width: number, lines: string[]) => string[];
    activityCollapseClicked: (group: ActivityGroup, member: ActivityMember, event: any, row: number) => boolean;
    refreshActivityGroup: (group: ActivityGroup) => void;
    requestActivityRender: (group?: ActivityGroup) => void;
    revealActivityGroup: (group: ActivityGroup, ui?: any) => void;
    collapseActivityGroup: (group: ActivityGroup, ui?: any) => void;
    activityTreeStyle: (group: ActivityGroup, member: ActivityMember, width: number, memberTheme?: any) => {
        prefix: any;
        continuation: any;
        childWidth: number;
        prefixWidth: number;
    };
    humanizeCustomType: (value: string) => string;
    renderActivityUpdateMarkdown: (member: ActivityMember, width: number, theme: any) => string[];
    activityUpdateStyle: (member: ActivityMember, theme: any) => {
        severity: ActivitySeverity;
        icon: any;
        title: (text: string) => any;
    };
    renderActivityUpdate: (group: ActivityGroup, member: ActivityMember, width: number, theme?: any) => string[];
    renderStandaloneError: (member: ActivityMember, width: number, component?: any) => string[];
    renderPendingActivityUpdate: (member: ActivityMember, width: number, component?: any) => string[];
    renderActivityUpdateProjection: (group: ActivityGroup, member: ActivityMember, width: number, component?: any) => string[];
    handleActivityUpdateMouse: (group: ActivityGroup, member: ActivityMember, event: any) => {
        handled: boolean;
    } | undefined;
    saveConfig: (nextConfig: PrettyTuiConfig) => void;
    saveRenderMode: (mode: PrettyTuiMode) => void;
    saveEnabled: (enabled: boolean) => void;
    applySideBorders: (on: boolean) => void;
    applyMode: (mode: PrettyTuiMode) => void;
    customMessageKey: (message: any) => string;
    customMessageText: (message: any) => string;
    hasWorkActivity: (group: ActivityGroup | undefined) => boolean;
    addPersistentActivityUpdate: (message: any) => ActivityMember;
    nativeCustomBoundaryKeys: Set<string>;
    closeCleanAtNativeCustomBoundary: () => void;
    closeCleanAtStandaloneAlert: () => void;
    compactionPrototype: any;
    compactionPatchKey: symbol;
    orderContextEntriesForTranscript: (entries: any[]) => any[];
    appendRuntimeActivityUpdate: (mode: any, message: string, severity: ActivitySeverity) => boolean;
    textContent: (result: any) => string;
    nonEmptyLines: (value: string) => number;
    readLineRange: (offset: unknown, limit: unknown) => string;
    block: (rows: {
        prefix: string | (() => string);
        continuation?: string | (() => string);
        content: string | (() => string);
    }[]) => Component;
    setStatus: (context: any, status: "error" | "success" | "running") => void;
    callRow: (theme: any, name: string, detail: string, state: any) => {
        prefix: string | (() => string);
        continuation?: string | (() => string);
        content: string | (() => string);
    };
    call: (theme: any, name: string, detail: string, state: any) => Component;
    writeCall: (theme: any, name: string, path: string, content: string, expanded: boolean, state: any) => Component;
    editDiffLayout: (theme: any, diff: string) => ((line: string) => {
        prefix: string | (() => string);
        continuation?: string | (() => string);
        content: string | (() => string);
    });
    result: (theme: any, summary: string, output?: string, expanded?: boolean, error?: boolean, summaryIsStyled?: boolean, outputStyle?: (line: string) => string, outputLayout?: (line: string) => {
        prefix: string | (() => string);
        continuation?: string | (() => string);
        content: string | (() => string);
    }) => Component;
    isError: (renderContext: any) => boolean;
    partialResult: (context: any, theme: any, label: string) => Component;
    terminalOutputLines: (output: string) => string[];
    bashResult: (context: any, theme: any, summary: string, output: string, expanded: boolean, status: "error" | "success" | "running") => Component;
    completeStatus: (context: any) => boolean;
    settledSummaries: Map<string, {
        count: number;
        failed: number;
        thoughtCount: number;
        activity: string | (() => string);
    }>;
    toolActivityHolds: Map<string, {
        toolCallId: string;
        name: string;
        until: number;
        after: string;
        started: boolean;
        timer?: Cancel;
    }>;
    legacySummaryLastToolCallIds: Map<string, string>;
    knownToolCallIds: Set<string>;
    cleanRun: {
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
    clearToolActivityHolds: () => void;
    heldActivity: (hold: {
        toolCallId: string;
        name: string;
        until: number;
        after: string;
        started: boolean;
        timer?: Cancel;
    }) => string;
    scheduleToolActivityRelease: (hold: {
        toolCallId: string;
        name: string;
        until: number;
        after: string;
        started: boolean;
        timer?: Cancel;
    }) => void;
    beginToolActivity: (toolCallId: string, name: string, started?: boolean) => void;
    holdToolActivity: (toolCallId: string, name: string) => void;
    activityValueForHold: (toolCallId: string, after: string) => string | (() => string);
    liveCleanToolCount: () => number;
    thoughtCountForTool: (toolCallId: string | undefined) => number;
    currentCleanActivity: () => string;
    finishCleanGroup: (activity?: string) => void;
    settleLastCleanGroup: () => void;
    summaryText: (count: number, _failed: number, thoughtCount: number, activity?: string, nestedCount?: number) => string;
    summaryRow: (theme: any, count: number, failed: number, thoughtCount: number, activity?: string | (() => string), collapsedDone?: boolean, nestedCount?: number) => {
        prefix: string | (() => string);
        continuation?: string | (() => string);
        content: string | (() => string);
    };
    renderActivityGroupSummary: (group: ActivityGroup, width: number, collapsedDone?: boolean) => string[];
    cleanToolCall: (theme: any, name: string, toolCallId: string) => Component;
    hiddenToolResult: (context: any, options: any, _output: string) => Component;
    hideCleanTool: (toolCallId: string, expanded: boolean, _executionStarted?: boolean) => boolean;
    useCompactToolView: (toolCallId: string, expanded: boolean) => boolean;
    messageContentItems: (message: any) => any[];
    messageHasVisibleText: (message: any) => boolean;
    restoreCleanSession: (ctx: any) => void;
    hasVisibleAssistantText: (message: any) => boolean;
    closeAtAssistantBoundary: (message: any, activity: string) => boolean;
    pendingToolCalls: (message: any) => any[];
    _conciseActivityText: (value: string) => string;
    trackThinkingActivity: (message: any) => void;
    trackPendingToolActivity: (message: any) => boolean;
    clearPendingToolActivities: () => void;
    nativeDefinitions: {
        [toolName: string]: any;
    };
    registerStyledTool: (definition: any) => void;
    read: ReturnType<typeof createReadTool>;
    readLabel: string;
    bash: ReturnType<typeof createBashTool>;
    bashLabel: string;
    edit: ReturnType<typeof createEditTool>;
    editLabel: string;
    write: ReturnType<typeof createWriteTool>;
    writeLabel: string;
    grep: ReturnType<typeof createGrepTool>;
    grepLabel: string;
    find: ReturnType<typeof createFindTool>;
    findLabel: string;
    ls: ReturnType<typeof createLsTool>;
    lsLabel: string;
}
