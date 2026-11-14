import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { getPowerlineBridge, setNoticeBridge, type NoticeBridge } from "./ui-runtime.js";
import { readSection, updateSection } from "./settings-store.js";
import { captureNoticeStack, noticeSource } from "../ui/notices/source.js";
import { noticeDebugRow } from "../ui/notices/debug.js";
import { openNoticeInbox } from "../ui/notices/overlay.js";
import { OWN_BUNDLE_SOURCE, formatNoticeSummary, isNoticeLevel, noticeStore, type NoticeLevel } from "../ui/notices/store.js";

/**
 * Extension notices without the transcript damage.
 *
 * Pi renders every `ctx.ui.notify` straight into the chat: an `info` line, or a
 * `Warning:`/`Error:` line for the rest. Startup chatter from pi-lens, pi-mise
 * and friends therefore lands between a message and its reply, with no
 * scrollback kept for it. This wraps Pi's notify path, files the message in an
 * inbox, and lets the status bar count it: `/ui notices` or `ctrl+alt+n` lists
 * what each extension said.
 *
 * The wrap is installed at the first session start, not at load. This bundle's
 * own pretty-tui patches the same method, and whichever patch is applied last
 * is the one Pi calls — wrapping after every extension has loaded puts this
 * one on top, so a routed notice is suppressed before it can be drawn.
 */

type NoticeSettings = { external: boolean; inlineLevels: NoticeLevel[] };

const STATUS_KEY = "notices";
const WRAP_FLAG = Symbol.for("pi-pretty-stereo-view.noticeRouter");

type NotifyLike = (message: string, type?: NoticeLevel) => void;
type NotifyHost = { ui: Pick<ExtensionUIContext, "notify"> };

function readLevels(value: unknown): NoticeLevel[] {
  return Array.isArray(value) ? [...new Set(value.filter(isNoticeLevel))] : [];
}

function loadNoticeSettings(): NoticeSettings {
  const saved = readSection("notices");
  return { external: saved.external !== false, inlineLevels: readLevels(saved.inlineLevels) };
}

function persist(settings: NoticeSettings): void {
  updateSection("notices", () => ({ external: settings.external, inlineLevels: settings.inlineLevels }));
}

let settings: NoticeSettings = loadNoticeSettings();
let wrapped = false;
let wrapReason: string | undefined;
/** Notices the wrap has handled, whether routed or left in the transcript. */
let wrapHits = 0;
let inlinePassThrough = false;
let statusUi: ExtensionUIContext | undefined;
let statusShown = false;

/** A notice the bundle wants printed now (command feedback), inbox aside. */
export function notifyInline(ctx: NotifyHost, message: string, level: NoticeLevel = "info"): void {
  inlinePassThrough = true;
  try {
    ctx.ui.notify(message, level);
  } finally {
    inlinePassThrough = false;
  }
}

function statusText(): string {
  const counts = noticeStore.counts();
  return `⚠ ${counts.unread} notice${counts.unread === 1 ? "" : "s"} · /ui notices`;
}

/** With the status bar off there is no segment to read, so use Pi's own footer. */
function syncStatusFallback(): void {
  if (!statusUi) return;
  const show = noticeStore.counts().unread > 0 && !(getPowerlineBridge()?.enabled() ?? false);
  if (show) statusUi.setStatus(STATUS_KEY, statusText());
  else if (statusShown) statusUi.setStatus(STATUS_KEY, undefined);
  statusShown = show;
}

/**
 * Take one notice or leave it to Pi. Returns whether Pi must still draw it:
 * false means the inbox owns the notice now.
 */
function shouldPrint(message: string, type: unknown): boolean {
  if (inlinePassThrough) return true;
  const level = isNoticeLevel(type) ? type : "info";
  const source = noticeSource(captureNoticeStack());
  if (source !== OWN_BUNDLE_SOURCE && !settings.external) return true;
  noticeStore.record({ level, message, source });
  const print = settings.inlineLevels.includes(level);
  noticeDebugRow({ evt: "notice", level, source, print, message: message.slice(0, 80) });
  return print;
}

/**
 * Wrap the notify path as it stands right now, chaining to whatever patch is
 * already there so another component's rendering still applies to the notices
 * this bundle leaves in place.
 */
function installNotifyWrap(): void {
  // SAFETY: InteractiveMode is exported as a class; the guard below proves the
  // method exists before it is read as one.
  const prototype = (InteractiveMode as unknown as { prototype?: Record<string | symbol, unknown> })?.prototype;
  if (!prototype || typeof prototype.showExtensionNotify !== "function") {
    wrapReason = "this Pi build exposes no extension notify path to wrap";
    noticeDebugRow({ evt: "wrap-unavailable", reason: wrapReason });
    return;
  }
  if (!prototype[WRAP_FLAG]) {
    // SAFETY: the typeof check above proves this is the notify method.
    const below = prototype.showExtensionNotify as NotifyLike;
    prototype[WRAP_FLAG] = below;
    prototype.showExtensionNotify = function noticeRouterNotify(this: unknown, message: unknown, type: unknown): void {
      wrapHits += 1;
      let print = true;
      try {
        print = shouldPrint(String(message), type);
      } catch (error) {
        print = true;
        noticeDebugRow({ evt: "notice-error", error: String(error) });
      }
      if (print) below.call(this, String(message), isNoticeLevel(type) ? type : "info");
    };
  }
  wrapped = true;
  wrapReason = undefined;
  noticeDebugRow({ evt: "wrap-installed" });
}

function wrapSummary(): string {
  if (!wrapped) return ` · wrap off (${wrapReason ?? "not installed yet"})`;
  return ` · wrap on · ${wrapHits} seen`;
}

export function installNoticeRouter(pi: ExtensionAPI): NoticeBridge {
  const bridge: NoticeBridge = {
    statusLine: () => {
      const counts = noticeStore.counts();
      const routed = counts.total === 0 ? "none yet" : formatNoticeSummary(counts);
      const route = [
        settings.external ? "all extensions" : "ui-bundle only",
        settings.inlineLevels.length > 0 ? `inline ${settings.inlineLevels.join("+")}` : "",
      ].filter(Boolean).join(", ");
      return `${routed} · ${counts.unread} unread · ${route}${wrapSummary()}`;
    },
    unread: () => noticeStore.counts().unread,
    external: () => settings.external,
    setExternal: (on: boolean) => {
      settings = { ...settings, external: on };
      persist(settings);
    },
    inlineLevels: () => [...settings.inlineLevels],
    toggleInlineLevel: (level: NoticeLevel) => {
      const inline = settings.inlineLevels.includes(level)
        ? settings.inlineLevels.filter((entry) => entry !== level)
        : [...settings.inlineLevels, level];
      settings = { ...settings, inlineLevels: inline };
      persist(settings);
    },
    patched: () => wrapped,
    unavailableReason: () => wrapReason,
    runCommand: (args: string, ctx: ExtensionContext) => runNoticeCommand(bridge, args, ctx),
  };
  setNoticeBridge(bridge);

  noticeStore.subscribe(syncStatusFallback);
  pi.on("session_start", (event, ctx) => {
    statusUi = ctx.ui;
    // Every extension has finished patching by now, so this wrap ends up on top.
    installNotifyWrap();
    if (event.reason !== "reload") noticeStore.clear();
    syncStatusFallback();
  });
  pi.registerShortcut("ctrl+alt+n", {
    description: "Show extension notices collected outside the transcript",
    handler: async (ctx) => { await openNoticeInbox(ctx); },
  });
  return bridge;
}

async function runNoticeCommand(bridge: NoticeBridge, args: string, ctx: ExtensionContext): Promise<void> {
  const [action = "", ...rest] = args.trim().split(/\s+/);
  if (action === "" || action === "open") {
    await openNoticeInbox(ctx);
    return;
  }
  if (action === "clear") {
    noticeStore.clear();
    notifyInline(ctx, "Notice inbox cleared");
    return;
  }
  if (action === "status") {
    notifyInline(ctx, bridge.statusLine());
    return;
  }
  if (action === "external") {
    bridge.setExternal(!settings.external);
    notifyInline(ctx, settings.external
      ? "Extension notices now route to the inbox (ctrl+alt+n)"
      : "Extension notices print in the transcript again (this bundle's still route)");
    return;
  }
  if (action === "inline") {
    const level = rest[0];
    if (!isNoticeLevel(level)) {
      notifyInline(ctx, "Usage: /ui notices inline [info|warning|error]", "warning");
      return;
    }
    bridge.toggleInlineLevel(level);
    notifyInline(ctx, `${level} notices now ${settings.inlineLevels.includes(level) ? "also print in the transcript" : "only appear in the inbox"}`);
    return;
  }
  notifyInline(ctx, "Usage: /ui notices [open|clear|status|external|inline <level>]", "warning");
}
