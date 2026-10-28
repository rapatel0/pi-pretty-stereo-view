# pi-pretty-stereo-view

One Pi package that bundles four extensions into a single, integrated UI stack:

| Component | Vendored from | Role |
| --- | --- | --- |
| Stereo split history | `pi-stereo-view` 0.1.10 | Activity/Chat split history, search, zoom (fullscreen TUI) |
| Powerline footer | `pi-powerline-footer` 0.21.0 | Status/footer bar, cwd & stash commands, bash-mode, vibes |
| Pretty rendering | `pi-pretty-tui` 0.3.0 | Framed editor, message cards, markdown surfaces |
| Right sidebar | `pi-ui-extension` 1.9.9 (sidebar subsystem) | Toggleable right sidebar: sessions, context, activity, tool usage |

Pristine upstream sources for inspection live in `reference/` (gitignored, not shipped); the vendored, minimally patched copies the package actually loads live under `extensions/`. See `NOTICE.md` for every deviation and license attribution.

## Install

```bash
pi install /localpool/pi-pretty-stereo-view
```

Remove the standalone packages from `~/.pi/agent/settings.json` (`packages.npm` entries for `pi-stereo-view`, `pi-powerline-footer`, `pi-pretty-tui`) so commands are not registered twice.

Requires Pi fullscreen TUI (`pi --tui-mode fullscreen`) for the stereo split and the sidebar; both degrade gracefully otherwise (sidebar shows a notification).

## Sidebar

- `/sidebar` — toggle; also `on`, `off`, `status`
- `/sidebar width <columns>` — fixed width (clamped 24…48); `width default` restores 20% of terminal width
- `ctrl+alt+b` — toggle
- Drag the sidebar's left divider to resize; width persists
- Contents: session switcher (relative times, context %, rename/delete), context usage estimate, live activity, per-tool call counts

The sidebar mounts to the right of the stereo split automatically: it waits for the stereo layout to attach and is torn down before stereo restores the native layout, so the two never fight over the layout root.

## Configuration

- `~/.pi/agent/pi-pretty-stereo-view.json` — sidebar state written by this bundle:
  `{ "sidebar": { "enabled": true, "width": 30 } }`
- `~/.pi/agent/pretty-tui.json` — unchanged from `pi-pretty-tui`, plus one new option:
  `{ "enabled": true, "mode": "compact", "sideBorders": false }`
  `sideBorders: false` drops the vertical side columns of the editor frame, message bubbles, cards and code blocks while keeping the top/bottom rules. Defaults to `true` (upstream look).
- `~/.pi/agent/transcript.json` — stereo-view preferences (unchanged).

## Commands & keys

Everything from the four upstream extensions is preserved (`/stereo-view`, `/powerline`, `/pretty-tui`, `/cd`, `/queue`, `/vibe`, `/bash-mode`, …). New in this bundle: `/sidebar`, `/sidebar width`, hidden `/sidebar-session switch <id>`, and `ctrl+alt+b`.

## Development

- `npm run typecheck` — `tsc --noEmit` over the whole package (0 errors)
- `node test/load-smoke.mjs` — jiti import + factory smoke with a mock Pi API
