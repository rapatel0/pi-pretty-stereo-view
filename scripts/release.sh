#!/usr/bin/env bash
# Release per VERSIONING.md: verify, bump, tag, push, GitHub release.
set -euo pipefail
type="${1:-}"
if [[ ! "$type" =~ ^(patch|minor|major)$ ]]; then
  echo "usage: scripts/release.sh patch|minor|major" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
[[ -z "$(git status --porcelain)" ]] || { echo "release blocked: uncommitted changes" >&2; exit 1; }
git fetch --quiet origin
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] \
  || { echo "release blocked: HEAD is not origin/main" >&2; exit 1; }
echo "== npm test"
npm test --silent
echo "== typecheck"
npx tsc -p tsconfig.json
npm version "$type" -m "release %s"
version="v$(node -p 'require("./package.json").version')"
git push origin main --follow-tags
gh release create "$version" --generate-notes --title "$version"
echo "released $version"
echo "next: pi remove git:github.com/rapatel0/pi-pretty-stereo-view@<old> && pi install git:github.com/rapatel0/pi-pretty-stereo-view@$version"
