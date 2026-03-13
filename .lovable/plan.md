

# Reset All Sessions & VMs

## Current State
- **5 active sessions** (3 VMs running, some sessions share the same VM)
- **3 running VMs** in Azure (IPs: 10.0.0.7, 10.0.0.8, 10.0.0.16)

## What Will Be Done

1. **Mark all active sessions as completed** — update `sessions` table, set `status = 'completed'` and `ended_at = now()`
2. **Mark all running VMs as terminated** — update `virtual_machines` table, set `status = 'terminated'`
3. **Trigger cleanup edge function** — invoke `cleanup-idle-labs` to deallocate the Azure VMs and remove Guacamole connections from the gateway
4. **Clear session events** for the terminated sessions (optional, preserves audit trail if skipped)

This will leave the platform in a clean state with no active sessions or running VMs. The Azure VMs will be deallocated and their Guacamole connections removed.

## Technical Detail
- Database updates via migration SQL
- The `cleanup-idle-labs` function already handles Azure VM deallocation + NIC deletion + Guacamole connection removal for terminated sessions

