import { matchesKey } from "../../shared/keys.js";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { NOTICE_GLYPHS, NOTICE_TOKENS, noticeLabel } from "./levels.js";
import { formatNoticeAge, formatNoticeTime, noticeStore, type NoticeStore } from "./store.js";

/**
 * The notice inbox: everything extensions said since the session started,
 * grouped by the extension that said it. Structural so a probe can render it
 * without a terminal.
 */

/** Only `fg` is used, so a probe can pass a plain object. */
type NoticeInboxTheme = { fg(color: string, text: string): string };

type NoticeInboxOptions = {
  width: number;
  top: number;
  now: number;
  theme: NoticeInboxTheme;
};

const INDENT = "  ";
const MAX_NOTICE_LINES = 3;

function noticeBody(message: string, width: number): string[] {
  const available = Math.max(8, width - INDENT.length - 3);
  const wrapped: string[] = [];
  for (const paragraph of message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    wrapped.push(...wrapTextWithAnsi(paragraph, available));
  }
  if (wrapped.length > MAX_NOTICE_LINES) {
    const kept = wrapped.slice(0, MAX_NOTICE_LINES);
    kept[MAX_NOTICE_LINES - 1] = `${kept[MAX_NOTICE_LINES - 1].replace(/…$/, "")}…`;
    return kept;
  }
  return wrapped.length > 0 ? wrapped : ["(empty notice)"];
}

export function noticeInboxLines(store: NoticeStore, options: NoticeInboxOptions): string[] {
  const { width, theme } = options;
  const counts = store.counts();
  const header = theme.fg("accent", "Notices");
  if (counts.total === 0) {
    return [
      truncateToWidth(`${header} — none this session`, width, ""),
      truncateToWidth(theme.fg("dim", `${INDENT}Extension notices arrive here instead of the transcript (ctrl+alt+n opens this panel).`), width, ""),
    ];
  }

  const levelParts = (["error", "warning", "info"] as const)
    .filter((level) => counts.byLevel[level] > 0)
    .map((level) => theme.fg(NOTICE_TOKENS[level], noticeLabel(counts.byLevel[level], level)));
  const sources = counts.sources.map((entry) => theme.fg("muted", entry.source)).join(theme.fg("muted", ", "));
  const unread = counts.unread > 0 ? theme.fg("accent", `· ${counts.unread} unread`) : "";
  const lines = [
    truncateToWidth([header, ...levelParts, sources, unread].filter(Boolean).join(" "), width, ""),
    truncateToWidth(theme.fg("dim", `${INDENT}↑↓ scroll · c clear · Esc close`), width, ""),
  ];

  for (const group of store.groups()) {
    const groupLevels = (["error", "warning", "info"] as const)
      .filter((level) => group.counts[level] > 0)
      .map((level) => noticeLabel(group.counts[level], level));
    const age = formatNoticeAge(options.now - group.at);
    lines.push("");
    lines.push(truncateToWidth(
      `${theme.fg("accent", group.source)}${INDENT}${theme.fg("muted", `${groupLevels.join(", ")} · ${group.notices.length} message${group.notices.length === 1 ? "" : "s"} · last ${formatNoticeTime(group.at)} (${age} ago)`)}`,
      width,
      "",
    ));
    for (const notice of group.notices) {
      const glyph = theme.fg(NOTICE_TOKENS[notice.level], NOTICE_GLYPHS[notice.level]);
      const repeat = notice.repeats > 1 ? theme.fg("muted", ` ×${notice.repeats}`) : "";
      const body = noticeBody(notice.message, width);
      lines.push(truncateToWidth(`${glyph} ${body[0]}${repeat}`, width - INDENT.length, ""));
      for (const continuation of body.slice(1)) {
        lines.push(truncateToWidth(`${INDENT}${glyph} ${continuation}`, width - INDENT.length, ""));
      }
    }
  }
  return lines;
}

export async function openNoticeInbox(ctx: ExtensionContext, store: NoticeStore = noticeStore): Promise<void> {
  if (!ctx.hasUI) {
    const counts = store.counts();
    ctx.ui.notify(counts.total === 0 ? "No notices this session" : `Notices: ${counts.total}`, "info");
    return;
  }
  store.markRead();
  let top = 0;
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const height = () => Math.max(4, Math.min(40, tui.terminal.rows - 12));
    const page = (width: number) => noticeInboxLines(store, { width, top, now: Date.now(), theme });
    return {
      render(width: number): string[] {
        const lines = page(Math.max(24, width - 1));
        top = Math.max(0, Math.min(top, Math.max(0, lines.length - height())));
        return lines.slice(top, top + height());
      },
      invalidate() {},
      handleInput(data: string) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { done(); return; }
        if (matchesKey(data, "up")) top = Math.max(0, top - 1);
        else if (matchesKey(data, "down")) top += 1;
        else if (matchesKey(data, "home")) top = 0;
        else if (matchesKey(data, "end")) top = Number.MAX_SAFE_INTEGER;
        else if (matchesKey(data, "c")) { store.clear(); top = 0; }
        tui.requestRender();
      },
    };
  }, { overlay: true, overlayOptions: { width: "78%", maxHeight: "80%" } });
}
