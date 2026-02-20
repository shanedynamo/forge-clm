#!/usr/bin/env bash
#
# validate-local.sh — Single script to validate the entire forge-clm stack locally.
#
# Steps:
#   1. Start Docker test stack (postgres-test, redis-test, localstack-test)
#   2. Wait for healthy containers
#   3. Run shared package unit tests
#   4. Run API unit tests (auth, contracts, modifications, requests, health)
#   5. Run integration tests (agent workflows, performance, docker validation)
#   6. Run E2E Playwright tests
#   7. Print summary and tear down on exit
#
# Usage:
#   ./scripts/validate-local.sh           # Full run (starts/stops Docker)
#   ./scripts/validate-local.sh --no-docker  # Skip Docker lifecycle (stack already running)
#   ./scripts/validate-local.sh --keep-up    # Don't tear down Docker after tests
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ─── Config ──────────────────────────────────────────────────────────

COMPOSE_FILE="docker-compose.test.yml"
COMPOSE_PROJECT="forge-test"
DB_URL="postgresql://forge:forge@localhost:5433/forge_test"

NO_DOCKER=false
KEEP_UP=false

for arg in "$@"; do
  case "$arg" in
    --no-docker) NO_DOCKER=true ;;
    --keep-up) KEEP_UP=true ;;
  esac
done

# ─── Colors ──────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Tracking ────────────────────────────────────────────────────────

PASS=0
FAIL=0
SKIP=0
RESULTS=()

record() {
  local name="$1" status="$2"
  if [[ "$status" == "PASS" ]]; then
    RESULTS+=("${GREEN}✓${NC} $name")
    ((PASS++))
  elif [[ "$status" == "FAIL" ]]; then
    RESULTS+=("${RED}✗${NC} $name")
    ((FAIL++))
  else
    RESULTS+=("${YELLOW}⊘${NC} $name (skipped)")
    ((SKIP++))
  fi
}

step() {
  echo ""
  echo -e "${CYAN}━━━ $1 ━━━${NC}"
}

# ─── Cleanup trap ────────────────────────────────────────────────────

cleanup() {
  if [[ "$NO_DOCKER" == false && "$KEEP_UP" == false ]]; then
    step "Tearing down Docker test stack"
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" down -v --remove-orphans 2>/dev/null || true
  fi

  # ─── Summary ─────────────────────────────────────────────────────
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  VALIDATION SUMMARY${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  for result in "${RESULTS[@]}"; do
    echo -e "  $result"
  done
  echo ""
  echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}  ${YELLOW}Skipped: $SKIP${NC}"
  echo ""

  if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}${BOLD}  VALIDATION FAILED${NC}"
    echo ""
    exit 1
  else
    echo -e "${GREEN}${BOLD}  ALL VALIDATIONS PASSED${NC}"
    echo ""
    exit 0
  fi
}

trap cleanup EXIT

# ─── Step 1: Docker test stack ───────────────────────────────────────

if [[ "$NO_DOCKER" == false ]]; then
  step "Step 1: Starting Docker test stack"
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" down -v --remove-orphans 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d --wait

  # Verify containers are healthy
  echo "Checking container health..."
  sleep 2

  PG_HEALTHY=$(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" ps --format json 2>/dev/null | grep -c '"healthy"' || echo "0")
  if [[ "$PG_HEALTHY" -ge 1 ]]; then
    echo -e "  ${GREEN}✓${NC} Docker containers are healthy"
    record "Docker test stack startup" "PASS"
  else
    # Fallback: try connecting directly
    if pg_isready -h localhost -p 5433 -U forge 2>/dev/null; then
      echo -e "  ${GREEN}✓${NC} PostgreSQL is accepting connections"
      record "Docker test stack startup" "PASS"
    else
      echo -e "  ${RED}✗${NC} Docker containers not healthy"
      record "Docker test stack startup" "FAIL"
    fi
  fi
else
  step "Step 1: Skipping Docker lifecycle (--no-docker)"
  record "Docker test stack startup" "SKIP"
fi

# ─── Step 2: Shared package unit tests ──────────────────────────────

step "Step 2: Shared package unit tests (@forge/shared)"
if npx vitest run packages/shared/src/ --reporter=verbose 2>&1 | tee /tmp/forge-shared-test.log; then
  record "Shared unit tests" "PASS"
else
  record "Shared unit tests" "FAIL"
fi

# ─── Step 3: API unit tests ─────────────────────────────────────────

step "Step 3: API unit tests (@forge/api)"
if DATABASE_URL="$DB_URL" npx vitest run packages/api/src/__tests__/ --fileParallelism=false --reporter=verbose 2>&1 | tee /tmp/forge-api-test.log; then
  record "API unit tests" "PASS"
else
  record "API unit tests" "FAIL"
fi

# ─── Step 4: Integration tests (agent workflows) ────────────────────

step "Step 4: Integration tests (agent workflows)"
INTEGRATION_FILES=$(find tests/integration -name "*.test.ts" ! -name "performance*" ! -name "docker-full*" 2>/dev/null || true)
if [[ -n "$INTEGRATION_FILES" ]]; then
  if DATABASE_URL="$DB_URL" npx vitest run $INTEGRATION_FILES --config tests/vitest.integration.config.ts --fileParallelism=false --reporter=verbose 2>&1 | tee /tmp/forge-integration-test.log; then
    record "Integration tests (agents)" "PASS"
  else
    record "Integration tests (agents)" "FAIL"
  fi
else
  echo "  No agent integration test files found, skipping"
  record "Integration tests (agents)" "SKIP"
fi

# ─── Step 5: Performance benchmarks ─────────────────────────────────

step "Step 5: Performance benchmarks"
if DATABASE_URL="$DB_URL" npx vitest run tests/integration/performance.test.ts --config tests/vitest.integration.config.ts --fileParallelism=false --reporter=verbose 2>&1 | tee /tmp/forge-perf-test.log; then
  record "Performance benchmarks" "PASS"
else
  record "Performance benchmarks" "FAIL"
fi

# ─── Step 6: Docker full validation ─────────────────────────────────

step "Step 6: Docker full validation (12-step)"
if DATABASE_URL="$DB_URL" REDIS_URL="redis://localhost:6380" AWS_ENDPOINT="http://localhost:4567" \
   npx vitest run tests/integration/docker-full-validation.test.ts --config tests/vitest.integration.config.ts --fileParallelism=false --reporter=verbose 2>&1 | tee /tmp/forge-docker-test.log; then
  record "Docker full validation" "PASS"
else
  record "Docker full validation" "FAIL"
fi

# ─── Step 7: E2E Playwright tests ───────────────────────────────────

step "Step 7: E2E Playwright tests"
if npx playwright test --config playwright.config.ts --reporter=list 2>&1 | tee /tmp/forge-e2e-test.log; then
  record "E2E Playwright tests" "PASS"
else
  record "E2E Playwright tests" "FAIL"
fi

# cleanup runs via trap
