/**
 * In-package event bridges that keep layout owners from stepping on each
 * other. The sidebar must wrap the layout root the stereo split already
 * mounted, and it must be released before the stereo layout disposes, so the
 * two pieces of the same package coordinate here instead of guessing order.
 */

type Listener = () => void;

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
  statusLine(): string;
  openSettings(ui: unknown): Promise<void>;
};

let stereoBridge: StereoBridge | undefined;
export const setStereoBridge = (bridge: StereoBridge): void => { stereoBridge = bridge; };
export const getStereoBridge = (): StereoBridge | undefined => stereoBridge;

export type PowerlineBridge = {
  statusLine(): string;
  enabled(): boolean;
  placement(): "above" | "below";
  preset(): string;
  runCommand(args: string, ctx: unknown): Promise<void>;
};

let powerlineBridge: PowerlineBridge | undefined;
export const setPowerlineBridge = (bridge: PowerlineBridge): void => { powerlineBridge = bridge; };
export const getPowerlineBridge = (): PowerlineBridge | undefined => powerlineBridge;

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
