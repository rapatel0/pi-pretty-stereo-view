# Versioning policy

Single package, one version. `package.json` `"version"` and an annotated git
tag `vX.Y.Z` are the release; the tag is what consumers pin.

## Scheme: SemVer 2.0.0

We are pre-1.0, so treat `0.MINOR.PATCH` as:

| Bump | When | Notes |
| --- | --- | --- |
| PATCH `0.2.1` | Bug fixes only | No new commands/keys/options; no user-visible default changes |
| MINOR `0.3.0` | Additive features **and** any breaking change | Pre-1.0 breaking changes land in a minor; its release notes MUST contain a **Migration** section |
| MAJOR `1.0.0` | Declaring the stable surface | Only when the commands/config below are considered settled |

After 1.0.0: strict SemVer — breaking changes require a major.

## The stable surface (what "breaking" is measured against)

- Commands and their arguments: `/sidebar`, `/sidebar-session`, and everything inherited from the vendored extensions (`/stereo-view`, `/powerline`, `/pretty-tui`, …)
- Shortcuts: `ctrl+alt+b`, `ctrl+alt+t`, `ctrl+alt+s`, `ctrl+alt+arrows`
- Config files and key semantics: `pi-pretty-stereo-view.json` (`sidebar.enabled`, `sidebar.width`, `sidebar.autoHideBelowColumns`), `pretty-tui.json` (incl. `sideBorders`), `transcript.json`
- Removing/renaming any of the above, changing a key's meaning, changing a
  default layout users rely on, or raising the Pi peer floor across a Pi major.

Everything under `extensions/integrated/` beyond those config keys is internal.

## Vendored upstream changes

Upstream package versions are recorded in `NOTICE.md`. Syncing upstream code
in (adapted or verbatim) requires **at least a minor** bump. If the upstream
change is breaking for users, document it in the release notes' Migration
section. We never renumber to mirror an upstream version.

## Pi compatibility floor

`peerDependencies` states the lowest Pi tested against. Raising the floor
within one Pi major line: patch. Requiring a new Pi major (API break we adopt):
minor pre-1.0, major post-1.0.

## Release process

Use the script:

```bash
scripts/release.sh patch|minor|major
```

It enforces: clean tree, `main` in sync with origin, `npm test` green, `tsc`
clean; then `npm version` (commit + annotated tag `vX.Y.Z`),
`git push --follow-tags`, and `gh release create --generate-notes`.
Add the **Migration** section to the release if the change is breaking
(`gh release edit vX.Y.Z --notes-file …`).

Then update this machine's pin:

```bash
pi remove git:github.com/rapatel0/pi-pretty-stereo-view@vOLD
pi install  git:github.com/rapatel0/pi-pretty-stereo-view@vNEW
```

## Tags and pins

- Tags are `vX.Y.Z`, annotated (what `npm version` creates). Never move or
  delete a published tag; a bad release gets a new patch tag.
- Consumers should pin tags (`@vX.Y.Z`) in `settings.json` — that is what
  `pi update --extensions` reconciles against. An unpinned source entry tracks
  the default branch and is treated as bleeding edge.
