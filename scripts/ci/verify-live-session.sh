#!/usr/bin/env bash
# Records a real session through the Blackbox MCP proxy (one bridge process per tool call, exactly as
# the GitLab Duo flow does) on this checkout, then runs the verifier. The clean session must PASS, and a
# secret read, a tampered log and an empty session must each FAIL with the expected step.
# Needs the build (packages/*/dist) and installed dependencies.
set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export RECEIPTS_DIR="$WORK/session"
# A throwaway signing key for this run, outside the checkout (the default is ~/.blackbox/).
export BLACKBOX_KEY_DIR="$WORK/keys"
call() { node packages/proxy/dist/call.js "$@"; }
cli() { node packages/proxy/dist/cli.js "$@"; }

# expect_fail <output regex> <command...>: the command must exit non-zero and print a matching line.
expect_fail() {
  local pattern="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then echo "$out"; echo "Expected FAIL from: $*" >&2; exit 1; fi
  echo "$out"
  grep -Eq "$pattern" <<<"$out" || { echo "Output did not match /$pattern/" >&2; exit 1; }
}

echo "== clean session: 4 real tool calls through the proxy"
call --new-session git '{"action":"log"}' > /dev/null
call read_file '{"path":"README.md"}' > /dev/null
call shell '{"command":"ls packages"}' > /dev/null
call git '{"action":"show_stat","args":["HEAD"]}' > /dev/null
cli prove
cli verify-proof

echo "== secret path: the agent tries to read .env.example"
expect_fail 'DENIED or FAILED \(receipt recorded\)' call read_file '{"path":".env.example"}'
expect_fail '^FAIL no-secrets-read at step 5 \[policy no-secrets-read/v2 [0-9a-f]{12}\]: read_file touched secret path matching "\.env\*"' cli prove

echo "== tampered chain: edit stored receipt 1"
cli tamper
expect_fail '^FAIL no-secrets-read at step 1 \[policy no-secrets-read/v2 [0-9a-f]{12}\]: Chain verification failed: Receipt contents were changed' cli prove

echo "== empty session"
RECEIPTS_DIR="$WORK/empty"
expect_fail '^FAIL no-secrets-read \[policy no-secrets-read/v2 [0-9a-f]{12}\]: No receipts exist for this session' cli prove

echo "verify-live-session: all expectations met"
