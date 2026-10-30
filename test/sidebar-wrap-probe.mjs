// Regression probe: the bundled sidebar wraps the layout root that the
// stereo split mounted. TranscriptLayout.attach() re-runs on every message
// update; it must leave the mounted split alone while the sidebar's wrapper
// owns the root (no dispose, no warning) and still warn for unknown roots.
import { agentEnv } from "./harness.mjs";

const { jiti, url } = agentEnv({ "transcript.json": "{}" }, "ppsv-wrap-");
const bridges = await jiti.import(url("../extensions/integrated/bridges.ts"));
const { TranscriptLayout } = await jiti.import(url("../extensions/stereo-view/layout.ts"));
const { defaults } = await jiti.import(url("../extensions/stereo-view/preferences.ts"));

const VIEWPORT = Symbol.for("@earendil-works/pi-tui/viewport");
const makeTui = (layoutRoot) => ({
  [VIEWPORT]: true,
  layoutRoot,
  getFocusedComponent: () => undefined,
  requestRender() {},
  terminal: { columns: 200, rows: 50 },
});
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text, borderColor: (text) => text };
const build = (warnings) => new TranscriptLayout(
  { ...defaults }, () => theme, (message) => warnings.push(message), () => {},
  { observe() {}, reset() {} }, () => {}, () => {},
);

// 1. The sidebar's wrapper root must attach silently (this is what the fix
//    guards: previously every message_update disposed the split + warned).
const wrapper = {};
bridges.markForeignLayoutRoot(wrapper);
const wrapperWarnings = [];
build(wrapperWarnings).attach(makeTui(wrapper));

// 2. An unknown root must still warn (fix must not blind the guard).
const stranger = {};
const strangerWarnings = [];
build(strangerWarnings).attach(makeTui(stranger));

// 3. A null layout root (pi mid-rebuild after a /settings TUI-mode switch)
//    must be silent: undefined cannot latch into the rejected-roots WeakSet,
//    so warning here repeated on every keystroke of the stale host.
const rootlessWarnings = [];
build(rootlessWarnings).attach(makeTui(undefined));

const wrapperSilent = wrapperWarnings.length === 0;
const strangerWarned = strangerWarnings.some((message) => message.includes("fullscreen layout is not supported"));
const rootlessSilent = rootlessWarnings.length === 0;

console.log(`WRAPPER  warnings=${wrapperWarnings.length} (expect 0)`);
console.log(`STRANGER warned=${String(strangerWarned)} (expect true)`);
console.log(`ROOTLESS warnings=${rootlessWarnings.length} (expect 0)`);
console.log(wrapperSilent && strangerWarned && rootlessSilent ? "WRAP PROBE PASS" : "WRAP PROBE FAIL");
process.exit(wrapperSilent && strangerWarned && rootlessSilent ? 0 : 1);
