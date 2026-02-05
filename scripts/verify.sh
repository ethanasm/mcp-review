#!/usr/bin/env bash
set -uo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

results=()
failed=0

run_step() {
  local name="$1"
  shift
  printf "\n${BLUE}${BOLD}▶ %s${RESET}\n${DIM}─────────────────────────────────${RESET}\n" "$name"
  if "$@"; then
    results+=("${GREEN}✓ ${name}${RESET}")
  else
    results+=("${RED}✗ ${name}${RESET}")
    failed=1
  fi
}

printf "${BOLD}Running verification pipeline...${RESET}\n"

run_step "Lint & format"   bun run check
run_step "Typecheck"        bun run typecheck
run_step "Build"            bun run build
run_step "Test"             bun run test

printf "\n${BOLD}━━━ Summary ━━━${RESET}\n"
for r in "${results[@]}"; do
  printf "  %b\n" "$r"
done
printf "\n"

if [ "$failed" -eq 1 ]; then
  printf "${RED}${BOLD}Verification failed.${RESET}\n"
  exit 1
else
  printf "${GREEN}${BOLD}All checks passed.${RESET}\n"
fi
