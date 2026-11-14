import { TuiAltScreen, type Component, type TUI, type TuiInputListener } from "@earendil-works/pi-tui";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NoticeLevel } from "../ui/notices/store.js";
export { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * In-package event bridges that keep layout owners from stepping on each
 * other. The sidebar must wrap the layout root the stereo split already
 * mounted, and it must be released before the stereo layout disposes, so the
 * two pieces of the same package coordinate here instead of guessing order.
 */

type Listener = () => void;

export interface AssistantPaneProjection {
  revision: object;
  activity: Component;
  chat?: Component;
  thinking: string;
  text: string;
  reveal(): void;
}
const assistantPaneProjectors = new WeakMap<object, () => AssistantPaneProjection | undefined>();
export function setAssistantPaneProjector(owner: object, project?: () => AssistantPaneProjection | undefined): void {
  if (project) assistantPaneProjectors.set(owner, project);
  else assistantPaneProjectors.delete(owner);
}
export function getAssistantPaneProjection(owner: object): AssistantPaneProjection | undefined {
  return assistantPaneProjectors.get(owner)?.();
}

const attachedListeners = new Set<Listener>();
const detachingListeners = new Set<Listener>();
let stereoAttached = false;

export function onStereoAttached(listener: Listener): () => void {
  attachedListeners.add(listener);
  return () => attachedListeners.delete(listener);
}

export function onStereoDetaching(listener: Listener): () => void {
  detachingListeners.add(listener);
  return () => detachingListeners.delete(listener);
}

export function isStereoAttached(): boolean {
  return stereoAttached;
}

export function markStereoAttached(): void {
  stereoAttached = true;
  for (const listener of [...attachedListeners]) listener();
}

export function markStereoDetaching(): void {
  stereoAttached = false;
  for (const listener of [...detachingListeners]) listener();
}

/**
 * Settings-panel bridges: each vendored extension publishes a small control
 * surface here so the unified `/ui-settings` panel can read state and apply
 * changes live, without inventing a second source of truth for any config.
 */

export type PanelUi = { notify(message: string, type?: "info" | "warning" | "error"): void };
export type PanelContext = { ui: PanelUi; reload?(): Promise<void> };

export type PrettyTuiBridge = {
  statusLine(): string;
  enabled(): boolean;
  mode(): string;
  sideBorders(): boolean;
  setMode(mode: "full" | "compact" | "clean"): void;
  setSideBorders(on: boolean): void;
  setEnabled(on: boolean, ctx: PanelContext): Promise<void>;
};

let prettyTuiBridge: PrettyTuiBridge | undefined;
export const setPrettyTuiBridge = (bridge: PrettyTuiBridge): void => { prettyTuiBridge = bridge; };
export const getPrettyTuiBridge = (): PrettyTuiBridge | undefined => prettyTuiBridge;

export type StereoBridge = {
  enabled(): boolean;
  setEnabled(on: boolean): void;
  runCommand(args: string, ctx: any): Promise<void>;
  statusLine(): string;
  openSettings(ui: unknown): Promise<void>;
};

let stereoBridge: StereoBridge | undefined;
export const setStereoBridge = (bridge: StereoBridge): void => { stereoBridge = bridge; };
export const getStereoBridge = (): StereoBridge | undefined => stereoBridge;

export type PowerlineBridge = {
  presets(): string[];
  performance(args: string, ctx: any): Promise<void>;
  statusLine(): string;
  enabled(): boolean;
  placement(): "above" | "below";
  preset(): string;
  runCommand(args: string, ctx: unknown): Promise<void>;
};

let powerlineBridge: PowerlineBridge | undefined;
export const setPowerlineBridge = (bridge: PowerlineBridge): void => { powerlineBridge = bridge; };
export const getPowerlineBridge = (): PowerlineBridge | undefined => powerlineBridge;

export type NoticeBridge = {
  statusLine(): string;
  unread(): number;
  external(): boolean;
  setExternal(on: boolean): void;
  inlineLevels(): NoticeLevel[];
  toggleInlineLevel(level: NoticeLevel): void;
  patched(): boolean;
  unavailableReason(): string | undefined;
  runCommand(args: string, ctx: ExtensionContext): Promise<void>;
};

let noticeBridge: NoticeBridge | undefined;
export const setNoticeBridge = (bridge: NoticeBridge): void => { noticeBridge = bridge; };
export const getNoticeBridge = (): NoticeBridge | undefined => noticeBridge;

/**
 * Layout-root registry: the sidebar legitimately wraps the layout root that
 * the stereo split already mounted. Stereo re-attaches on every message
 * update and terminal input; without recognizing that wrapper it disposes
 * the mounted split and warns "fullscreen layout is not supported" on the
 * first message of every session where both are active.
 */
const foreignLayoutRoots = new WeakSet<object>();
export const markForeignLayoutRoot = (root: object): void => { foreignLayoutRoots.add(root); };
export const isForeignLayoutRoot = (root: unknown): boolean =>
  typeof root === "object" && root !== null && foreignLayoutRoots.has(root);

export function setEditorChromeActive(editor: object, active: boolean): void {
  Reflect.set(editor, "powerlineEditorChromeActive", active);
}
export function editorChromeActive(editor: object): boolean {
  return Reflect.get(editor, "powerlineEditorChromeActive") === true;
}
export function editorPrototype(): any { return CustomEditor.prototype; }
export function mouseInputPrototype(): typeof TuiAltScreen.prototype { return TuiAltScreen.prototype; }
export function getLayoutRoot<T extends { layoutRoot?: any }>(host: T): T["layoutRoot"] {
  return host.layoutRoot;
}
export function setLayoutRoot(host: { setLayoutRoot(root: any): void }, root: any): void {
  host.setLayoutRoot(root);
}
export function setEditorFactory(ui: { setEditorComponent(factory: any): void }, factory: any): void {
  ui.setEditorComponent(factory);
}

const promptHistoryKey = Symbol.for("powerlinePromptHistoryState");
export function getPromptHistoryState(): { savedPromptHistory: string[] } {
  const existing = Reflect.get(globalThis, promptHistoryKey);
  if (existing && Array.isArray(existing.savedPromptHistory) && existing.savedPromptHistory.every((item: unknown) => typeof item === "string")) return existing;
  const state = { savedPromptHistory: [] };
  Reflect.set(globalThis, promptHistoryKey, state);
  return state;
}

const notifications = new Set([
  "session_start", "session_shutdown", "model_select", "thinking_level_select",
  "session_tree", "session_info_changed", "agent_start", "agent_end", "agent_settled",
  "message_start", "message_update", "message_end", "turn_start", "turn_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end",
  "session_compact", "session_compact_failed",
]);

/** Preserve notification order behind one host listener per event. Return-value events remain native. */
export function createUiRuntime(pi: ExtensionAPI): ExtensionAPI {
  type Handler = (...args: any[]) => unknown;
  const handlers = new Map<string, Handler[]>();
  const on = pi.on.bind(pi) as (event: string, handler: Handler) => void;
  return new Proxy(pi, {
    get(target, key) {
      if (key === "on") return (event: string, handler: Handler) => {
        if (!notifications.has(event)) return on(event, handler);
        const existing = handlers.get(event);
        if (existing) { existing.push(handler); return; }
        const group = [handler];
        handlers.set(event, group);
        on(event, async (...args: any[]) => {
          let firstError: unknown;
          let failed = false;
          for (const listener of group) {
            try { await listener(...args); }
            catch (error) { if (!failed) firstError = error; failed = true; }
          }
          if (failed) throw firstError;
        });
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Capturing overlays own input; the non-capturing resize preview does not. */
export function isSidebarInputBlocked(tui: TUI): boolean {
  const overlays = tui as TUI & { isOverlayFocused?: () => boolean };
  return overlays.isOverlayFocused?.() ?? tui.hasOverlay?.() ?? false;
}


/**
 * Pi has no public input-listener priority API. Prefer its normal public
 * registration when internals differ, but disable gestures that strictly
 * require priority (divider dragging) to avoid conflicting with Pi.
 */
export function installPriorityInputListener(
  tui: TUI,
  listener: TuiInputListener,
  options: { requirePriority?: boolean } = {},
): () => void {
  const listeners = (tui as unknown as { inputListeners?: unknown }).inputListeners;
  if (!(listeners instanceof Set)) {
    return options.requirePriority ? () => {} : tui.addInputListener(listener);
  }
  const unsubscribe = tui.addInputListener(listener);
  if (!listeners.has(listener)) {
    if (options.requirePriority) {
      unsubscribe();
      return () => {};
    }
    return unsubscribe;
  }
  try {
    const existing = [...listeners].filter((item) => item !== listener);
    listeners.clear();
    listeners.add(listener);
    for (const item of existing) listeners.add(item);
  } catch {
    if (options.requirePriority) {
      unsubscribe();
      return () => {};
    }
  }
  return unsubscribe;
}


export function subscribeTerminalInput(ui: ExtensionContext["ui"], listener: Parameters<ExtensionContext["ui"]["onTerminalInput"]>[0]): () => void {
  return ui.onTerminalInput(listener);
}
