#!/usr/bin/env bash
# Receipt-gated merge, end to end on real branches.
#
# Clones this repo into a temp directory and builds three branches off its HEAD, each the way an agent
# pull request would look: the agent's writes go through the Blackbox proxy (write_file, over the
# one-shot MCP bridge), its session is exported to receipts/<session>/ and committed with the change.
# Then the same gate CI runs (scripts/ci/attest-diff-pr.sh) checks each branch against the base:
#
#   agent/clean       the agent's change, untouched                  -> green
#   agent/human-edit  agent/clean plus a human commit on its file    -> red, names the file and the step
#   agent/bypass      one proxied write plus a file the agent wrote
#                     with a plain shell, around the proxy           -> red, "unrecorded change"
#
# Nothing is simulated: real git commits, real proxy processes, real signatures. Keys are throwaway
# directories inside the temp clone's parent, removed at the end.
#
#   bash scripts/demo-attest-diff.sh                                        # print only
#   BLACKBOX_DEMO_OUT=receipts/attest-diff-demo bash scripts/demo-attest-diff.sh   # also keep the output
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/packages/proxy/dist/cli.js"
CALL="$ROOT/packages/proxy/dist/call.js"
[ -f "$CLI" ] && [ -f "$CALL" ] || { echo "Setup required: run pnpm install && pnpm build first"; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/out"
REPO="$TMP/repo"
mkdir -p "$OUT/agent-clean" "$OUT/agent-human-edit" "$OUT/agent-bypass"

json() { node -e 'const [path, file] = process.argv.slice(1); process.stdout.write(JSON.stringify({ path, content: require("node:fs").readFileSync(file, "utf8") }))' "$1" "$2"; }
# agent_write <path> <file with the new content> [--new-session]: one write_file call through the proxy.
agent_write() {
  if [ "${3:-}" = "--new-session" ]; then node "$CALL" --new-session write_file "$(json "$1" "$2")" >/dev/null
  else node "$CALL" write_file "$(json "$1" "$2")" >/dev/null; fi
  echo "   agent write_file $1 (receipt recorded)"
}
# export_and_commit <branch-dir> <message>: export the session to receipts/<session>/ and commit it with the change.
export_and_commit() {
  node "$CLI" export | sed 's/^/   /' | tee "$OUT/$1/export.txt"
  git add -A
  git commit -qm "$2"
  echo "   committed $(git rev-parse --short HEAD): $2"
}
# gate <branch-dir>: exactly what CI runs on the request, with its JUnit summary.
gate() {
  echo
  echo "== CI gate on $1: bash scripts/ci/attest-diff-pr.sh <base>"
  local code=0
  # Pinned to the agent proxy's public key, as CI must be (the gate fails closed without a pin).
  BLACKBOX_PUBLIC_KEY="$(cat "$TMP/agent-proxy-key/public-key.pem")" BLACKBOX_KEY_DIR= bash "$ROOT/scripts/ci/attest-diff-pr.sh" "$BASE" "$OUT/$1" > "$OUT/$1/gate.txt" 2>&1 || code=$?
  sed 's/^/   /' "$OUT/$1/gate.txt"
  echo "$code" > "$OUT/$1/exit-code"
  git diff --stat "$BASE" HEAD > "$OUT/$1/changes.txt"
  echo "   exit $code"
}

main() {
  git clone -q "$ROOT" "$REPO"
  cd "$REPO"
  BASE="$(git rev-parse HEAD)"
  git config user.name 'blackbox demo'
  git config user.email 'demo@blackbox.invalid'
  echo "== base $(git log -1 --format='%h %s' "$BASE")"
  echo "   temp clone of $(basename "$ROOT"); proxy, bridge and CLI from packages/proxy/dist"
  # The agent's proxy signs with its own throwaway key; the CI gate signs its attestation with another.
  export BLACKBOX_KEY_DIR="$TMP/agent-proxy-key"

  echo
  echo "== branch agent/clean: the agent fixes parseLine (it read \"12abc\" as 12) and notes it"
  git checkout -q -b agent/clean "$BASE"
  export RECEIPTS_DIR="$TMP/store-clean"
  cat > "$TMP/parse.ts" <<'TS'
/** Parses one line of input. Blank lines and `#` comments yield null. */
export function parseLine(line: string): number | null {
  const text = line.trim();
  if (!text || text.startsWith('#')) return null;
  // parseInt alone would read "12abc" as 12; only whole integers count.
  if (!/^[+-]?\d+$/.test(text)) throw new Error(`Not a number: ${text}`);
  return Number.parseInt(text, 10);
}
TS
  printf '# Changelog\n\n- parseLine rejects lines with trailing characters ("12abc") instead of reading them as 12.\n' > "$TMP/CHANGELOG.md"
  agent_write examples/injection-repo/src/parse.ts "$TMP/parse.ts" --new-session
  agent_write examples/injection-repo/CHANGELOG.md "$TMP/CHANGELOG.md"
  export_and_commit agent-clean 'agent: parseLine rejects trailing characters'
  gate agent-clean

  echo
  echo "== branch agent/human-edit: agent/clean plus a human commit on the agent's file"
  git checkout -q -b agent/human-edit agent/clean
  printf -- '- Reviewed by hand.\n' >> examples/injection-repo/CHANGELOG.md
  git commit -qam 'human: note the review'
  echo "   committed $(git rev-parse --short HEAD): human: note the review (edits examples/injection-repo/CHANGELOG.md directly)"
  gate agent-human-edit

  echo
  echo "== branch agent/bypass: one write through the proxy, one file written with a plain shell around it"
  git checkout -q -b agent/bypass "$BASE"
  export RECEIPTS_DIR="$TMP/store-bypass"
  agent_write examples/injection-repo/src/parse.ts "$TMP/parse.ts" --new-session
  bash -c 'printf "export const debug = process.env;\n" > examples/injection-repo/src/debug.ts'
  echo "   shell (not the proxy) wrote examples/injection-repo/src/debug.ts: no receipt"
  export_and_commit agent-bypass 'agent: parse fix plus a debug helper'
  gate agent-bypass

  echo
  echo "== summary (base $(git rev-parse --short "$BASE"))"
  printf '   %-18s exit %s (expected 0: green)\n' agent/clean "$(cat "$OUT/agent-clean/exit-code")"
  printf '   %-18s exit %s (expected 1: red)\n' agent/human-edit "$(cat "$OUT/agent-human-edit/exit-code")"
  printf '   %-18s exit %s (expected 1: red)\n' agent/bypass "$(cat "$OUT/agent-bypass/exit-code")"
  [ "$(cat "$OUT/agent-clean/exit-code")" = 0 ] && [ "$(cat "$OUT/agent-human-edit/exit-code")" = 1 ] && [ "$(cat "$OUT/agent-bypass/exit-code")" = 1 ] \
    || { echo "UNEXPECTED: a branch did not get its expected verdict"; return 1; }
  # The exported sessions the gate read, as committed on their branches.
  for branch in clean bypass; do
    git -C "$REPO" diff --name-only "$BASE" "agent/$branch" -- receipts | while read -r file; do
      mkdir -p "$OUT/agent-$branch/$(dirname "$file")"
      git -C "$REPO" show "agent/$branch:$file" > "$OUT/agent-$branch/$file"
    done
  done
}

set +e
main 2>&1 | tee "$OUT/demo-output.txt"
RESULT=${PIPESTATUS[0]}
set -e
if [ "$RESULT" = 0 ] && [ -n "${BLACKBOX_DEMO_OUT:-}" ]; then
  DEST="$ROOT/$BLACKBOX_DEMO_OUT"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp -R "$OUT/." "$DEST/"
  echo "kept the output in $BLACKBOX_DEMO_OUT/"
fi
exit "$RESULT"
