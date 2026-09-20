# Connect session lifecycle (Phase 2)

SkillHub Labs Connect is a **desktop tunnel to an already-running lab VM**. Closing or reminting Connect is not the same as stopping the cloud VM.

## Rules (intentional)

| Action | Guacamole connection | Lab VM (`virtual_machines.status`) |
| --- | --- | --- |
| **Connect** (iframe / token) | Created or reminted | Unchanged — stays `running` |
| **Disconnect** / close iframe / end Guac session | Removed or stale | **Stays `running`** — **does not deallocate** |
| **Remint Connect** (new token to same lab) | New connection to **same VM** (same private IP) | Unchanged — still `running` |
| **Idle cleanup** (`cleanup-idle-labs`, no session activity) | Cleaned if orphaned | **Deallocate** (soft stop) |
| **Soft-expiry** (`expires_at` / `labs-watchdog`) | Session ends | **Deallocate** (soft stop; not hard-delete by default) |
| **Intentional power-off** (`cleanup-idle-labs` `stop-vm`, or Azure deallocate) | Must reconnect after power-on | `deallocated` / stopped until started again |
| **Learner Leave** (toolbar Leave / soft-stop) | Ended (billable minutes deducted) | **Deallocate** soft-stop — same VM kept for Start remint; never delete |
| **Intentional power-on / start** after power-off | Remint Connect after VM is `running` again | Separate case from disconnect |

## Operator / soak notes

1. **Phase 2 reconnect fidelity:** after disconnect, remint Connect to the **same** VM. Do not expect Azure to deallocate on iframe close.
2. **Power-off / start** is a **separate** soak path from Connect churn. Treat it as its own scenario (stop → start → remint Connect).
3. **Soft-expiry policy** is owned by Architect GO. Do not change deallocate-on-expiry / idle behaviour without Atlas GO.
4. Azure Connect iframe host: `https://guac-azure.skillhub365.co.in` (see `GUACAMOLE_HOSTS.md`). AWS stays on `https://guac.skillhub365.co.in`.

## Related

- Soft-expiry / idle deallocate: `docs/PRODUCTION_RUNBOOK.md` § Cleanup cron
- Dual Guac hosts: `docs/GUACAMOLE_HOSTS.md`
- Networking RCA: `docs/GUAC_NETWORKING.md` (when merged)
