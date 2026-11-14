import { fileURLToPath } from "node:url";
import { sep } from "node:path";
import { OWN_BUNDLE_SOURCE } from "./store.js";

/**
 * Which extension produced a notice. Pi gives `notify` no identity, so the
 * emitting file comes from the capture stack: the first frame that belongs to
 * neither Pi nor this bundle's router. Frames from a bundled binary (`$bunfs`)
 * and from the router's own plumbing are skipped, because the wrapper is what
 * called `new Error()`.
 */

const HERE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = HERE.slice(0, HERE.lastIndexOf(`${sep}extensions${sep}`));

/** Frames that belong to Pi itself, its vendored packages, or Node. */
const HOST_FRAME = /(?:^|[/$])\$bunfs[/$]|^node:|\/node\/internal\/|(?:^|[/$])native$|\/@earendil-works\/|\/@mariozechner\/|\/pi-tui\/|\/pi-coding-agent\/|\/pi-agent-core\/|\/pi-ai\/|\/typescript\/|\/dist\/bundle\//;

/** This package's own plumbing, which would otherwise read as "ui-bundle". */
const ROUTER_FRAME = /notice-router\./;

/**
 * Pi's notice path and this bundle's patches of it. All of them sit between the
 * extension that spoke and the capture, so naming one as the source would blame
 * the wrong package.
 */
const NOTICE_PATH_NAMES = new Set([
  "captureNoticeStack", "noticeRouterNotify", "patchedShowExtensionNotify",
  "showExtensionNotify", "showWarning", "showError", "showStatus",
]);

function frameName(line: string): string {
  return /^\s*at\s+(?:new\s+)?([^\s(]+)/.exec(line)?.[1] ?? "";
}

function framePath(line: string): string | undefined {
  const parenthesised = /\(([^)]+)\)\s*$/.exec(line);
  const raw = (parenthesised ? parenthesised[1] : line.replace(/^\s*at\s+/, "")).trim();
  const path = raw.startsWith("file://") ? fileURLToPath(raw) : raw;
  if (!path || path === "native" || !(/^[/_a-zA-Z]/.test(path) || /^[A-Za-z]:[\\//]/.test(path))) return undefined;
  return path.replace(/(?::\d+){1,2}$/, "");
}

function packageName(path: string): string | undefined {
  const match = /(?:^|[/\\])node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)[/\\]/.exec(path);
  if (!match) return undefined;
  const name = match[1].replace(/\\/g, "/");
  return name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
}

function fileLabel(path: string): string {
  const normalised = path.replace(/\\/g, "/");
  const slash = normalised.lastIndexOf("/");
  const file = slash < 0 ? normalised : normalised.slice(slash + 1);
  const directory = slash < 0 ? "" : normalised.slice(0, slash);
  const base = file.replace(/\.[cm]?[jt]s$/, "");
  // An index file says nothing about who talked; the directory it lives in does.
  if (base && base !== "index" && base !== "main" && base !== "mod") return base;
  const dirSlash = directory.lastIndexOf("/");
  return (dirSlash < 0 ? directory : directory.slice(dirSlash + 1)) || base || "unknown";
}

/** `packages/pi-lens/dist/index.js` and a scoped install both read as `pi-lens`. */
export function noticeSource(stack: string | undefined): string {
  for (const line of (stack ?? "").split("\n").slice(1)) {
    if (ROUTER_FRAME.test(line) || NOTICE_PATH_NAMES.has(frameName(line))) continue;
    const path = framePath(line);
    if (!path) continue;
    if (PACKAGE_ROOT && path.startsWith(PACKAGE_ROOT)) return OWN_BUNDLE_SOURCE;
    if (HOST_FRAME.test(path)) continue;
    return packageName(path) ?? fileLabel(path);
  }
  return "unknown";
}

/**
 * The stack at the notify boundary. Taken here rather than at the call site so
 * the router's own frame is the one `noticeSource` can recognise and skip.
 */
export function captureNoticeStack(): string | undefined {
  return new Error("notice-source").stack;
}
