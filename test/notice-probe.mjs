// The notice router: Pi's notify path is wrapped, notices are filed by the
// extension that emitted them, and notices left in place still reach whatever
// patch was already there. The stack fixtures for attribution were captured
// from a real Pi-Bolt session running pi-lens and pi-mise.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { agentEnv } from "./harness.mjs";

// A caller outside the package root stands in for a third-party extension: the
// router reads the emitting file out of the stack, so its path must lie outside
// this checkout the way pi-lens' and pi-mise's do.
const FOREIGN_MODULE = `export function notifyThrough(target, message, type) {
  target.showExtensionNotify(message, type);
}
`;

const { dir, module: loadModule } = agentEnv({ "foreign-notify.mjs": FOREIGN_MODULE }, "ppsv-notice-");
const foreign = await import(pathToFileURL(join(dir, "foreign-notify.mjs")).href);

const store = await loadModule("extensions/ui/notices/store.ts");
const noticesSource = await loadModule("extensions/ui/notices/source.js".replace(".js", ".ts"));
const overlay = await loadModule("extensions/ui/notices/overlay.ts");
const router = await loadModule("extensions/integrated/notice-router.ts");
const { InteractiveMode } = await import("@earendil-works/pi-coding-agent");

const prototype = InteractiveMode.prototype;
const piNative = prototype.showExtensionNotify;
assert.equal(typeof piNative, "function", "this Pi build must expose showExtensionNotify for the probe");

// Pi's own render path, as pretty-tui would leave it: this bundle patches the
// same method, and it patches at load, before this router wraps at session start.
const printed = [];
function patchedShowExtensionNotify(message, type) { printed.push([message, type]); }
prototype.showExtensionNotify = patchedShowExtensionNotify;

const handlers = [];
const bridge = router.installNoticeRouter({
  on: (name, handler) => handlers.push([name, handler]),
  registerShortcut: () => {},
});
const host = { name: "host" };
const ui = {
  notify: (message, type) => prototype.showExtensionNotify.call(host, message, type),
  setStatus: () => {},
};
const ctx = { hasUI: true, mode: "tui", ui };
store.noticeStore.clear();

const fromExtension = (message, type) => foreign.notifyThrough(prototype, message, type);
const fromBundle = (message, type) => prototype.showExtensionNotify.call(host, message, type);

// --- the wrap waits for a session so it lands on top of the other patch -----
assert.doesNotMatch(bridge.statusLine(), /wrap on/, "nothing is wrapped before a session starts");
for (const [, handler] of handlers.filter(([name]) => name === "session_start")) await handler({ reason: "startup" }, ctx);
assert.match(bridge.statusLine(), /wrap on/, "the wrap installed at session start");

// --- notices leave the transcript -------------------------------------------
fromExtension("image-check.py: not analyzed", "warning");
assert.deepEqual(printed, [], "a routed notice never reaches the render path below");
assert.equal(store.noticeStore.counts().total, 1);
assert.equal(store.noticeStore.counts().byLevel.warning, 1);
assert.equal(store.noticeStore.list()[0].message, "image-check.py: not analyzed");
assert.equal(store.noticeStore.list()[0].source, "foreign-notify", "the emitting file names the source");

fromExtension("mise activated (mise.toml)", "info");
fromExtension("image-check.py: not analyzed", "warning");
assert.equal(store.noticeStore.counts().total, 3);
assert.equal(store.noticeStore.list().length, 2, "a repeat raises the counter instead of adding a row");
assert.equal(store.noticeStore.list().at(-1).repeats, 2);
assert.equal(store.noticeStore.list().at(-1).level, "warning", "the newest notice sits last");

fromExtension("cannot read the plan", "error");
assert.equal(store.noticeStore.counts().byLevel.error, 1);

// --- levels and scope -------------------------------------------------------
store.noticeStore.markRead();
assert.equal(store.noticeStore.counts().unread, 0);
assert.ok(store.noticeStore.counts().total > 0, "reading clears the count, not the history");

bridge.toggleInlineLevel("warning");
printed.length = 0;
const beforeInline = store.noticeStore.counts().total;
fromExtension("slow filesystem", "warning");
assert.deepEqual(printed, [["slow filesystem", "warning"]], "an inline level still reaches the patch below");
assert.equal(store.noticeStore.counts().total, beforeInline + 1, "inline notices are still filed");
bridge.toggleInlineLevel("warning");

bridge.setExternal(false);
printed.length = 0;
const beforeExternal = store.noticeStore.counts().total;
fromExtension("another extension talking", "error");
assert.equal(printed.length, 1, "with routing off Pi prints again");
assert.equal(store.noticeStore.counts().total, beforeExternal, "unrouted notices are not filed twice");

// This bundle's own notices route even when other extensions' do not.
printed.length = 0;
fromBundle("ui-bundle chatter", "warning");
assert.deepEqual(printed, [], "the bundle always routes its own notices");
assert.equal(store.noticeStore.counts().total, beforeExternal + 1);
assert.equal(store.noticeStore.list().at(-1).source, store.OWN_BUNDLE_SOURCE);

// Command feedback prints once and is not filed.
printed.length = 0;
const beforeFeedback = store.noticeStore.counts().total;
router.notifyInline({ ui }, "Notice inbox cleared");
assert.deepEqual(printed, [["Notice inbox cleared", "info"]], "pass-through feedback prints");
assert.equal(store.noticeStore.counts().total, beforeFeedback, "pass-through feedback is not filed");
bridge.setExternal(true);

// Installing twice must not stack two wraps on the same method.
const wrapped = prototype.showExtensionNotify;
router.installNoticeRouter({ on: () => {}, registerShortcut: () => {} });
for (const [, handler] of handlers.filter(() => false)) void handler;
assert.equal(prototype.showExtensionNotify, wrapped, "the wrap is installed once");

// --- settings persist in the bundle's own plane -----------------------------
const plane = JSON.parse(readFileSync(join(dir, "pi-pretty-stereo-view.json"), "utf8"));
assert.equal(plane.notices.external, true);
assert.deepEqual(plane.notices.inlineLevels, []);

// Commands answer without Pi's transcript.
printed.length = 0;
await bridge.runCommand("status", { hasUI: false, ui: { notify: (message, type) => printed.push([message, type]), setStatus: () => {} } });
assert.equal(printed.length, 1);
assert.match(printed[0][0], /unread/);
printed.length = 0;
await bridge.runCommand("nonsense", { hasUI: false, ui: { notify: (message, type) => printed.push([message, type]) } });
assert.match(printed[0][0], /Usage: \/ui notices/);

// --- attribution over frames a real session produced ------------------------
const lensStack = [
  "Error",
  "    at captureNoticeStack (/bundle/extensions/ui/notices/source.ts:40:10)",
  "    at noticeRouterNotify (/bundle/extensions/integrated/notice-router.ts:100:5)",
  "    at notifyUi (/home/ravi/.pi/agent/npm/node_modules/pi-lens/dist/index.js:158635:12)",
  "    at emit (/$bunfs/root/cli-6retfc57.js:17577:46)",
  "    at bindExtensions (native)",
].join("\n");
const miseStack = [
  "Error",
  "    at captureNoticeStack (/bundle/extensions/ui/notices/source.ts:40:10)",
  "    at noticeRouterNotify (/bundle/extensions/integrated/notice-router.ts:100:5)",
  "    at patchedShowExtensionNotify (/bundle/extensions/pretty-tui/interactive-mode.ts:107:3)",
  "    at <anonymous> (/home/ravi/.pi/agent/npm/node_modules/@capotej/pi-mise/dist/index.js:214:20)",
  "    at emit (/$bunfs/root/cli-6retfc57.js:17577:46)",
].join("\n");
const blindStack = "Error\n    at captureNoticeStack (/bundle/extensions/ui/notices/source.ts:40:10)\n    at processTicksAndRejections (native)";
assert.equal(noticesSource.noticeSource(lensStack), "pi-lens");
assert.equal(noticesSource.noticeSource(miseStack), "pi-mise", "a scoped package reads by its name");
assert.equal(noticesSource.noticeSource(blindStack), "unknown", "an unreadable stack is unknown, not a guess");
assert.equal(noticesSource.noticeSource(undefined), "unknown");
assert.equal(noticesSource.noticeSource(`Error\n    at x (${process.cwd()}/extensions/powerline/index.ts:1:1)`), store.OWN_BUNDLE_SOURCE);

// --- inbox rendering needs no terminal -------------------------------------
const inbox = new store.NoticeStore();
inbox.record({ level: "warning", message: "image-check.py: not analyzed", source: "pi-lens", at: 1000 });
inbox.record({ level: "info", message: "mise activated (mise.toml)", source: "pi-mise", at: 2000 });
inbox.record({ level: "error", message: "line one\nline two", source: "pi-lens", at: 3000 });
const plain = { fg: (_color, text) => text };
const lines = overlay.noticeInboxLines(inbox, { width: 60, top: 0, now: 4000, theme: plain });
const text = lines.join("\n");
for (const want of ["Notices", "pi-lens", "pi-mise", "mise activated (mise.toml)", "line one"]) {
  assert.ok(text.includes(want), `the inbox must show ${want}`);
}
const { stripTerminalSequences } = await import("@earendil-works/pi-tui");
const visible = (rows) => rows.map((row) => stripTerminalSequences(row).length);
assert.ok(visible(lines).every((width) => width <= 60), "the inbox must fit the panel width");
for (const width of [30, 44]) {
  const narrowLines = overlay.noticeInboxLines(inbox, { width, top: 0, now: 4000, theme: plain });
  assert.ok(visible(narrowLines).every((used) => used <= width), `the inbox must fit ${width} columns`);
}
assert.match(overlay.noticeInboxLines(new store.NoticeStore(), { width: 60, top: 0, now: 1, theme: plain }).join("\n"), /none this session/);

// --- the status bar badge ---------------------------------------------------
const segments = await loadModule("extensions/powerline/segments.ts");
const plainContext = { options: {}, theme: { fg: (_color, text) => text }, colors: {} };
store.noticeStore.clear();
assert.equal(segments.SEGMENTS.notices.render(plainContext).visible, false, "an empty inbox shows no badge");
store.noticeStore.record({ level: "warning", message: "two", source: "pi-lens", at: 1 });
store.noticeStore.record({ level: "info", message: "one", source: "pi-mise", at: 1 });
const badge = segments.SEGMENTS.notices.render(plainContext);
assert.equal(badge.visible, true);
assert.match(badge.content, /2/);
assert.match(badge.content, /pi-lens/, "the loudest source names the badge");
store.noticeStore.markRead();
assert.equal(segments.SEGMENTS.notices.render(plainContext).visible, false, "read notices clear the badge");
store.noticeStore.record({ level: "error", message: "three", source: "pi-lens", at: 2 });
const narrowBadge = segments.SEGMENTS.notices.render({ ...plainContext, options: { notices: { showSource: false } } });
assert.equal(narrowBadge.visible, true, "the count still shows without the source name");
assert.doesNotMatch(narrowBadge.content, /pi-lens/, "showSource off drops the name");
store.noticeStore.clear();

prototype.showExtensionNotify = piNative;
console.log("NOTICE PASS");
