import { WorkState, connectSubagentEvents, type WorkKind } from "../ui/work/state.js";
import { WorkPanel } from "../ui/work/panel.js";
import { openWorkOutput } from "../ui/work/output.js";
import { readSettings, updateSettings } from "./settings-store.js";
import { estimateTokens, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ScrollView, Text } from "@earendil-works/pi-tui";
import { installSidebar, type SidebarController } from "../ui/sidebar/index.js";
import { createDefaultSidebarPanels } from "../ui/sidebar/default-panels.js";
import { installContextEstimates } from "../ui/ctx/data.js";
import { createActivityTracker, createStreamingTokenSampler, type ActivityTracker } from "../ui/ctx/activity.js";
import { createToolUsageTracker, type ToolUsageTracker } from "../ui/tool-view/usage.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./config.js";
import { isStereoAttached, onStereoAttached, onStereoDetaching } from "./ui-runtime.js";

type UsageLike = { input?: unknown; cacheRead?: unknown; cacheWrite?: unknown; output?: unknown };


/**
 * Right-side sidebar (sessions, context, tool usage) from pi-ui-extension,
 * mounted over whatever layout the stereo split owns and fully toggleable.
 */
export type SidebarControls = {
  isPanelEnabled(kind: WorkKind): boolean;
  setPanelEnabled(kind: WorkKind, on: boolean): void;
  runCommand(args: string, ctx: any): Promise<void>;
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
  const work = new WorkState();
  work.subscribe(refresh);
  let disconnectWork = () => {};
  const workInputs = new Map<string, unknown>();
  const workSettings = readSettings();
  const panelsEnabled = {
    subagent: workSettings.subagentPanelEnabled !== false,
    process: workSettings.processPanelEnabled !== false,
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
        const panels = [...createDefaultSidebarPanels({
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
        }), ...(["subagent", "process"] as const).filter((kind) => panelsEnabled[kind]).map((kind) => ({
          id: kind,
          layout: { minSize: 3, maxSize: 10 },
          create: () => ({
            component: new ScrollView(new WorkPanel(theme, work, kind, (item) => {
              void openWorkOutput(ctx, work, item).catch((error) => ctx.ui.notify(String(error), "error"));
            }), { scrollbar: "hidden", follow: "none" }),
          }),
        }))];
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
    disconnectWork();
    workInputs.clear();
    work.rebuild(currentBranch(ctx));
    disconnectWork = connectSubagentEvents(pi, work);
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
    disconnectWork();
    work.clear();
    workInputs.clear();
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
    workInputs.set(event.toolCallId, event.args);
    activity?.startTool(event);
    refresh();
  });
  pi.on("tool_execution_end", (event) => {
    work.observeTool(event.toolName, { ...event.result, isError: event.isError }, workInputs.get(event.toolCallId));
    workInputs.delete(event.toolCallId);
    activity?.finishTool(event);
    toolUsage?.record(event);
    refresh();
  });
  pi.on("agent_settled", (event) => {
    activity?.settle(undefined, (event as { aborted?: boolean }).aborted === true);
    refresh();
  });
  pi.on("turn_end", (event) => {
    activity?.finishTurn(event.turnIndex);
    refresh();
  });
  pi.on("session_tree", () => {
    if (lastCtx) {
      const branch = currentBranch(lastCtx);
      work.rebuild(branch);
      resetCacheUsage(branch);
      toolUsage?.resetSession(branch, mcpServerNames());
    }
    refresh();
  });
  pi.on("session_info_changed", refresh);
  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);

  // --- Controls ---------------------------------------------------------------

  const runSidebarCommand = async (args, ctx) => {
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
    };
  pi.registerShortcut("ctrl+alt+b", {
    description: "Toggle the right sidebar",
    handler: async () => setEnabled(!enabled),
  });

  return {
    isPanelEnabled: (kind) => panelsEnabled[kind],
    setPanelEnabled: (kind, on) => {
      panelsEnabled[kind] = on;
      updateSettings((plane) => ({ ...plane, [kind === "subagent" ? "subagentPanelEnabled" : "processPanelEnabled"]: on }));
      teardownController();
      if (reinstallRef) reinstallRef();
      else if (lastCtx) void mountSidebar(lastCtx);
    },
    runCommand: runSidebarCommand,
    statusLine: () => `${enabled ? "on" : "off"} · width ${width ?? "auto"} · ${autoHideBelow === 0 ? "auto-hide off" : `auto-hide below ${autoHideBelow} cols`}${hiddenByWidth ? " · hidden now" : ""}`,
    isEnabled: () => enabled,
    setEnabled,
    setWidth: applyWidth,
    autoHideBelow: () => autoHideBelow,
    setAutoHideBelow: applyAutoHide,
  };
}
