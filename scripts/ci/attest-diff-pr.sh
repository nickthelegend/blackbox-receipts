#!/usr/bin/env bash
# Receipt-gated merge for one pull/merge request: every file the request changes must be exactly what a
# signed write_file step in the agent's exported session produced.
#
#   bash scripts/ci/attest-diff-pr.sh <base-sha> [out-dir]
#
# The agent's export is the session the request adds or changes at receipts/<session>/session.jsonl
# (what `blackbox-receipts export` writes). No such session: the request is not an agent change, so the
# gate does not apply; this prints NOT APPLICABLE and exits 0. More than one: FAIL (the gate checks one
# session per request). Otherwise it runs `attest-diff` against <base-sha> and writes attest-diff.xml
# (JUnit) and attest-diff.json (signed attestation) to out-dir (default: the current directory), then
# prints the JUnit summary. Exit code: 0 green, 1 red, 2 usage.
#
# Pin the proxy key with BLACKBOX_PUBLIC_KEY (PEM). The attestation is signed with a throwaway key made
# for this run unless RECEIPTS_SIGNING_KEY or BLACKBOX_KEY_DIR is set.
# BLACKBOX_CLI overrides the CLI entry point (default: packages/proxy/dist/cli.js next to this script).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="${1:-}"
OUT="${2:-.}"
[ -n "$BASE" ] || { echo "Usage: attest-diff-pr.sh <base-sha> [out-dir]" >&2; exit 2; }
CLI="${BLACKBOX_CLI:-$ROOT/packages/proxy/dist/cli.js}"
[ -f "$CLI" ] || { echo "Setup required: $CLI not found (run pnpm install && pnpm build)" >&2; exit 2; }
git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || { echo "FAIL attest-diff: base $BASE is not a commit in this clone (fetch with full history)" >&2; exit 1; }

if [ -z "${RECEIPTS_SIGNING_KEY:-}" ] && [ -z "${BLACKBOX_KEY_DIR:-}" ]; then
  KEYS="$(mktemp -d)"
  trap 'rm -rf "$KEYS"' EXIT
  export BLACKBOX_KEY_DIR="$KEYS"
fi

# Exported sessions this request adds or changes, at depth receipts/<session>/ only (committed demo
# material under deeper folders such as receipts/agent-demo/<id>/ is not a request's own session).
SESSIONS=()
while IFS= read -r file; do
  [ -n "$file" ] && SESSIONS+=("$(dirname "$file")")
done < <(git diff --name-only --diff-filter=AM "$BASE" -- 'receipts/*/session.jsonl' | grep -E '^receipts/[^/]+/session\.jsonl$' || true)

if [ "${#SESSIONS[@]}" -eq 0 ]; then
  echo "NOT APPLICABLE attest-diff: this request adds no exported agent session (receipts/<session>/session.jsonl), so there are no receipts to gate it on."
  exit 0
fi
if [ "${#SESSIONS[@]}" -gt 1 ]; then
  echo "FAIL attest-diff: this request adds ${#SESSIONS[@]} exported sessions (${SESSIONS[*]}); the gate checks one session per request."
  exit 1
fi

mkdir -p "$OUT"
echo "== attest-diff against $BASE using ${SESSIONS[0]}"
set +e
node "$CLI" attest-diff --base "$BASE" --from "${SESSIONS[0]}" --junit "$OUT/attest-diff.xml" --out "$OUT/attest-diff.json"
STATUS=$?
set -e
echo "== JUnit summary (attest-diff.xml)"
node -e '
const xml = require("node:fs").readFileSync(process.argv[1], "utf8");
const suite = xml.match(/<testsuite name="([^"]*)" tests="(\d+)" failures="(\d+)"/);
if (!suite) { console.log("(no testsuite in the JUnit file)"); process.exit(0); }
console.log(`${suite[1]}: ${suite[2]} test(s), ${suite[3]} failure(s)`);
for (const [, name, body] of xml.matchAll(/<testcase classname="[^"]*" name="([^"]*)">([\s\S]*?)<\/testcase>/g)) {
  const failure = body.match(/<failure message="([^"]*)"/);
  console.log(`  ${failure ? "FAIL" : "ok  "} ${name}${failure ? ` - ${failure[1].replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")}` : ""}`);
}' "$OUT/attest-diff.xml"
exit "$STATUS"
