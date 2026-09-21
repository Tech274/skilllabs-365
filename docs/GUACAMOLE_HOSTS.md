# Dual Guacamole hosts (AWS + Azure)

SkillLabs Hub routes lab Connect iframes to a **provider-specific** public Guacamole host.

| Cloud | Public iframe host (HTTPS) | Admin API secrets |
| --- | --- | --- |
| **AWS** | `https://guac.skillhub365.co.in` (EC2 `3.6.228.159`) | `GUACAMOLE_URL`, `GUACAMOLE_ADMIN_USERNAME`, `GUACAMOLE_ADMIN_PASSWORD` |
| **Azure** | `https://guac-azure.skillhub365.co.in` | `GUACAMOLE_AZURE_URL`, `GUACAMOLE_AZURE_ADMIN_USERNAME`, `GUACAMOLE_AZURE_ADMIN_PASSWORD` |

## How Connect picks the host

1. `guacamole-proxy` loads the VM and resolves `aws` | `azure` from `virtual_machines.provider_account_id` → `cloud_provider_accounts.provider` (fallback: `lab_templates.provider`).
2. It authenticates to that cloud’s Guac **admin** API (`resolveGuacAdminEndpoint`).
3. It builds `iframe_url` with `buildPublicIframeUrl(..., publicBase, ...)` using the matching public origin.
4. The frontend `toBrowserSafeGuacUrl` **trusts** known public HTTPS hosts from the proxy; private/`http` URLs are rewritten with the provider map.

## Env names (minimal blast radius)

| Secret | Purpose |
| --- | --- |
| `GUACAMOLE_URL` + `GUACAMOLE_ADMIN_*` | Legacy / **AWS** Guac admin (required today). |
| `GUACAMOLE_AWS_PUBLIC_URL` or `GUACAMOLE_PUBLIC_URL` | Optional AWS iframe origin override. |
| `GUACAMOLE_AZURE_URL` + `GUACAMOLE_AZURE_ADMIN_*` | Second gateway when Azure Guac is online; until set, Azure labs **fall back** to legacy `GUACAMOLE_*`. |
| `GUACAMOLE_AZURE_PUBLIC_URL` | Optional Azure iframe origin override. Default locked hostname applies only once `GUACAMOLE_AZURE_URL` is set (token host must match admin API). |

Shared code: `supabase/functions/_shared/guac-hosts.ts` (edge) and `src/lib/guac-public-hosts.ts` (browser).

## AWS cross-region note (P0 Connect)

Verified topology (2026-09-21 IST):

| Piece | Location |
| --- | --- |
| Guac AWS (`guac.skillhub365.co.in`) | EC2 `3.6.228.159` **ap-south-1** |
| SkillTrack AWS labs | **us-east-1** VPC `vpc-07adde441ca10fb1c`, private `10.0.x` |
| Lab SG `gateway_cidr` | `3.6.228.159/32` (Guac public IP) |

`guacamole-proxy` therefore dials **AWS lab `public_ip`** by default (`GUAC_LAB_HOSTNAME=auto`) so guacd can reach labs over the internet. Override with `GUAC_LAB_HOSTNAME=private` only when Guac shares a routed path to lab RFC1918 (same VPC / TGW).

From the Guac host (Ops verify, do **not** terminate Guac):

```bash
# Should succeed after public_ip dial + SG allow
nc -vz <lab-public-ip> 22    # Ubuntu / SSH
nc -vz <lab-public-ip> 3389  # Windows / RDP
# Private path expected to fail while Guac stays ap-south-1:
nc -vz <lab-private-ip> 22
```
