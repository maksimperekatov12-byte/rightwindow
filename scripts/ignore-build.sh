#!/usr/bin/env bash
# Vercel's Ignored Build Step (vercel.json ignoreCommand): exit 0 skips this
# deployment, exit 1 builds it.
#
# A sweep that stops early — the city's API down, a crash — still commits its
# report, data/health.json, so /status can say what happened. /api/status reads
# that file from GitHub, not from the build, so a deploy for it rebuilds the
# same site; with the sweep hourly that could be one wasted production deploy
# an hour. Only such a push is skipped. Anything else, and anything this
# cannot tell, builds.
#
# Compared with the last deployed commit rather than HEAD^, so a push of
# several commits that happens to end with a report still deploys the rest.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "ignore-build: no previous deployment in reach to compare with — building"
  exit 1
fi
changed="$(git diff --name-only "$base" HEAD 2>/dev/null)" || {
  echo "ignore-build: could not diff against ${base:0:7} — building"
  exit 1
}
if [ "$changed" = "data/health.json" ]; then
  echo "ignore-build: only data/health.json changed since ${base:0:7} — skipping this deploy"
  exit 0
fi
echo "ignore-build: $(printf '%s\n' "$changed" | grep -c .) file(s) changed since ${base:0:7} — building"
exit 1
