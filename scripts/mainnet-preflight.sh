#!/usr/bin/env bash

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASS_COUNT++))
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ((WARN_COUNT++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAIL_COUNT++))
}

log_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Print banner
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     STELLAR GREENPAY MAINNET PREFLIGHT CHECK             ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# 1. REQUIRED ENVIRONMENT VARIABLES CHECK
# =============================================================================
log_section "1. Checking Required Environment Variables"

REQUIRED_VARS=(
    "STELLAR_NETWORK"
    "STELLAR_RPC_URL"
    "CONTRACT_ID"
    "DATABASE_URL"
    "REDIS_URL"
    "WEBHOOK_URL"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        log_fail "Environment variable '$var' is not set or is empty"
    else
        log_pass "Environment variable '$var' is set"
    fi
done

# =============================================================================
# 2. STELLAR NETWORK ENFORCEMENT
# =============================================================================
log_section "2. Validating Stellar Network Configuration"

if [[ -z "${STELLAR_NETWORK:-}" ]]; then
    log_fail "STELLAR_NETWORK is not set"
elif [[ "${STELLAR_NETWORK}" != "mainnet" ]]; then
    log_fail "STELLAR_NETWORK must be 'mainnet' but is set to '${STELLAR_NETWORK}'"
else
    log_pass "STELLAR_NETWORK is correctly set to 'mainnet'"
fi

# =============================================================================
# 3. MAINNET CONTRACT DEPLOYMENT & INITIALIZATION
# =============================================================================
log_section "3. Verifying Contract Deployment on Mainnet"

if [[ -z "${CONTRACT_ID:-}" ]]; then
    log_fail "CONTRACT_ID is not set, skipping contract verification"
elif [[ -z "${STELLAR_RPC_URL:-}" ]]; then
    log_fail "STELLAR_RPC_URL is not set, cannot verify contract"
else
    log_info "Checking contract ${CONTRACT_ID} on ${STELLAR_RPC_URL}"
    
    # Try using stellar CLI if available
    if command -v stellar &> /dev/null; then
        log_info "Using Stellar CLI to verify contract..."
        
        # Attempt to read contract data
        if stellar contract read --id "${CONTRACT_ID}" --network mainnet --rpc-url "${STELLAR_RPC_URL}" 2>&1 | grep -qiE "(error|not found|invalid)"; then
            log_fail "Contract ${CONTRACT_ID} does not appear to be deployed or initialized on mainnet"
        else
            log_pass "Contract ${CONTRACT_ID} is deployed and accessible on mainnet"
        fi
    else
        # Fallback to JSON-RPC verification
        log_info "Stellar CLI not found, using JSON-RPC verification..."
        
        # Convert CONTRACT_ID to ScAddress for getLedgerEntries
        CONTRACT_KEY=$(echo -n "${CONTRACT_ID}" | base64 -w 0 2>/dev/null || echo -n "${CONTRACT_ID}" | base64)
        
        RPC_RESPONSE=$(curl -s -X POST "${STELLAR_RPC_URL}" \
            -H "Content-Type: application/json" \
            -d "{
                \"jsonrpc\": \"2.0\",
                \"id\": 1,
                \"method\": \"getLedgerEntries\",
                \"params\": {
                    \"keys\": [\"${CONTRACT_KEY}\"]
                }
            }" 2>/dev/null || echo '{"error":"curl_failed"}')
        
        if echo "${RPC_RESPONSE}" | grep -q '"result"'; then
            if echo "${RPC_RESPONSE}" | grep -q '"entries"'; then
                log_pass "Contract ${CONTRACT_ID} verified on mainnet via RPC"
            else
                log_warn "Contract verification response received but no entries found. Manual verification recommended."
            fi
        else
            log_fail "Unable to verify contract on mainnet. Response: ${RPC_RESPONSE}"
        fi
    fi
fi

# =============================================================================
# 4. WEBHOOK_URL FORMAT VALIDATION
# =============================================================================
log_section "4. Validating Webhook URL Format"

if [[ -z "${WEBHOOK_URL:-}" ]]; then
    log_fail "WEBHOOK_URL is not set, skipping format validation"
else
    # Check for HTTPS
    if [[ ! "${WEBHOOK_URL}" =~ ^https:// ]]; then
        log_fail "WEBHOOK_URL must use HTTPS protocol, got: ${WEBHOOK_URL}"
    elif [[ "${WEBHOOK_URL}" =~ ^http:// ]]; then
        log_fail "WEBHOOK_URL uses insecure HTTP protocol: ${WEBHOOK_URL}"
    # Validate URL format
    elif [[ ! "${WEBHOOK_URL}" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$ ]]; then
        log_fail "WEBHOOK_URL has invalid format: ${WEBHOOK_URL}"
    else
        log_pass "WEBHOOK_URL format is valid: ${WEBHOOK_URL}"
    fi
fi

# =============================================================================
# 5. DATABASE MIGRATIONS STATUS
# =============================================================================
log_section "5. Checking Database Connectivity and Migrations"

if [[ -z "${DATABASE_URL:-}" ]]; then
    log_fail "DATABASE_URL is not set, skipping database checks"
else
    log_info "Testing database connectivity..."
    
    # Try PostgreSQL connection test
    if command -v psql &> /dev/null; then
        if psql "${DATABASE_URL}" -c "SELECT 1;" &> /dev/null; then
            log_pass "Database is reachable"
            
            # Check for migration files
            if [[ -d "backend/src/db/migrations" ]]; then
                MIGRATION_COUNT=$(find backend/src/db/migrations -name "*.js" -o -name "*.sql" | wc -l)
                log_info "Found ${MIGRATION_COUNT} migration files"
                
                # Check if migrations are applied (project-specific)
                if [[ -f "backend/src/db/migrate.js" ]]; then
                    log_info "Running migration status check..."
                    if node backend/src/db/migrate.js --check 2>&1 | grep -qiE "(pending|not applied)"; then
                        log_fail "Database has pending migrations that need to be applied"
                    else
                        log_pass "All database migrations appear to be applied"
                    fi
                else
                    log_warn "Migration script not found, cannot verify migration status"
                fi
            else
                log_warn "No migrations directory found"
            fi
        else
            log_fail "Cannot connect to database at ${DATABASE_URL}"
        fi
    else
        # Try basic TCP connection test
        DB_HOST=$(echo "${DATABASE_URL}" | sed -n 's|.*@\([^:/]*\).*|\1|p')
        DB_PORT=$(echo "${DATABASE_URL}" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
        DB_PORT=${DB_PORT:-5432}
        
        if command -v nc &> /dev/null; then
            if nc -zv "${DB_HOST}" "${DB_PORT}" &> /dev/null; then
                log_pass "Database host ${DB_HOST}:${DB_PORT} is reachable"
                log_warn "psql not available, cannot verify migrations status"
            else
                log_fail "Cannot connect to database host ${DB_HOST}:${DB_PORT}"
            fi
        else
            log_warn "Neither psql nor nc available, cannot verify database connectivity"
        fi
    fi
fi

# =============================================================================
# 6. REDIS CONNECTION TEST
# =============================================================================
log_section "6. Testing Redis Connectivity"

if [[ -z "${REDIS_URL:-}" ]]; then
    log_fail "REDIS_URL is not set, skipping Redis checks"
else
    log_info "Testing Redis connection to ${REDIS_URL}"
    
    # Try redis-cli first
    if command -v redis-cli &> /dev/null; then
        if redis-cli -u "${REDIS_URL}" PING 2>&1 | grep -q "PONG"; then
            log_pass "Redis is reachable and responding to PING"
        else
            log_fail "Redis did not respond to PING command"
        fi
    else
        # Fallback to TCP connection test
        REDIS_HOST=$(echo "${REDIS_URL}" | sed -n 's|redis://\([^:/]*\).*|\1|p')
        REDIS_PORT=$(echo "${REDIS_URL}" | sed -n 's|.*:\([0-9]*\)$|\1|p')
        REDIS_PORT=${REDIS_PORT:-6379}
        
        if command -v nc &> /dev/null; then
            if nc -zv "${REDIS_HOST}" "${REDIS_PORT}" &> /dev/null; then
                log_pass "Redis host ${REDIS_HOST}:${REDIS_PORT} is reachable"
                log_warn "redis-cli not available, PING test not performed"
            else
                log_fail "Cannot connect to Redis host ${REDIS_HOST}:${REDIS_PORT}"
            fi
        else
            log_warn "Neither redis-cli nor nc available, cannot verify Redis connectivity"
        fi
    fi
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
log_section "Preflight Check Summary"

echo ""
echo -e "${GREEN}✓ Passed:${NC} ${PASS_COUNT}"
echo -e "${YELLOW}⚠ Warnings:${NC} ${WARN_COUNT}"
echo -e "${RED}✗ Failed:${NC} ${FAIL_COUNT}"
echo ""

if [[ ${FAIL_COUNT} -eq 0 ]]; then
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✓ ALL PREFLIGHT CHECKS PASSED                           ║${NC}"
    echo -e "${GREEN}║  System is ready for mainnet deployment                  ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ✗ PREFLIGHT CHECKS FAILED                                ║${NC}"
    echo -e "${RED}║  ${FAIL_COUNT} check(s) failed - DO NOT DEPLOY TO MAINNET           ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 1
fi
