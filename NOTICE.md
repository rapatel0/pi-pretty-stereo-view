# Notices and attribution

This package vendors modified copies of four MIT-licensed Pi extensions.
Pristine upstream copies are kept under `reference/` for diffing (not shipped).
License texts are copied under `licenses/` where the upstream tarball shipped one;
`pi-powerline-footer` declares MIT in its package.json but ships no LICENSE file.

| Vendored directory | Upstream | Version | License |
| --- | --- | --- | --- |
| `extensions/stereo-view/` | `pi-stereo-view` | 0.1.10 | MIT (`licenses/pi-stereo-view.LICENSE`) |
| `extensions/powerline/` | `pi-powerline-footer` | 0.21.0 | MIT (declared in package.json; no file shipped) |
| `extensions/pretty-tui/` | `pi-pretty-tui` | 0.3.0 | MIT (`licenses/pi-pretty-tui.LICENSE`) |
| `extensions/ui/{sidebar,ctx,session,tool-view}/` | `pi-ui-extension` | 1.9.9 | MIT (`licenses/pi-ui-extension.LICENSE`) |

New integration code (`extensions/index.ts`, `extensions/integrated/`, `test/`) is MIT, (c) Ravi Enagonda.

## Deviations from upstream

### pi-stereo-view (`extensions/stereo-view/`)
- `index.ts`: calls `markStereoAttached()` / `markStereoDetaching()` around layout
  create/dispose so the bundled sidebar can mount around (and unmount before) the
  split instead of racing it for the layout root. Behavior otherwise unchanged.

### pi-pretty-tui (`extensions/pretty-tui/`)
- New `sideBorders` config option (default `true`) and `setSideBorders()` in
  `full-frame.ts`: when `false`, the editor frame, message/user/code frames and
  full-frame panels drop their vertical side columns while keeping top/bottom
  rules (`index.ts` gates the three `│` helpers on the flag).
- Dead upstream helpers renamed with `_` prefix and `void`-referenced
  (`_renderCleanGroupSummary`, `_conciseActivityText`) to satisfy this repo's
  lint rules; no behavior change.

### pi-ui-extension sidebar (`extensions/ui/sidebar/`)
- `index.ts`: `installSidebar()` accepts `SidebarInstallOptions`
  (`initialWidth`, `onWidthChange`) and `SidebarController.getWidth()` was added;
  used by the host to persist sidebar width. Existing callers are unaffected.
- Import paths retargeted to the bundled layout (`extensions/ui/...`).

### pi-powerline-footer (`extensions/powerline/`)
- `index.ts`, `working-vibes.ts`: type-only adaptations for the pi-coding-agent
  1.4.0 typings (`TranscriptContext` brand cast in `working-vibes.ts`,
  `SAFETY:`-annotated casts) plus lint-driven cleanups. No behavior change.

### Not bundled from pi-ui-extension
Resource browsing (`fs/`), the tool-view controller modes, bulk session cleanup,
dialogs, and the sidebar *status* footer line (the powerline footer owns the
footer here).
