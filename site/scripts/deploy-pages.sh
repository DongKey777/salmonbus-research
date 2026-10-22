#!/usr/bin/env bash
# Build the public copy of the research site, audit it, and commit it into the Pages repo working tree.
#
# usage: scripts/deploy-pages.sh [--push] [--no-capture]
#   --push        also push; refused unless ALLOW_PUBLIC_PUSH=1 is set in the environment
#   --no-capture  reuse saved snapshots/ instead of reading the local API servers
# env:
#   PAGES_REPO    working tree of the repo's gh-pages branch (default: ~/IdeaProjects/salmonbus-research-pages, a git worktree)
#   PAGES_BRANCH  branch GitHub Pages serves (default: gh-pages)
#   PAGES_DIR     folder GitHub Pages serves (default: docs)
#   PAGES_BASE    URL prefix of the project page (default: /salmonbus-research/)
#
# Order: tests → snapshots → pages build → stage → audit (dist-pages) → copy → audit (repo folder) → commit.
# Any failed step stops before the repo is touched. No commit when nothing (or only servedAt) changed.
set -euo pipefail

SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${PAGES_REPO:-$HOME/IdeaProjects/salmonbus-research-pages}"
BRANCH="${PAGES_BRANCH:-gh-pages}"
DIR="${PAGES_DIR:-docs}"
export PAGES_BASE="${PAGES_BASE:-/salmonbus-research/}"
PUSH=0 CAPTURE=1
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    --no-capture) CAPTURE=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
if [[ $PUSH == 1 && "${ALLOW_PUBLIC_PUSH:-}" != 1 ]]; then
  echo "refusing to push: set ALLOW_PUBLIC_PUSH=1 together with --push" >&2; exit 2
fi

LOCK="$SITE/.deploy.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]]; then rm -rf "$LOCK"; mkdir "$LOCK"
  else echo "another deploy is running" >&2; exit 3; fi
fi
trap 'rm -rf "$LOCK"' EXIT

step() { printf '[deploy-pages] %s\n' "$*"; }
cd "$SITE"

step "tests"
npm test --silent >/dev/null 2>&1 || { echo "tests failed: not deploying" >&2; exit 1; }

if [[ $CAPTURE == 1 ]]; then
  step "snapshots"
  node --experimental-strip-types --no-warnings scripts/capture-snapshots.mjs || true
fi

step "build (base $PAGES_BASE)"
npx tsc -b
npx vite build --mode pages --logLevel error
node scripts/stage-pages.mjs >/dev/null

step "audit dist-pages"
if ! node scripts/audit-public.mjs dist-pages --require-sidecar; then
  echo "audit failed: nothing was copied to $REPO" >&2; exit 1
fi

git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "public repo working tree not found: $REPO" >&2; exit 1; }
current="$(git -C "$REPO" symbolic-ref --short HEAD)"
[[ "$current" == "$BRANCH" ]] || { echo "public repo is on $current, expected $BRANCH" >&2; exit 1; }
if [[ -n "$(git -C "$REPO" status --porcelain -- . ":(exclude)$DIR")" ]]; then
  echo "public repo has uncommitted changes outside $DIR/: resolve them first" >&2; exit 1
fi

step "copy to $REPO/$DIR"
mkdir -p "$REPO/$DIR"
rsync -a --delete --exclude '.*' dist-pages/ "$REPO/$DIR/"
touch "$REPO/$DIR/.nojekyll"

step "audit $DIR"
if ! node scripts/audit-public.mjs "$REPO/$DIR" --require-sidecar >/dev/null; then
  git -C "$REPO" checkout -q -- "$DIR" 2>/dev/null || true
  git -C "$REPO" clean -fdq -- "$DIR"
  echo "audit of the copied folder failed: copy reverted" >&2; exit 1
fi

git -C "$REPO" add -A -- "$DIR"
if git -C "$REPO" diff --cached --quiet -- "$DIR"; then
  step "unchanged: no commit"
elif git -C "$REPO" rev-parse -q --verify HEAD >/dev/null && node scripts/pages-util.mjs volatile-only "$REPO" "$DIR"; then
  git -C "$REPO" reset -q -- "$DIR"
  git -C "$REPO" checkout -q -- "$DIR"
  step "only servedAt moved: no commit"
else
  git -C "$REPO" commit -q -m "chore: 공개 연구 사이트 갱신" -- "$DIR"
  step "committed $(git -C "$REPO" rev-parse --short HEAD)"
fi

if [[ $PUSH == 1 ]]; then
  git -C "$REPO" remote get-url origin >/dev/null 2>&1 || { echo "no origin remote in $REPO" >&2; exit 1; }
  step "push origin $BRANCH"
  git -C "$REPO" push origin "$BRANCH"
else
  step "not pushed (use --push with ALLOW_PUBLIC_PUSH=1)"
fi
