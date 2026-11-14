// What extensions had to say, kept out of the transcript. One row per distinct
// message: a repeat raises its counter and moves it to the end instead of
// pushing another line into the conversation.
export type NoticeLevel = "info" | "warning" | "error";

/** Label for notices this bundle emitted itself. */
export const OWN_BUNDLE_SOURCE = "ui-bundle";

export interface Notice {
  level: NoticeLevel;
  message: string;
  source: string;
  firstAt: number;
  at: number;
  repeats: number;
}

export interface NoticeSourceGroup {
  source: string;
  notices: Notice[];
  counts: Record<NoticeLevel, number>;
  at: number;
}

export interface NoticeCounts {
  unread: number;
  total: number;
  unreadByLevel: Record<NoticeLevel, number>;
  byLevel: Record<NoticeLevel, number>;
  sources: { source: string; count: number }[];
}

/** Rows held for the session. The oldest roll off; nothing is written to disk. */
const MAX_NOTICES = 200;

const emptyLevels = (): Record<NoticeLevel, number> => ({ info: 0, warning: 0, error: 0 });

const unreadTotal = (levels: Record<NoticeLevel, number>): number => levels.info + levels.warning + levels.error;

export function isNoticeLevel(value: unknown): value is NoticeLevel {
  return value === "info" || value === "warning" || value === "error";
}

export class NoticeStore {
  private notices: Notice[] = [];
  private unread: Record<NoticeLevel, number> = emptyLevels();
  private listeners = new Set<() => void>();

  record(input: { level: NoticeLevel; message: string; source: string; at?: number }): Notice {
    const at = input.at ?? Date.now();
    const existing = this.notices.findIndex((notice) =>
      notice.level === input.level && notice.source === input.source && notice.message === input.message);
    const repeat = existing >= 0 ? this.notices.splice(existing, 1)[0] : undefined;
    const recorded: Notice = repeat
      ? { ...repeat, at, repeats: repeat.repeats + 1 }
      : { level: input.level, message: input.message, source: input.source, firstAt: at, at, repeats: 1 };
    this.notices = [...this.notices, recorded].slice(-MAX_NOTICES);
    this.unread = { ...this.unread, [input.level]: this.unread[input.level] + 1 };
    this.emit();
    return recorded;
  }

  list(): readonly Notice[] {
    return this.notices;
  }

  /** Sources in most-recent order, each with its own notices newest first. */
  groups(): NoticeSourceGroup[] {
    const bySource = new Map<string, NoticeSourceGroup>();
    for (const notice of this.notices) {
      const group = bySource.get(notice.source)
        ?? { source: notice.source, notices: [], counts: emptyLevels(), at: 0 };
      group.notices.push(notice);
      group.counts[notice.level] += notice.repeats;
      group.at = Math.max(group.at, notice.at);
      bySource.set(notice.source, group);
    }
    return [...bySource.values()]
      .map((group) => ({ ...group, notices: group.notices.sort((a, b) => b.at - a.at) }))
      .sort((a, b) => b.at - a.at || a.source.localeCompare(b.source));
  }

  counts(): NoticeCounts {
    const byLevel = emptyLevels();
    const perSource = new Map<string, number>();
    let total = 0;
    for (const notice of this.notices) {
      byLevel[notice.level] += notice.repeats;
      perSource.set(notice.source, (perSource.get(notice.source) ?? 0) + notice.repeats);
      total += notice.repeats;
    }
    const sources = [...perSource]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
    return { unread: unreadTotal(this.unread), total, unreadByLevel: { ...this.unread }, byLevel, sources };
  }

  markRead(): void {
    if (unreadTotal(this.unread) === 0) return;
    this.unread = emptyLevels();
    this.emit();
  }

  clear(): void {
    if (this.notices.length === 0 && unreadTotal(this.unread) === 0) return;
    this.notices = [];
    this.unread = emptyLevels();
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export const noticeStore = new NoticeStore();

export function formatNoticeAge(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatNoticeTime(at: number): string {
  const date = new Date(at);
  const clock = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${clock}`;
}

/** Level counts plus the loudest sources, for the status bar and plain-text fallbacks. */
export function formatNoticeSummary(counts: NoticeCounts, limit = 2): string {
  const parts = (["error", "warning", "info"] as NoticeLevel[])
    .filter((level) => counts.byLevel[level] > 0)
    .map((level) => `${counts.byLevel[level]} ${level}${counts.byLevel[level] === 1 ? "" : "s"}`);
  const sources = counts.sources.slice(0, limit).map((entry) => entry.source).join(", ");
  return sources ? `${parts.join(", ")} · ${sources}` : parts.join(", ");
}
