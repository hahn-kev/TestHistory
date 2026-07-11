#!/usr/bin/env bash
# End-to-end smoke test against a running TestHistory instance.
# Usage: scripts/smoke.sh [BASE_URL]   (default http://localhost:3000)
set -euo pipefail

BASE="${1:-http://localhost:3000}"
JAR="$(mktemp)"
TMP="$(mktemp -d)"
trap 'rm -rf "$JAR" "$TMP"' EXIT

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; echo "    $2"; exit 1; }

# jq-free JSON field extraction: `jget 'run.id'` / `jget 'tests[0].id'`.
jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(eval('('+'JSON.parse(s)'+').'+process.argv[1]))??'')}catch(e){process.exit(2)}})" "$1"; }

echo "Smoke test → $BASE"

# 1. Health
curl -fsS "$BASE/api/health" >/dev/null && pass "health" || fail "health" "no response"

# 2. Setup (idempotent-ish: ignore 403 if already set up, then log in)
SETUP=$(curl -fsS "$BASE/api/setup")
if [ "$(jget setupRequired <<<"$SETUP")" = "true" ]; then
  curl -fsS -c "$JAR" -X POST "$BASE/api/setup" -H 'content-type: application/json' \
    -d '{"email":"admin@example.com","password":"password123","displayName":"Admin"}' >/dev/null
  pass "setup created admin"
else
  pass "setup already done"
fi

# 3. Login
curl -fsS -c "$JAR" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"password123"}' >/dev/null
pass "login"

# 4. Create project + token
PROJ=$(curl -fsS -b "$JAR" -X POST "$BASE/api/projects" -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke $(date +%s)\"}")
PID=$(jget project.id <<<"$PROJ")
[ -n "$PID" ] && pass "created project $PID" || fail "create project" "$PROJ"

TOK=$(curl -fsS -b "$JAR" -X POST "$BASE/api/projects/$PID/tokens" -H 'content-type: application/json' -d '{"name":"ci"}')
TOKEN=$(jget token <<<"$TOK")
[ -n "$TOKEN" ] && pass "minted token" || fail "token" "$TOK"

# 5. First upload (junit, run key) → assert counts
cat >"$TMP/r1.xml" <<'XML'
<testsuites><testsuite name="s">
  <testcase classname="pkg.A" name="stable" time="0.01"/>
  <testcase classname="pkg.A" name="flappy" time="0.01"/>
  <testcase classname="pkg.A" name="broken" time="0.01"><failure message="x">st</failure></testcase>
</testsuite></testsuites>
XML
R1=$(curl -fsS -X POST "$BASE/api/projects/$PID/runs?run_key=build-1&branch=main" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/xml' --data-binary @"$TMP/r1.xml")
RID=$(jget run.id <<<"$R1")
T1=$(jget run.total <<<"$R1")
[ "$T1" = "3" ] && pass "upload 1: 3 tests (run $RID)" || fail "upload 1 counts" "$R1"

# 6. Second upload, SAME run_key → same run id, merged
cat >"$TMP/r2.xml" <<'XML'
<testsuites><testsuite name="s">
  <testcase classname="pkg.B" name="extra" time="0.01"/>
</testsuite></testsuites>
XML
R2=$(curl -fsS -X POST "$BASE/api/projects/$PID/runs?run_key=build-1" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/xml' --data-binary @"$TMP/r2.xml")
RID2=$(jget run.id <<<"$R2")
T2=$(jget run.total <<<"$R2")
[ "$RID2" = "$RID" ] && [ "$T2" = "4" ] && pass "append same run_key → run $RID2, 4 tests" \
  || fail "append merge" "$R2"

# 7. Third run: flip 'flappy' to failing (new run key)
cat >"$TMP/r3.xml" <<'XML'
<testsuites><testsuite name="s">
  <testcase classname="pkg.A" name="stable" time="0.01"/>
  <testcase classname="pkg.A" name="flappy" time="0.01"><failure message="flip">st</failure></testcase>
</testsuite></testsuites>
XML
curl -fsS -X POST "$BASE/api/projects/$PID/runs?run_key=build-2&branch=main" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/xml' --data-binary @"$TMP/r3.xml" >/dev/null
# 8. Fourth run: flip back to passing → 2 flips = flaky
cat >"$TMP/r4.xml" <<'XML'
<testsuites><testsuite name="s">
  <testcase classname="pkg.A" name="flappy" time="0.01"/>
</testsuite></testsuites>
XML
curl -fsS -X POST "$BASE/api/projects/$PID/runs?run_key=build-3&branch=main" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/xml' --data-binary @"$TMP/r4.xml" >/dev/null
pass "uploaded flip runs"

# 9. Flaky endpoint contains 'flappy'
FLAKY=$(curl -fsS -b "$JAR" "$BASE/api/projects/$PID/flaky?branch=main")
echo "$FLAKY" | grep -q '"flappy"' && pass "flaky detects 'flappy'" || fail "flaky" "$FLAKY"

# 10. History shows runs for a test
TESTS=$(curl -fsS -b "$JAR" "$BASE/api/projects/$PID/tests?search=flappy")
TID=$(jget 'tests[0].id' <<<"$TESTS")
HIST=$(curl -fsS -b "$JAR" "$BASE/api/projects/$PID/tests/$TID/history")
HN=$(jget history.length <<<"$HIST")
[ "${HN:-0}" -ge 3 ] && pass "history has $HN entries" || fail "history" "$HIST"

# 11. plugin-query SELECT works, DELETE rejected
Q=$(curl -fsS -b "$JAR" -X POST "$BASE/api/projects/$PID/plugin-query" -H 'content-type: application/json' \
  -d '{"sql":"SELECT COUNT(*) AS n FROM tests"}')
echo "$Q" | grep -q '"columns"' && pass "plugin-query SELECT ok" || fail "plugin-query" "$Q"

DEL_CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/projects/$PID/plugin-query" \
  -H 'content-type: application/json' -d '{"sql":"DELETE FROM runs"}')
[ "$DEL_CODE" = "403" ] && pass "plugin-query DELETE rejected (403)" || fail "plugin-query DELETE" "got $DEL_CODE"

echo "ALL SMOKE CHECKS PASSED"
