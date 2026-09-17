# Admin Cloud Quotas (PR #4)

Capacity center under **Admin → Cloud Quotas** (`/admin/cloud-quotas`).

## Scope

| Provider | Sync | Notes |
| --- | --- | --- |
| **Azure** | **Live** | `cloud-quotas` edge function calls ARM Compute + Network location `usages` for curated bankable regions. Home region = **`centralindia`** (Central India — **not** `southindia`). |
| **AWS** | **Stub** | Service Quotas API is **not** wired. Sync now refreshes `not_connected` state + timestamps. STS federation credentials in Resource Providers are unrelated to quota read. |
| **GCP** | Out of scope | |

## Capacity math

SKU needs come from the most common `lab_templates.vm_size` among **published** templates. If none exist, Hub assumes:

- VM size: `Standard_B2s`
- 2 vCPU
- Family: `standardBSFamily`

Per region, **labs fit** = min of:

1. remaining family vCPU ÷ sku vCPU  
2. remaining total regional cores ÷ sku vCPU  
3. remaining Public IP Addresses (1 IP per lab)

## VM families (follow-on)

Azure sync keeps the **full Compute `*Family` set** returned by location usages — not BS-only.
Each region snapshot includes per-family **limit / usage / remaining** (and family-only `labsFit` at the SKU vCPU basis).

Lab-relevant families (provision / Launch Lab fallback chain):

- `standardBSFamily` — Standard_B2s / B2ms
- `standardDSv3Family` — Standard_D2s_v3
- `standardDSv5Family` — Standard_D2s_v5
- `standardDASv5Family` — Standard_D2as_v5
- plus other `*Family` keys Azure returns for the subscription

Admin UI: region filter + family filter; Top 5 bankable regions; home = `centralindia`.
Clear copy when remaining / labsFit is 0 (eastus BS unavailable + DSv5=0 must be visible).

## Persistence

| Table | Purpose |
| --- | --- |
| `cloud_quota_sync_state` | Per-provider last OK/fail/reason + JSON snapshot (RLS: platform admin read) |
| `quota_increase_requests` | Admin form drafts / submitted / done (RLS: platform admin ALL). **No** auto Azure/AWS ticket API in v1. |

Migration: `supabase/migrations/20260917_cloud_quotas_admin.sql`.

## Edge function

- Name: `cloud-quotas` (`verify_jwt = false`, admin-checked in function)
- Actions: `{ action: "status" }` · `{ action: "sync", provider: "azure"|"aws" }`

Existing `azure-quota` (Index widget, eastus + centralindia) is unchanged.

## Gaps to document in PR

1. AWS Service Quotas (EC2 On-Demand / elastic IPs) not connected.  
2. Azure sync covers a curated region list (not every subscription location), but **all** `*Family` quotas within those regions are retained.  
3. Quota increase requests are Hub-only records — Ops files the cloud ticket manually.  
4. Public IP metric omitted for a region when Network usages call fails (Compute still used).
