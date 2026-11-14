# pi-pretty-stereo-view

One Pi package supplies a transcript, a split view, a sidebar, and a status bar.
This checkout contains the unreleased rewrite. The public release remains `v0.3.2`.

| Component | Source | Role |
| --- | --- | --- |
| Split history | `pi-stereo-view` 0.1.10 | Chat and activity panes, search, and zoom |
| Status bar | `pi-powerline-footer` 0.21.0 | Model, context, cost, and Git state |
| Transcript | `pi-pretty-tui` 0.3.0 | Editor frame, message cards, and tool output |
| Sidebar | `pi-ui-extension` 1.9.9 | Context, tool use, subagents, and processes |

`NOTICE.md` records source attribution and changes. Pristine source copies remain in the
ignored `reference/` directory. The package loads code from `extensions/`.

## Install

The public tag still contains the earlier UI. The rewrite requires a local checkout until release.

```sh
pi install /absolute/path/to/pi-pretty-stereo-view
```

The split view and sidebar require Pi's fullscreen TUI. The package includes its Ayu themes.

## Controls

`/ui` is the only registered command. Its panel provides these display controls:

- Split view.
- Sidebar width and automatic hide threshold.
- Status bar placement and preset.
- Tool output mode and side borders.

The same panel provides work and theme controls:

- Subagent panel.
- Process panel.
- Notice inbox.
- Theme.

The full, compact, and clean modes control tool output. A change to the overall transcript switch
reloads the extension. Each component keeps its own switch.

```text
/ui status
/ui preset compact
/ui mode clean
/ui split off
/ui sidebar width 32
/ui theme ayu-dark
```

`/ui split settings` opens the detailed split controls. `/ui powerline` toggles the status bar.
`/ui perf on` enables counters and reloads the extension. `/ui perf` displays those counters.

## Work panels

The sidebar contains no session switcher or session management actions.
Subagent rows follow public lifecycle events. Saved session entries restore completed records.
A row opens a read-only output overlay. Escape closes it.

Live output uses the public `subagents:state` event and the read-only `subagents:rpc:list` query.
The paired producer change supplies a session path and visible response text before completion.
Rows include direct agents, nested agents, and children of `SubagentWorkflow`.
Older producers still supply lifecycle rows and final output. The overlay states when no live source exists.

Process rows use observed `bg_task_*` tool results. Each row states its observation age.
A process can change state between observations. A later tool result refreshes its row.
The UI does not read the background-task package's private registry.
Load a package that supplies `bg_task_*` tools to track background work.
A shell command with `nohup` or `&` does not register a process row.

## Notices

Pi prints every extension notification into the conversation, so startup chatter lands between a
message and its reply. This bundle takes those lines out of the transcript and files them in a
notice inbox instead. The status bar shows a count of unread notices, coloured by the worst unread
level and named after the extension that sent most of them. `ctrl+alt+n` or `/ui notices` lists
them grouped by extension, newest first, with age, repeat counts, and truncation.

- Pi's own warnings (no provider, terminal capabilities, updates) stay in the transcript.
- `/ui notices clear` empties the inbox. `/ui notices external` stops routing other extensions'
  notices, so they print in the transcript again. `/ui notices inline <level>` keeps a level in the
  transcript as well as the inbox.
- The inbox lives in memory for the session. It clears on a session switch and is never written to
  disk.
- Notices are attributed from the call stack, so a Pi build that hides those frames shows them
  under `unknown`.

## Configuration

The bundle writes one file: `pi-pretty-stereo-view.json` under Pi's agent directory.
Pi's `getAgentDir()` determines that directory and respects `PI_CODING_AGENT_DIR`.

On first use, the bundle imports legacy preferences from `pretty-tui.json`, `transcript.json`,
and the old powerline settings. Values already in the bundle file take precedence.
The migration leaves legacy files intact. Later changes write only the bundle file.

The bundle stores its theme choice in this file. It passes a theme object to Pi, so the theme
control does not change the theme key in `settings.json`.

## Shortcuts

`ctrl+alt+t` toggles the split. `ctrl+alt+s` swaps its panes. `ctrl+alt+up` and
`ctrl+alt+down` change the active pane. `ctrl+alt+left` and `ctrl+alt+right` resize it.
`ctrl+alt+b` toggles the sidebar. `ctrl+alt+n` opens the notice inbox.

Editor copy, cut, start, and end shortcuts remain. Pi's `!` commands and optional shell
completion remain. Sticky shell mode and its commands are removed.

## Development

```sh
npm run typecheck
npm test
```

The suite contains 13 probes. The original layout checks remain.
Additional checks cover migration, editor input, and work panels.
Other checks cover commands, timing, the internal interface, message output, and idle Git behavior.
The scratch Pi checks require no model calls.

Release, publication, and changes to the live Pi configuration remain separate actions.

## Internal structure

`integrated/defaults.ts` holds initial preferences and presets. `settings-store.ts` owns disk access.
`integrated/ui-runtime.ts` owns layout order, editor ownership, input priority, and the host event interface.
Shared modules own text padding, key matches, color conversion, tool presentation, and render caches.

`pretty-tui/index.ts` preserves the initialization order through named modules. Runtime state and activity
projections occupy separate modules. Message patches, tool output, session restoration, and event handlers
also have separate owners. The reachability probe enforces a 300-line ceiling for transcript functions.

## Reasoning summaries

Activity displays reasoning text that the provider returns. Token usage alone does not supply text.
In clean mode, click the activity group, then its thought row.
`/ui mode full` displays returned summaries as expanded thought cards.
A mode change applies immediately. The answer stays in Conversation.
