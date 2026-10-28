import { estimateTokens, SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { installSidebar, type SidebarController } from "../ui/sidebar/index.js";
import { createDefaultSidebarPanels, SESSION_PANEL_ID } from "../ui/sidebar/default-panels.js";
import type { SessionListItem } from "../ui/session/panel.js";
import { createSessionCatalog } from "../ui/session/catalog.js";
import { deleteSessionFile } from "../ui/session/mutations.js";
import { installContextEstimates } from "../ui/ctx/data.js";
import { createActivityTracker, createStreamingTokenSampler, type ActivityTracker } from "../ui/ctx/activity.js";
import { createToolUsageTracker, type ToolUsageTracker } from "../ui/tool-view/usage.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./config.js";
import { isStereoAttached, onStereoAttached, onStereoDetaching } from "./bridges.js";

type UsageLike = { input?: unknown; cacheRead?: unknown; cacheWrite?: unknown; output?: unknown };

/**
 * Right-side sidebar (sessions, context, tool usage) from pi-ui-extension,
 * mounted over whatever layout the stereo split owns and fully toggleable.
 */
export type SidebarControls = {
  statusLine(): string;
  isEnabled(): boolean;
  setEnabled(on: boolean): void;
  setWidth(width: number | undefined): void;
  autoHideBelow(): number;
  setAutoHideBelow(columns: number): void;
};

export function installSidebarHost(pi: ExtensionAPI): SidebarControls {
  const settings = loadSettings();
  let enabled = settings.sidebarEnabled;
  let width = settings.sidebarWidth;
  let autoHideBelow = settings.sidebarAutoHideBelow;

  let controller: SidebarController | undefined;
  let lastCtx: ExtensionContext | undefined;
  let activity: ActivityTracker | undefined;
  let toolUsage: ToolUsageTracker | undefined;
  let pendingAttachSubscription: (() => void) | undefined;
  let switchRequested = false;
  let fullscreenWarningShown = false;
  let reinstallRef: (() => void) | undefined;
  let evaluateWidthRef: ((columns: number) => void) | undefined;
  let hiddenByWidth = false;

  const persist = (): void => {
    try {
      saveSettings({ sidebarEnabled: enabled, sidebarWidth: width, sidebarAutoHideBelow: autoHideBelow });
    } catch {
      // Preferences are best-effort; the sidebar keeps working unsaved.
    }
  };

  const terminalColumns = (tui: unknown): number => {
    const columns = (tui as { terminal?: { columns?: unknown } } | undefined)?.terminal?.columns;
    return typeof columns === "number" && Number.isFinite(columns) && columns > 0
      ? columns
      : Number.MAX_SAFE_INTEGER;
  };
  const wideEnough = (columns: number): boolean => autoHideBelow <= 0 || columns >= autoHideBelow;

  const refresh = (): void => controller?.refresh();
  const refreshSessions = (): void => {
    controller?.updatePanel(SESSION_PANEL_ID, undefined) ?? refresh();
  };

  // --- Context / activity / usage state backing the panels -----------------
  const contextEstimates = installContextEstimates(pi, refresh);
  const streamingTokens = createStreamingTokenSampler(estimateTokens, (tokens, observedAt) => {
    activity?.updateResponseEstimate(tokens, observedAt);
  });

  let cacheInputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const cacheHitRate = (): number => {
    const promptTokens = cacheInputTokens + cacheReadTokens + cacheWriteTokens;
    return promptTokens === 0 ? 0 : cacheReadTokens / promptTokens * 100;
  };
  const addCacheUsage = (usage: unknown): void => {
    if (!usage || typeof usage !== "object") return;
    const values = usage as UsageLike;
    const number = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    cacheInputTokens += number(values.input);
    cacheReadTokens += number(values.cacheRead);
    cacheWriteTokens += number(values.cacheWrite);
  };
  const resetCacheUsage = (branch: readonly unknown[]): void => {
    cacheInputTokens = 0;
    cacheReadTokens = 0;
    cacheWriteTokens = 0;
    for (const entry of branch) {
      if (!entry || typeof entry !== "object") continue;
      const typed = entry as { type?: unknown; message?: { usage?: unknown } };
      if (typed.type === "message") addCacheUsage(typed.message?.usage);
    }
  };

  const mcpServerNames = (): string[] => {
    try {
      const servers = pi.getMcpServers?.() ?? [];
      return servers
        .map((server) => (server as { name?: unknown }).name)
        .filter((name): name is string => typeof name === "string");
    } catch {
      return [];
    }
  };
  const currentBranch = (ctx: ExtensionContext): readonly unknown[] => ctx.sessionManager.getBranch();

  // --- Sessions panel providers --------------------------------------------
  const sessionCatalog = createSessionCatalog();
  const rowPaths = new Map<string, string>();
  const loadRows = async (ctx: ExtensionContext): Promise<readonly SessionListItem[]> => {
    const currentId = ctx.sessionManager.getSessionId();
    const summaries = await sessionCatalog(ctx.cwd, ctx.sessionManager.getSessionDir());
    rowPaths.clear();
    for (const summary of summaries) rowPaths.set(summary.id, summary.path);
    return summaries
      .map((summary) => ({
        id: summary.id,
        title: summary.name ?? summary.firstMessage,
        modified: summary.modified,
        userPromptCount: summary.userPromptCount,
        current: summary.id === currentId,
      }))
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());
  };

  const switchToSession = (ctx: ExtensionContext, session: SessionListItem): void => {
    if (session.current || switchRequested) return;
    if (!ctx.isIdle()) {
      ctx.ui.notify("Wait for the current run to finish before switching sessions", "warning");
      return;
    }
    if (!rowPaths.has(session.id)) {
      refreshSessions();
      return;
    }
    switchRequested = true;
    // switchSession lives on command contexts; route through a hidden
    // command the way upstream pi-ui-extension does.
    pi.sendUserMessage(`/sidebar-session switch ${session.id}`, { expandPromptTemplates: true });
  };

  const renameSession = async (ctx: ExtensionContext, session: SessionListItem): Promise<void> => {
    const path = rowPaths.get(session.id);
    if (!path) {
      refreshSessions();
      return;
    }
    const nextName = await ctx.ui.input("Rename session", session.title);
    const next = nextName?.trim();
    if (!next) return;
    try {
      if (session.current) pi.setSessionName(next);
      else {
        SessionManager.open(path).appendSessionInfo(next);
        refreshSessions();
      }
      ctx.ui.notify("Session renamed", "info");
    } catch (error) {
      ctx.ui.notify(`Failed to rename session: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  const deleteSession = async (ctx: ExtensionContext, session: SessionListItem): Promise<void> => {
    if (session.current) {
      ctx.ui.notify("Cannot delete the currently active session", "warning");
      return;
    }
    if (!ctx.isIdle()) {
      ctx.ui.notify("Wait for the current run to finish before deleting sessions", "warning");
      return;
    }
    const path = rowPaths.get(session.id);
    if (!path) {
      refreshSessions();
      return;
    }
    const confirmed = await ctx.ui.confirm("Delete session", `Move “${session.title}” to trash?`);
    if (!confirmed) return;
    if (!ctx.isIdle() || session.current) return;
    const result = await deleteSessionFile(pi, path);
    if (result.ok) ctx.ui.notify("Session moved to trash", "info");
    else ctx.ui.notify(`Failed to delete session: ${result.error}`, "error");
    refreshSessions();
  };

  // --- Mount / dispose ------------------------------------------------------
  const teardownController = (): void => {
    if (!controller) return;
    const liveWidth = controller.getWidth();
    if (liveWidth > 0) width = liveWidth;
    controller.dispose();
    controller = undefined;
  };

  const disposeSidebar = (): void => {
    pendingAttachSubscription?.();
    pendingAttachSubscription = undefined;
    reinstallRef = undefined;
    evaluateWidthRef = undefined;
    hiddenByWidth = false;
    teardownController();
  };

  const mountSidebar = async (ctx: ExtensionContext): Promise<void> => {
    if (controller || reinstallRef || !enabled || ctx.mode !== "tui") return;
    let finish: () => void = () => {};
    await ctx.ui.custom<void>((tui, theme, _keys, done) => {
      finish = done;
      const install = (): void => {
        if (controller) return;
        const panels = createDefaultSidebarPanels({
          getContextUsage: () => ctx.getContextUsage(),
          getContextEstimate: () => contextEstimates.getSnapshot(),
          getContextDelta: () => contextEstimates.getDelta(),
          getActivity: () => activity?.getSnapshot(),
          getCacheHitRate: cacheHitRate,
          getModel: () => ctx.model?.id ?? "no-model",
          getThinkingLevel: () => pi.getThinkingLevel(),
          getToolViewMode: () => undefined,
          getToolUsage: () => toolUsage?.getSnapshot(),
          onSelectToolViewMode: () => {
            ctx.ui.notify("Tool view modes come from pi-ui-extension's tool controller, not this bundle", "info");
          },
          loadSessions: () => loadRows(ctx),
          onSelectSession: (session) => switchToSession(ctx, session),
          onRenameSession: (session) => void renameSession(ctx, session),
          onDeleteSession: (session) => void deleteSession(ctx, session),
          onDeleteOthers: () => {
            ctx.ui.notify("Bulk session cleanup is not part of this bundle", "info");
          },
          onOpenResources: () => {
            ctx.ui.notify("Resource browsing is not part of this bundle", "info");
          },
        });
        const next = installSidebar(tui, theme, panels, {
          ...(width === undefined ? {} : { initialWidth: width }),
          onWidthChange: (liveWidth) => {
            width = liveWidth;
            persist();
          },
        });
        if (next.mounted) {
          controller = next;
          hiddenByWidth = false;
          fullscreenWarningShown = false;
        } else {
          next.dispose();
          if (!fullscreenWarningShown) {
            fullscreenWarningShown = true;
            ctx.ui.notify("Sidebar needs Pi fullscreen mode (set it in /settings or start with --tui-mode fullscreen)", "warning");
          }
        }
      };
      // The invisible overlay's visible() callback re-runs on terminal resize,
      // which is the signal for auto-hiding on narrow screens (phones) and
      // restoring the sidebar when the terminal widens again.
      const evaluate = (columns: number): void => {
        if (!enabled) return;
        if (wideEnough(columns) && !controller) {
          queueMicrotask(() => {
            if (enabled && !controller && wideEnough(terminalColumns(tui))) {
              install();
              hiddenByWidth = false;
            }
          });
        } else if (!wideEnough(columns) && controller) {
          queueMicrotask(() => {
            if (controller && !wideEnough(terminalColumns(tui))) {
              teardownController();
              hiddenByWidth = true;
            }
          });
        }
      };
      reinstallRef = () => evaluate(terminalColumns(tui));
      evaluateWidthRef = evaluate;
      evaluate(terminalColumns(tui));
      return new Text("", 0, 0);
    }, {
      overlay: true,
      overlayOptions: {
        visible: (columns: number) => {
          evaluateWidthRef?.(columns);
          return false;
        },
        nonCapturing: true,
      },
      onHandle: () => finish(),
    });
  };

  const scheduleMount = (ctx: ExtensionContext): void => {
    if (!enabled || controller || reinstallRef) return;
    if (isStereoAttached()) {
      void mountSidebar(ctx);
      return;
    }
    // Wrap the layout root only after the stereo split owns it, so the
    // sidebar lands right of the split instead of being absorbed by it.
    pendingAttachSubscription?.();
    const subscribe = onStereoAttached(() => {
      pendingAttachSubscription = undefined;
      // A TUI-mode rebuild re-attaches stereo on a fresh TUI while a stale
      // sidebar mount may still point at the dead one; drop it first.
      if (reinstallRef || controller) disposeSidebar();
      void mountSidebar(lastCtx ?? ctx);
    });
    pendingAttachSubscription = subscribe;
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    persist();
    if (!enabled) {
      hiddenByWidth = false;
      teardownController();
    } else if (reinstallRef) {
      reinstallRef();
    } else if (lastCtx) {
      void mountSidebar(lastCtx);
    }
  };

  const applyWidth = (next: number | undefined): void => {
    width = next;
    persist();
    teardownController();
    if (reinstallRef) reinstallRef();
    else if (lastCtx) void mountSidebar(lastCtx);
  };

  const applyAutoHide = (columns: number): void => {
    autoHideBelow = Math.max(0, Math.min(200, columns));
    persist();
    if (reinstallRef) reinstallRef();
  };

  onStereoDetaching(() => disposeSidebar());

  // --- Lifecycle ------------------------------------------------------------
  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    switchRequested = false;
    // A reload may start without session_shutdown; release the old layout and
    // listeners while their original context is still valid.
    disposeSidebar();
    activity?.reset();
    activity = ctx.mode === "tui" ? createActivityTracker(ctx.cwd, refresh) : undefined;
    toolUsage = createToolUsageTracker(pi.getAllTools().map((tool) => tool.name), mcpServerNames);
    const branch = currentBranch(ctx);
    resetCacheUsage(branch);
    toolUsage.resetSession(branch, mcpServerNames());
    if (ctx.mode !== "tui") return;
    scheduleMount(ctx);
  });

  pi.on("session_shutdown", () => {
    disposeSidebar();
    activity?.reset();
    activity = undefined;
    toolUsage = undefined;
    lastCtx = undefined;
  });

  // --- Event wiring (mirrors pi-ui-extension's own sidebar feed) ------------
  pi.on("before_agent_start", () => {
    contextEstimates.resetDelta();
    toolUsage?.startExchange();
    refresh();
  });
  pi.on("agent_start", () => {
    activity?.startRun();
    refresh();
  });
  pi.on("turn_start", (event) => {
    activity?.startTurn(event.turnIndex);
    refresh();
  });
  pi.on("before_provider_request", () => {
    streamingTokens.reset();
    activity?.startResponse();
  });
  pi.on("message_update", (event) => {
    if (activity) streamingTokens.observe(event.message);
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      const usage = (event.message as { usage?: UsageLike }).usage;
      addCacheUsage(usage);
      activity?.finishResponse(typeof usage?.output === "number" ? usage.output : 0);
    }
    refresh();
  });
  pi.on("tool_execution_start", (event) => {
    activity?.startTool(event);
    refresh();
  });
  pi.on("tool_execution_end", (event) => {
    activity?.finishTool(event);
    toolUsage?.record(event);
    refresh();
  });
  pi.on("agent_settled", (event) => {
    activity?.settle(undefined, (event as { aborted?: boolean }).aborted === true);
    refreshSessions();
  });
  pi.on("turn_end", (event) => {
    activity?.finishTurn(event.turnIndex);
    refresh();
  });
  pi.on("session_tree", () => {
    if (lastCtx) {
      const branch = currentBranch(lastCtx);
      resetCacheUsage(branch);
      toolUsage?.resetSession(branch, mcpServerNames());
    }
    refreshSessions();
  });
  pi.on("session_info_changed", refreshSessions);
  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);

  // --- Controls ---------------------------------------------------------------
  pi.registerCommand("sidebar-session", {
    description: "Sidebar session action: /sidebar-session switch <id>",
    handler: async (args, ctx) => {
      const [verb = "", id = ""] = (args ?? "").trim().split(/\s+/);
      if (verb !== "switch") return;
      const path = rowPaths.get(id);
      if (!path) {
        switchRequested = false;
        ctx.ui.notify("Session no longer exists", "error");
        refreshSessions();
        return;
      }
      try {
        const result = await ctx.switchSession(path);
        if (result.cancelled) {
          switchRequested = false;
          ctx.ui.notify("Session switch cancelled", "info");
        }
        // A successful switch starts a new session, which clears the guard.
      } catch (error) {
        switchRequested = false;
        ctx.ui.notify(`Failed to switch session: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
  pi.registerCommand("sidebar", {
    description: "Toggle the right sidebar: /sidebar [on|off|toggle|width <columns>]",
    handler: async (args, ctx) => {
      const action = (args ?? "").trim().toLowerCase();
      const [verb = "toggle", amount] = action.split(/\s+/);
      if (verb === "toggle") setEnabled(!enabled);
      else if (verb === "on") setEnabled(true);
      else if (verb === "off") setEnabled(false);
      else if (verb === "width" && /^\d+$/.test(amount ?? "")) {
        applyWidth(Number(amount));
      } else if (verb === "autohide") {
        if (amount === "off") applyAutoHide(0);
        else if (amount === "default" || amount === undefined) applyAutoHide(DEFAULT_SETTINGS.sidebarAutoHideBelow);
        else if (/^\d+$/.test(amount)) applyAutoHide(Number(amount));
        else {
          ctx.ui.notify("Usage: /sidebar autohide [columns|off|default]", "warning");
          return;
        }
        ctx.ui.notify(
          autoHideBelow === 0
            ? "Sidebar auto-hide disabled"
            : `Sidebar auto-hides below ${autoHideBelow} columns`,
          "info",
        );
      } else if (verb === "status") {
        const state = !enabled
          ? "off"
          : controller
            ? "on"
            : hiddenByWidth
              ? `on but hidden — terminal is narrower than ${autoHideBelow} columns`
              : "on (waiting for the split layout)";
        ctx.ui.notify(
          `Sidebar ${state}${width === undefined ? " (auto width)" : ` at ${width} columns`}; auto-hide ${
            autoHideBelow === 0 ? "disabled" : `below ${autoHideBelow} columns`}`,
          "info",
        );
      } else {
        ctx.ui.notify("Usage: /sidebar [on|off|toggle|width <columns>|autohide [n|off|default]|status]", "warning");
      }
    },
  });
  pi.registerShortcut("ctrl+alt+b", {
    description: "Toggle the right sidebar",
    handler: async () => setEnabled(!enabled),
  });

  return {
    statusLine: () => `${enabled ? "on" : "off"} · width ${width ?? "auto"} · ${autoHideBelow === 0 ? "auto-hide off" : `auto-hide below ${autoHideBelow} cols`}${hiddenByWidth ? " · hidden now" : ""}`,
    isEnabled: () => enabled,
    setEnabled,
    setWidth: applyWidth,
    autoHideBelow: () => autoHideBelow,
    setAutoHideBelow: applyAutoHide,
  };
}
