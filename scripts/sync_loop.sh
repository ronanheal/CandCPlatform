#!/usr/bin/env bash
# Streamtime sync loop — run by .github/workflows/streamtime-sync.yml.
#
# Why a loop: GitHub's cron scheduler is best-effort, and from late Aug 2026 it was only
# firing our "every 15 min" / "hourly" schedules 3-6 times a day, leaving the Todo board
# hours stale. Instead, one job stays alive for ~5.5h running the fast sync every 15 min
# and the full sync every hour, then the workflow queues its own successor.
#
# Why a single squashed commit: every sync used to add a new commit holding ~75MB of JSON
# (jobs.json + logged_times.json), which grew the repo to 1.5GB and made each run spend
# minutes fetching history. Nothing reads the data branch's history, so each publish now
# replaces the branch with one parentless commit of the current files.

set -uo pipefail

RUN_FOR=$((330 * 60))     # stop starting new cycles after 5.5h (job limit is 6h)
FAST_EVERY=$((15 * 60))
FULL_EVERY=$((60 * 60))

# Files on the data branch written by something other than the sync scripts (the browser's
# "Publish config" button, generate-meta.yml, and vercel.json). Never restored or overwritten here.
NOT_OURS="platform_config.json changelog.json platform_meta.json roadmap.json vercel.json"

git config --global user.name "streamtime-sync[bot]"
git config --global user.email "noreply@github.com"

restore() {
  git fetch -q --depth=1 origin streamtime-data || return 1
  mkdir -p streamtime-data
  rm -f streamtime-data/*.json
  for f in $(git ls-tree --name-only FETCH_HEAD | grep '\.json$'); do
    case " $NOT_OURS " in *" $f "*) continue ;; esac
    git show "FETCH_HEAD:$f" > "streamtime-data/$f"
  done
}

publish() {
  local msg=$1 attempt base
  for attempt in 1 2 3; do
    git fetch -q --depth=1 origin streamtime-data || continue
    base=$(git rev-parse FETCH_HEAD)
    rm -rf ../data-branch && git worktree prune
    git worktree add -q --detach ../data-branch "$base" || continue
    cp streamtime-data/*.json ../data-branch/
    git -C ../data-branch add -A .
    if git -C ../data-branch diff --cached --quiet "$base"; then
      echo "  no data changes"
      return 0
    fi
    local commit
    commit=$(git -C ../data-branch commit-tree "$(git -C ../data-branch write-tree)" -m "$msg")
    # Lease on the commit we just read: if a config publish or meta update landed in
    # between, the push is refused and we retry on top of it rather than dropping it.
    if git push -q --force-with-lease="streamtime-data:$base" origin "$commit:refs/heads/streamtime-data"; then
      echo "  published $commit"
      return 0
    fi
    echo "  branch moved during publish, retrying ($attempt)"
  done
  echo "::warning::publish failed after 3 attempts"
  return 1
}

start=$(date +%s)
last_full=0

while :; do
  cycle=$(date +%s)
  [ $((cycle - start)) -ge "$RUN_FOR" ] && break

  if ! restore; then
    echo "::warning::could not fetch streamtime-data, skipping cycle"
  elif [ $((cycle - last_full)) -ge "$FULL_EVERY" ]; then
    # The full sync re-fetches everything the fast sync does, so it replaces that cycle.
    echo "── full sync $(date -u +%H:%M:%SZ)"
    if python3 scripts/streamtime_sync.py; then
      last_full=$cycle
      publish "sync: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    else
      echo "::warning::full sync failed, will retry next cycle"
    fi
  else
    echo "── fast sync $(date -u +%H:%M:%SZ)"
    if python3 scripts/streamtime_fast_sync.py; then
      publish "fast sync: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    else
      echo "::warning::fast sync failed"
    fi
  fi

  wait_for=$((cycle + FAST_EVERY - $(date +%s)))
  [ "$wait_for" -gt 0 ] && sleep "$wait_for"
done

echo "Loop finished after $(( ($(date +%s) - start) / 60 )) min"
