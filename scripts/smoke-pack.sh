#!/usr/bin/env bash
#
# Packaging smoke test.
#
# Packs the tarball npm would publish, installs it into a throwaway project, and
# exercises it the way a consumer does. This catches an entire class of bug the
# in-process test suite cannot see: the unit/integration tests import tool
# servers directly from `src/`, so they pass even when the *published* package
# cannot spawn a single one.
#
# The specific regression it guards: tool servers were spawned via the local
# `tsx` binary against `src/**/*.ts`. `tsx` is a devDependency and `src/` is not
# in the published `files` list, so every server failed with ENOENT — and since
# startup failures are deliberately non-fatal, the CLI still printed a review,
# just one with no context tools behind it. Silent, not loud.
set -uo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
failed=0

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

pass() { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
fail() { printf "  ${RED}✗${RESET} %s\n" "$1"; failed=1; }

# `timeout` is GNU coreutils and absent from stock macOS, so this uses a Node
# implementation instead — Node is guaranteed present, being what we are
# testing. See scripts/with-timeout.mjs for why the bash `( sleep N; kill ) &`
# idiom is not a viable substitute. Exits 124 on timeout, like GNU timeout.
run_with_timeout() {
  node "$REPO_ROOT/scripts/with-timeout.mjs" "$@"
}

printf "${BOLD}Packaging smoke test${RESET}\n"
printf "${DIM}workdir: %s${RESET}\n" "$WORKDIR"

# ── 1. Build + pack ──────────────────────────────────────────────────────────
printf "\n${BLUE}${BOLD}▶ Pack${RESET}\n"
cd "$REPO_ROOT" || exit 1
if ! npm run build >/dev/null 2>&1; then
  fail "build"
  exit 1
fi
TARBALL="$(cd "$WORKDIR" && npm pack "$REPO_ROOT" --silent 2>/dev/null | tail -1)"
if [ -z "$TARBALL" ] || [ ! -f "$WORKDIR/$TARBALL" ]; then
  fail "npm pack produced no tarball"
  exit 1
fi
pass "packed $TARBALL"

# ── 2. Install as a consumer ─────────────────────────────────────────────────
printf "\n${BLUE}${BOLD}▶ Install${RESET}\n"
CONSUMER="$WORKDIR/consumer"
mkdir -p "$CONSUMER"
cd "$CONSUMER" || exit 1
npm init -y >/dev/null 2>&1
if ! npm install "$WORKDIR/$TARBALL" >/dev/null 2>&1; then
  fail "npm install of tarball"
  exit 1
fi
pass "installed into a clean project"

PKG_NAME="$(node -p "require('$REPO_ROOT/package.json').name")"
PKG_DIR="$CONSUMER/node_modules/$PKG_NAME"

# The dev-only runner must not be what consumers depend on.
if [ -x "$PKG_DIR/node_modules/.bin/tsx" ]; then
  fail "tsx present in the installed tree — the runner must not depend on it"
else
  pass "no tsx in the consumer install (as expected)"
fi

# ── 3. Every tool server must exist compiled and speak MCP ───────────────────
printf "\n${BLUE}${BOLD}▶ Tool servers${RESET}\n"
INIT_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
printf '%s\n' "$INIT_REQ" > "$WORKDIR/init.json"
for server in git-diff file-context conventions related-files; do
  entry="$PKG_DIR/dist/tools/$server/server.js"
  if [ ! -f "$entry" ]; then
    fail "$server: dist/tools/$server/server.js missing from the tarball"
    continue
  fi
  # stderr is captured rather than discarded: when this check fails, the reason
  # is almost always on stderr, and swallowing it leaves "<empty>" as the only
  # evidence — which is no evidence at all.
  reply="$(run_with_timeout 30 node "$entry" < "$WORKDIR/init.json" 2>"$WORKDIR/$server.err" | head -1)"
  if printf '%s' "$reply" | grep -q '"serverInfo"'; then
    pass "$server: responds to MCP initialize under plain node"
  else
    fail "$server: no valid initialize response (got: ${reply:-<empty>})"
    if [ -s "$WORKDIR/$server.err" ]; then
      printf "      ${DIM}stderr:${RESET}\n"
      head -5 "$WORKDIR/$server.err" | sed 's/^/        /'
    else
      printf "      ${DIM}(no stderr — the process produced nothing at all)${RESET}\n"
    fi
  fi
done

# ── 4. End-to-end: the CLI must start all servers ────────────────────────────
# Uses a dummy API key: the LLM call is expected to fail with 401, but server
# startup happens first, so the warnings we care about are already on stderr.
printf "\n${BLUE}${BOLD}▶ CLI end-to-end${RESET}\n"
DEMO="$WORKDIR/demo"
mkdir -p "$DEMO"
cd "$DEMO" || exit 1
git init -q . 2>/dev/null
git config user.email smoke@example.com
git config user.name "Smoke Test"
printf 'export const answer = 42;\n' > sample.ts
git add -A
git commit -qm "add sample" >/dev/null 2>&1

# Provider and model are pinned so an ambient MCP_REVIEW_MODEL / provider key in
# the operator's shell can't reroute this to a provider whose key is absent —
# the CLI would then exit before starting any server.
OUTPUT="$(ANTHROPIC_API_KEY=sk-smoke-test-not-a-real-key \
  run_with_timeout 120 "$CONSUMER/node_modules/.bin/mcp-review" HEAD~0..HEAD \
  --provider anthropic --model claude-sonnet-4-20250514 --verbose 2>&1)"
CLI_RC=$?

# 124 is the timeout exit code. Call it out by name rather than letting it look
# like a startup failure — a CLI that runs but never exits is a different bug
# from one that cannot spawn its servers.
if [ "$CLI_RC" -eq 124 ]; then
  fail "CLI did not exit within 120s (killed). Last output:"
  printf '%s\n' "$OUTPUT" | tail -5 | sed 's/^/      /'
fi

# Assert positively on the number of servers that reported a successful start.
# The previous check only asserted the *absence* of "Failed to start", so any
# run that produced no output at all — a missing `timeout`, a CLI that died
# before reaching startup — passed while proving nothing.
STARTED="$(printf '%s\n' "$OUTPUT" | grep -c '✓ start server:' || true)"
if [ "$STARTED" -eq 4 ]; then
  pass "CLI started all 4 tool servers"
else
  fail "CLI started $STARTED/4 tool servers"
  printf '%s\n' "$OUTPUT" | grep -E 'Failed to start|Error|error' | head -5 | sed 's/^/      /'
fi

# `--version` must reflect package.json rather than a hardcoded literal.
CLI_VERSION="$("$CONSUMER/node_modules/.bin/mcp-review" --version 2>/dev/null | tr -d '[:space:]')"
PKG_VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
if [ "$CLI_VERSION" = "$PKG_VERSION" ]; then
  pass "--version matches package.json ($PKG_VERSION)"
else
  fail "--version reported '$CLI_VERSION', package.json says '$PKG_VERSION'"
fi

printf "\n"
if [ "$failed" -eq 1 ]; then
  printf "${RED}${BOLD}Packaging smoke test failed.${RESET}\n"
  exit 1
fi
printf "${GREEN}${BOLD}Packaging smoke test passed.${RESET}\n"
