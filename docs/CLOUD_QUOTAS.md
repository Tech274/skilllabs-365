# Admin Cloud Quotas

Capacity center under **Admin → Cloud Quotas** (`/admin/cloud-quotas`).

## Scope

| Provider | Sync | Notes |
| --- | --- | --- |
| **Azure** | **Live** | `cloud-quotas` edge function calls ARM Compute + Network location `usages` for curated bankable regions. Home region = **`centralindia`** (Central India — **not** `southindia`). |
| **AWS** | **Live** | Service Quotas `GetServiceQuota` for EC2 On-Demand Standard vCPU (`L-1216C47A`) + Elastic IPs (`L-0263D0A3`), with usage from `DescribeInstances` / `DescribeAddresses`. Credentials come from **Admin → Resource Providers** (active AWS account). Home = **`ap-south-1`**. |
| **GCP** | Out of scope | |

## Capacity math

SKU needs come from the most common `lab_templates.vm_size` among **published** templates. If none exist, Hub assumes:

- VM size: `Standard_B2s` (Azure) / mapped to `t3.small`–`t3.medium` for AWS labsFit
- 2 vCPU
- Family: `standardBSFamily` (Azure) / `onDemandStandardVcpus` (AWS)

Per region, **labs fit** = min of remaining family/On-Demand vCPU ÷ sku vCPU and remaining public IP / Elastic IP (when present).

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

## Gaps

1. AWS sync covers a curated region list (not every opt-in region).
2. AWS usage is estimated from live EC2 inventory (not CloudWatch Utilization widgets).
3. Quota increase requests are Hub-only records — Ops files the cloud ticket manually.
4. IAM on the AWS resource provider needs `servicequotas:GetServiceQuota`, `servicequotas:GetAWSDefaultServiceQuota`, `ec2:Describe*`.
