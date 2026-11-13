#!/usr/bin/env bash
# Round-trip test for the encrypted publish/restore in scripts/sync_loop.sh, against a throwaway
# local "origin". Needs a python3 with the cryptography package: on PATH, or point PYTHON at one
# (e.g. a venv's bin/python); its directory is then put first on PATH (it must hold a python3).
#   bash scripts/test_sync_crypt.sh
#   PYTHON=/path/to/venv/bin/python bash scripts/test_sync_crypt.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
if [ -n "${PYTHON:-}" ]; then
  export PATH="$(cd "$(dirname "$PYTHON")" && pwd):$PATH"
fi
python3 -c 'import cryptography' 2>/dev/null || { echo "needs python3 with the cryptography package (set PYTHON)"; exit 1; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T" GIT_CONFIG_GLOBAL="$T/gitconfig"   # sync_loop.sh sets git config --global
fail=0
ok()   { echo "  ok  $1"; }
bad()  { echo "  FAIL $1"; fail=1; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# Origin with a plaintext data branch, as today.
git init -q --bare "$T/origin.git"
git init -q "$T/seed" && cd "$T/seed"
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git checkout -q -b streamtime-data
echo '[{"id":1}]' > jobs.json
echo '[{"id":7,"firstName":"A"}]' > users.json
echo '{"people":{"x":1}}' > platform_config.json
echo '{"git":{}}' > vercel.json
git add . && git -c user.name=t -c user.email=t@t commit -q -m data
git remote add origin "$T/origin.git" && git push -q origin streamtime-data

# A checkout like the workflow's, with the scripts.
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
mkdir -p "$T/work/scripts" && cp "$HERE/scripts/data_crypt.py" "$T/work/scripts/"
# Just the functions and settings from sync_loop.sh, not the 5.5h loop.
sed '/^start=\$(date +%s)/,$d' "$HERE/scripts/sync_loop.sh" > "$T/funcs.sh"
cd "$T/work"
branch_files() { git ls-tree --name-only "origin/streamtime-data" | tr '\n' ' '; }
show() { git show "origin/streamtime-data:$1"; }
run() { ( set +e; source "$T/funcs.sh" >/dev/null; "$@" ) ; }

KEY=$(python3 -c 'import os;print(os.urandom(32).hex())')

echo "1. no DATA_KEY: unchanged behaviour"
( unset DATA_KEY; source "$T/funcs.sh" >/dev/null; restore && echo '[{"id":1},{"id":2}]' > streamtime-data/jobs.json && publish "t1" >/dev/null )
git fetch -q origin
check "no .enc files"            '! branch_files | grep -q "\.enc"'
check "plaintext updated"        '[ "$(show jobs.json)" = "[{\"id\":1},{\"id\":2}]" ]'

echo "2. DATA_KEY set, plaintext still published"
( export DATA_KEY=$KEY PUBLISH_PLAINTEXT=true; source "$T/funcs.sh" >/dev/null; restore && publish "t2" >/dev/null )
git fetch -q origin
check ".enc written for sync files"  'branch_files | grep -q "jobs.json.enc" && branch_files | grep -q "users.json.enc"'
check "no .enc for NOT_OURS"         '! branch_files | grep -q "platform_config.json.enc"'
check "plaintext kept"               'branch_files | grep -q "jobs.json "'
before=$(git rev-parse origin/streamtime-data)
out=$( export DATA_KEY=$KEY PUBLISH_PLAINTEXT=true; source "$T/funcs.sh" >/dev/null; restore && publish "t3" )
git fetch -q origin
check "unchanged data → no new commit" '[ "$before" = "$(git rev-parse origin/streamtime-data)" ] && echo "$out" | grep -q "no data changes"'
check "key never printed"            '! echo "$out" | grep -q "$KEY"'

echo "3. PUBLISH_PLAINTEXT=false"
( export DATA_KEY=$KEY PUBLISH_PLAINTEXT=false; source "$T/funcs.sh" >/dev/null; restore && echo '[{"id":1},{"id":2},{"id":3}]' > streamtime-data/jobs.json && publish "t4" >/dev/null )
git fetch -q origin
check "sync plaintext removed"       '! branch_files | tr " " "\n" | grep -qxE "(jobs|users)\.json"'
check "NOT_OURS untouched"           '[ "$(show platform_config.json)" = "{\"people\":{\"x\":1}}" ] && branch_files | grep -q "vercel.json"'
show jobs.json.enc > "$T/j.enc"
DATA_KEY=$KEY python3 scripts/data_crypt.py decrypt "$T/j.enc" "$T/j.json"
check ".enc holds the new data"      '[ "$(cat "$T/j.json")" = "[{\"id\":1},{\"id\":2},{\"id\":3}]" ]'

echo "4. restore after cut-over decrypts"
( export DATA_KEY=$KEY PUBLISH_PLAINTEXT=false; source "$T/funcs.sh" >/dev/null; restore )
check "jobs.json restored from .enc" '[ "$(cat streamtime-data/jobs.json)" = "[{\"id\":1},{\"id\":2},{\"id\":3}]" ]'
check "users.json restored"          '[ "$(cat streamtime-data/users.json)" = "[{\"id\":7,\"firstName\":\"A\"}]" ]'
check "NOT_OURS not restored, no stray .enc" '[ ! -e streamtime-data/platform_config.json ] && ! ls streamtime-data | grep -q "\.enc"'

echo "5. no DATA_KEY after cut-over refuses to sync from empty"
( unset DATA_KEY; source "$T/funcs.sh" >/dev/null; restore ) >/dev/null 2>&1; rc=$?
check "restore fails"                '[ $rc -ne 0 ]'

check "missing key is a decrypt failure (2), not a fetch hiccup" '[ $rc -eq 2 ]'

echo "6. wrong key"
WRONG=$(python3 -c 'print("ab"*32)')
( export DATA_KEY=$WRONG; source "$T/funcs.sh" >/dev/null; restore ) >/dev/null 2>&1; rc=$?
check "restore fails with 2 (decrypt)" '[ $rc -eq 2 ]'

echo "7. the loop itself fails the run on a decrypt failure"
# Runs the real script: restore is the first thing a cycle does, so a wrong key must end the run
# at once with an ::error:: annotation and a non-zero exit (a bug here would sleep 15 min, so it
# is killed after 60 s and counted as a failure).
( DATA_KEY=$WRONG bash "$HERE/scripts/sync_loop.sh" > "$T/loop.out" 2>&1; echo $? > "$T/loop.rc" ) &
lp=$!
for _ in $(seq 1 60); do [ -e "$T/loop.rc" ] && break; sleep 1; done
[ -e "$T/loop.rc" ] || { kill $lp 2>/dev/null; pkill -f "$HERE/scripts/sync_loop.sh" 2>/dev/null; echo 124 > "$T/loop.rc"; }
check "exits non-zero"               '[ "$(cat "$T/loop.rc")" != 0 ]'
check "::error:: annotation"         'grep -q "::error::stopping" "$T/loop.out"'
check "no sync was started"          '! grep -q "── \(full\|fast\) sync" "$T/loop.out"'
check "key only in the ::add-mask:: line" '! grep -v "^::add-mask::" "$T/loop.out" | grep -q "$WRONG"'

echo "8. a plain fetch failure is a hiccup (1), retried next cycle"
( export DATA_KEY=$KEY; source "$T/funcs.sh" >/dev/null; git remote set-url origin "$T/missing.git"; restore ) >/dev/null 2>&1; rc=$?
git remote set-url origin "$T/origin.git"
check "restore returns 1"            '[ $rc -eq 1 ]'

[ $fail = 0 ] && echo "all sync crypto checks passed" || { echo "SOME CHECKS FAILED"; exit 1; }
