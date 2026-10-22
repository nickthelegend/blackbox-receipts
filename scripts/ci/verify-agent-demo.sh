#!/usr/bin/env bash
# Re-verifies every committed live agent run under receipts/agent-demo/ from its exported files alone.
# Each export must still verify the way it was recorded: a PASS export must PASS verify-export; a FAIL
# export must have an intact chain and seal and report exactly the verdict stored in its result.txt.
# Each run is checked under the published policy its result.txt names (the one in force when it was
# recorded): the 2026-10-21 runs under the frozen no-secrets-read/v1. verify-export would refuse their v1
# proofs under the default no-secrets-read/v2 pin, so the policy is pinned explicitly and printed.
# Needs the build (packages/*/dist).
set -euo pipefail
shopt -s nullglob
dirs=(receipts/agent-demo/*/)
[ ${#dirs[@]} -gt 0 ] || { echo "no agent-demo exports to check"; exit 0; }
for dir in "${dirs[@]}"; do
  dir="${dir%/}"
  recorded="$(cat "$dir/result.txt")"
  policy="$(sed -nE 's/.*\[policy ([^ ]+) [0-9a-f]{12}\].*/\1/p' <<<"$recorded" | head -n1)"
  [ -n "$policy" ] || { echo "No policy named in $dir/result.txt" >&2; exit 1; }
  echo "== $dir (recorded under $policy)"
  set +e; out="$(node packages/proxy/dist/cli.js verify-export "$dir" --expect-policy "$policy")"; code=$?; set -e
  echo "$out"
  case "$recorded" in
    PASS*) [ "$code" -eq 0 ] || { echo "Expected PASS for $dir" >&2; exit 1; } ;;
    FAIL*) [ "$code" -eq 1 ] && grep -qF "Chain intact and seal matches, but the export has no property proof. Prover reported: $recorded" <<<"$out" || { echo "Expected the recorded FAIL with an intact chain and seal for $dir" >&2; exit 1; } ;;
    *) echo "Unrecognised result.txt in $dir" >&2; exit 1 ;;
  esac
done
echo "verify-agent-demo: ${#dirs[@]} export(s) match their recorded verdicts"
