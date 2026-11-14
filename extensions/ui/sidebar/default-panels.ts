import { uiScheduler, type Cancel } from "../../shared/scheduler.js";
import type { ContextUsage, Theme } from "@earendil-works/pi-coding-agent";
import { ScrollView, VStack, type Component } from "@earendil-works/pi-tui";
import type { RunActivitySnapshot } from "../ctx/activity.ts";
import type { ContextEstimate } from "../ctx/data.ts";
import { ContextPanel } from "../ctx/panel.ts";
import { ToolViewPanel } from "../tool-view/panel.ts";
import { panelBottom } from "./panel.ts";
import type { ToolViewMode } from "../tool-view/types.ts";
import type { ToolUsageSnapshot } from "../tool-view/usage.ts";
import type { SidebarPanelDefinition } from "./registry.ts";

export const CONTEXT_PANEL_ID = "context";
export const TOOL_VIEW_PANEL_ID = "tool-view";

class ToolViewScrollView extends VStack {
  readonly scrollView: ScrollView;

  constructor(panel: ToolViewPanel, theme: Theme) {
    const scrollView = new ScrollView(panel, {
      follow: "none",
      overscroll: "chain",
      scrollbar: "hidden",
      scrollbarTrackStyle: (text: string) => theme.fg("accent", text),
      scrollbarThumbStyle: (text: string) => theme.fg("accent", text),
    });
    const bottomBorder: Component = {
      render: (width) => [panelBottom(theme, width)],
      invalidate(): void {},
    };
    super([
      { component: scrollView, grow: 1, shrink: 1, minSize: 0 },
      { component: bottomBorder, basis: 1, grow: 0, shrink: 0, minSize: 1 },
    ], { gap: 0, align: "stretch" });
    this.scrollView = scrollView;
  }

  get scrollTop(): number { return this.scrollView.scrollTop; }
  get isFollowingEnd(): boolean { return this.scrollView.isFollowingEnd; }
  get viewportHeight(): number { return this.scrollView.viewportHeight; }
  get scrollbar(): "hidden" | "auto" | "always" { return this.scrollView.scrollbar; }
  updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
    this.scrollView.updateLayout(contentHeight, viewportHeight, requestRender);
    this.scrollView.setScrollbar(contentHeight > viewportHeight ? "always" : "hidden");
  }
}

export function createToolViewScrollView(panel: ToolViewPanel, theme: Theme): ToolViewScrollView {
  // Keep the panel identity and mode selector visible by default. Following
  // the end makes a long usage list look like the Tool View disappeared,
  // because its title and selector are scrolled out of the viewport.
  return new ToolViewScrollView(panel, theme);
}

export type DefaultSidebarPanelOptions = {
  readonly getContextEstimate?: () => ContextEstimate;
  readonly getContextDelta?: () => number | undefined;
  readonly getActivity?: () => RunActivitySnapshot | undefined;
  readonly getCacheHitRate?: () => number | undefined;
  readonly getContextUsage: () => ContextUsage | undefined;
  readonly getModel: () => string;
  readonly getThinkingLevel: () => string;
  readonly getToolViewMode: () => ToolViewMode | undefined;
  readonly getToolUsage: () => ToolUsageSnapshot | undefined;
  readonly onSelectToolViewMode: (mode: ToolViewMode) => void;
};

class AdaptiveScrollView extends ScrollView {
  override updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
    super.updateLayout(contentHeight, viewportHeight, requestRender);
    this.setScrollbar(contentHeight > viewportHeight ? "always" : "hidden");
  }
}

export function createDefaultSidebarPanels(
  options: DefaultSidebarPanelOptions,
): readonly SidebarPanelDefinition[] {
  const allPanels: readonly SidebarPanelDefinition[] = [{
    id: CONTEXT_PANEL_ID,
    layout: { minSize: 10, maxSize: ({ terminalRows }) => Math.max(10, Math.floor(terminalRows * 0.35)) },
    create({ tui, theme, getDesiredWidth, cacheRender }) {
      const panel = new ContextPanel(theme, {
          getEstimate: options.getContextEstimate,
          getDelta: options.getContextDelta,
          getActivity: options.getActivity,
          now: () => Date.now(),
          getCacheHitRate: options.getCacheHitRate,
          getUsage: options.getContextUsage,
          getModel: options.getModel,
          getThinkingLevel: options.getThinkingLevel,
          getDesiredWidth,
      });
      cacheRender?.(panel);
      // Keep elapsed time current during a run, but avoid waking an idle TUI.
      // Activity transitions call sidebar.refresh(), which starts/stops this ticker.
      let renderTimer: Cancel | undefined;
      const syncTicker = (): void => {
        if (options.getActivity?.()?.phase === "running") {
          if (!renderTimer) {
            renderTimer = uiScheduler.repeat(() => tui.requestRender(), 1_000);
          }
        } else if (renderTimer) {
          renderTimer();
          renderTimer = undefined;
        }
      };
      syncTicker();
      return {
        component: new AdaptiveScrollView(panel, { follow: "none", overscroll: "chain", scrollbar: "hidden" }),
        refresh(): void { syncTicker(); },
        dispose(): void {
          if (renderTimer) renderTimer();
          renderTimer = undefined;
        },
      };
    },
  }, {
    id: TOOL_VIEW_PANEL_ID,
    layout: {
      minSize: 3,
      maxSize: ({ terminalRows }) => Math.max(3, Math.floor(terminalRows * 0.35)),
    },
    create({ tui, theme, getDesiredWidth, cacheRender }) {
      const panel = new ToolViewPanel(theme, {
        tui,
        getDesiredWidth,
        getMode: options.getToolViewMode,
        getUsage: options.getToolUsage,
        onSelect: options.onSelectToolViewMode,
        showBottomBorder: false,
      });
      cacheRender?.(panel);
      const scroll = createToolViewScrollView(panel, theme);
      return {
        component: scroll,
        dispose(): void { panel.dispose(); },
      };
    },
  }];
  return allPanels;
}