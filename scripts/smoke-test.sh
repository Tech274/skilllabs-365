#!/usr/bin/env bash
# Staging smoke test: provision a lab, open a Guacamole session, then verify
# the session and VM are cleaned up afterwards.
#
# Usage:
#   SUPABASE_URL=... SUPABASE_ANON_KEY=... SMOKE_EMAIL=... SMOKE_PASSWORD=... \
#   SMOKE_LAB_TEMPLATE_ID=... bash scripts/smoke-test.sh
#
# The account must be a normal (non-admin) user that is allowed to launch the
# given published lab template. Nothing is left running: the script always
# cancels the lab it created.
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
: "${SMOKE_EMAIL:?SMOKE_EMAIL is required}"
: "${SMOKE_PASSWORD:?SMOKE_PASSWORD is required}"
: "${SMOKE_LAB_TEMPLATE_ID:?SMOKE_LAB_TEMPLATE_ID is required}"

PROVISION_TIMEOUT_SECONDS="${PROVISION_TIMEOUT_SECONDS:-420}"
CORRELATION_ID="smoke_$(date +%s)"
IDEMPOTENCY_KEY="smoke-$(date +%s)-$RANDOM"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }
json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get(sys.argv[1]) if isinstance(d,dict) and d.get(sys.argv[1]) is not None else "")' "$1"; }

api() { # api <path> <json-body>
  curl -sS -X POST "$SUPABASE_URL/functions/v1/$1" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -H "x-correlation-id: $CORRELATION_ID" \
    -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
    -d "$2"
}

rest() { # rest <query>
  curl -sS "$SUPABASE_URL/rest/v1/$1" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "apikey: $SUPABASE_ANON_KEY"
}

log "Signing in as $SMOKE_EMAIL"
AUTH=$(curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")
ACCESS_TOKEN=$(printf '%s' "$AUTH" | json access_token)
[ -n "$ACCESS_TOKEN" ] || fail "sign-in failed: $AUTH"

VM_ID=""
cleanup() {
  if [ -n "$VM_ID" ]; then
    log "Cleaning up VM $VM_ID"
    api cleanup-idle-labs "{\"action\":\"cancel-provisioning\",\"vm_id\":\"$VM_ID\"}" >/dev/null || true
  fi
}
trap cleanup EXIT

log "Provisioning lab $SMOKE_LAB_TEMPLATE_ID (correlation $CORRELATION_ID)"
PROV=$(api provision-lab "{\"lab_template_id\":\"$SMOKE_LAB_TEMPLATE_ID\"}")
VM_ID=$(printf '%s' "$PROV" | json vm_id)
[ -n "$VM_ID" ] || fail "provisioning did not return a vm_id: $PROV"
echo "vm_id=$VM_ID"

log "Verifying idempotency (repeating the same request must not create a second VM)"
REPEAT=$(api provision-lab "{\"lab_template_id\":\"$SMOKE_LAB_TEMPLATE_ID\"}")
REPEAT_VM=$(printf '%s' "$REPEAT" | json vm_id)
[ "$REPEAT_VM" = "$VM_ID" ] || fail "duplicate request created a different VM ($REPEAT_VM)"

log "Waiting for the VM to reach running state (timeout ${PROVISION_TIMEOUT_SECONDS}s)"
DEADLINE=$(( $(date +%s) + PROVISION_TIMEOUT_SECONDS ))
STATUS=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(api check-vm-status "{\"vm_id\":\"$VM_ID\"}" | json status)
  echo "  status=$STATUS"
  case "$STATUS" in
    running) break ;;
    failed|terminated) fail "VM entered terminal state $STATUS" ;;
  esac
  sleep 15
done
[ "$STATUS" = "running" ] || fail "VM did not become running in time (last status: $STATUS)"

log "Opening a Guacamole session"
SESSION=$(api guacamole-proxy "{\"action\":\"create-session\",\"vm_id\":\"$VM_ID\"}")
SESSION_ID=$(printf '%s' "$SESSION" | json session_id)
IFRAME=$(printf '%s' "$SESSION" | json iframe_url)
[ -n "$SESSION_ID" ] || fail "no session created: $SESSION"
case "$IFRAME" in *"/#/client/"*) ;; *) fail "unexpected iframe url: $IFRAME" ;; esac

log "Ending the session"
api guacamole-proxy "{\"action\":\"end-session\",\"session_id\":\"$SESSION_ID\"}" >/dev/null
SESSION_STATUS=$(rest "sessions?id=eq.$SESSION_ID&select=status" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r[0]["status"] if r else "")')
[ "$SESSION_STATUS" != "active" ] || fail "session $SESSION_ID is still active after end-session"

log "Cancelling the lab and verifying cleanup"
CANCEL=$(api cleanup-idle-labs "{\"action\":\"cancel-provisioning\",\"vm_id\":\"$VM_ID\"}")
CANCEL_DELETED=$(printf '%s' "$CANCEL" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("deleted","")).lower())' 2>/dev/null || echo "")
VM_STATUS=$(rest "virtual_machines?id=eq.$VM_ID&select=status" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r[0]["status"] if r else "")')
if [ "$CANCEL_DELETED" = "false" ]; then
  # SCRUM-106: a used VM (the smoke opened a session) is soft-stopped, never deleted.
  [ "$VM_STATUS" = "deallocated" ] || fail "Cancel kept the VM but it is not deallocated (status: $VM_STATUS)"
  echo "::warning::Smoke VM $VM_ID was soft-stopped (kept, deallocated) per SCRUM-106 — an admin must purge it (delete-vm) to avoid storage cost."
  VM_ID=""  # nothing more to clean up as the learner
else
  [ "$VM_STATUS" = "terminated" ] || fail "VM was not terminated (status: $VM_STATUS)"
fi
VM_ID=""

log "Provisioning timeline for $CORRELATION_ID"
rest "provisioning_events?correlation_id=eq.$CORRELATION_ID&select=step,status,message&order=created_at.asc" \
  | python3 -c 'import json,sys; [print(f"  {e[\"step\"]:24} {e[\"status\"]:8} {e.get(\"message\") or \"\"}") for e in json.load(sys.stdin)]'

printf '\n\033[1;32mSmoke test passed.\033[0m\n'
