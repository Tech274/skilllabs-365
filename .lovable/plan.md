
# Public-Cloud Access Template System

This is a large feature — it cannot land in one batch. I will deliver it in 7 phases, each shippable on its own. Before I start, I need 4 decisions.

## Open questions (please answer before I build)

1. **Coexist or replace?** The current project ships VM-based labs (Azure VMs + Guacamole). Should this new "cloud access" system live **alongside** VM labs (separate routes/menus, separate admin pages) — or **replace** them?
2. **Provider scope for v1.** Which providers do I implement end-to-end now? Recommended: **AWS (STS federation URL) + Azure (time-boxed RBAC role assignment on a scoped RG/subscription)**, GCP shown as "coming soon".
3. **AWS prerequisites.** For AWS STS federation I will need: an AWS account (or per-tenant accounts), an `AccessTemplateRole` IAM role per template with the allowed policies, and credentials for an STS-capable identity (access key + secret, or assumed role). OK to add these as Lovable Cloud secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`) when we hit Phase 5?
4. **Azure scoping.** For Azure portal access, the simplest controlled model is: temporarily grant the user's Entra ID object the `Contributor` (or custom) role on a scoped resource group, then revoke on expiry. This requires each user to have an Entra ID `oid` stored on their profile. Do you want me to (a) collect/store `azure_object_id` on profile and use real RBAC, or (b) ship Azure as a stub in v1 and only do AWS for real?

## Phase plan

### Phase 1 — Data model (1 migration)
Tables (all RLS-protected, GRANTed to `authenticated` + `service_role`):
- `access_templates` — name, provider (`azure|aws|gcp`), description, validity_days, credit_limit, session_duration_minutes, region, self_enroll, status (`draft|published|archived`), org_id, created_by, allowed_services (jsonb), provider_config (jsonb: role ARN, subscription, RG, etc.), timestamps.
- `template_batches` — template_id, org_id, name, start_date, end_date, published, credit_allocation, session_duration_override, created_by.
- `template_workspace_batches` — template_id, org_id, name, start_date, end_date, published, shared_credit_pool, workspace_group_id.
- `template_assignments` — template_id, batch_id (nullable), workspace_batch_id (nullable), assignee_type (`user|org|group|self_enroll`), assignee_id, granted_by, granted_at, revoked_at.
- `access_sessions` — user_id, template_id, batch_id, workspace_batch_id, provider, region, started_at, expires_at, status (`created|active|expired|refreshed|revoked|failed|completed`), federated_url (text, encrypted at rest via column comment), provider_session_ref, scope (jsonb), credit_consumed, last_activity_at, refresh_count, parent_session_id (for refresh chains).
- `access_session_events` — session_id, event_type, actor_id, payload (jsonb), at — for audit.
- Helper RPC `user_can_access_template(_user, _template)` — security definer — used by RLS + UI.

Entitlement RLS for `access_templates` SELECT: admin OR `EXISTS(template_assignments WHERE …)` OR `self_enroll AND status='published'`.

### Phase 2 — Admin catalogue + template detail UI
- `/admin/access-catalogue` — provider filter, search, status filter, grid of cards (provider logo, name, batch/lab/workspace-batch counts, validity, credit, **View Template**).
- `/admin/access-templates/new` — create draft.
- `/admin/access-templates/:id` — header (provider logo, name, validity, credit, duration, self-enroll, status, Publish/Archive/Delete), tabs: **Batch**, **Standalone Labs**, **Workspace Batch**, **Workspace Batch Reports**.
- Batch tab: table (Tenant, Batch Name, Lab Count, Start, End, Status, Actions) + Add/Edit/Publish/Delete dialogs.
- Workspace Batch tab: same shape with shared-credit field.
- All actions go through edge functions that re-check admin role server-side.

### Phase 3 — User entitlement + dashboard
- `/labs/cloud-access` — grid of only the templates the current user is entitled to (via the RPC + RLS).
- `/labs/cloud-access/:id` — provider, validity, credit, session duration, region, description, **Generate Link**.
- Empty / unauthorised / unpublished states handled.

### Phase 4 — Session creation flow
- Edge function `cloud-access-session` with actions: `create`, `refresh`, `end`, `status`.
- On `create`: re-verify entitlement, enforce one-active-session-per-user-per-template, write `access_sessions` row with `status='created'`, then call provider adapter, then flip to `active`. All steps logged as session events.
- UI: live countdown, **Connect** (opens federated URL in new tab), **Refresh Credentials** (only when within last 10 min and refresh allowed by policy), **End Session**.
- Refresh validates that the new expiry does not exceed template/batch/workspace validity.

### Phase 5 — Provider abstraction
- `supabase/functions/_shared/cloud-providers/` with `aws.ts`, `azure.ts`, `gcp.ts` and a common `ProviderAdapter` interface (`createSession`, `refreshSession`, `revokeSession`).
- **AWS** (real): `sts:AssumeRole` with template-defined `RoleArn` + session policy scoping region/services, then build the `https://signin.aws.amazon.com/federation` console sign-in URL. Credentials never returned to the browser; only the federated URL is.
- **Azure** (real, conditional on Q4): `az role assignments create` on the scoped RG for the user's Entra `oid` with end-time, return portal deep-link. On revoke: delete the role assignment.
- **GCP**: stub adapter returning `not_implemented`; UI shows "Coming soon".
- Secrets requested via `add_secret` when this phase starts.

### Phase 6 — Cleanup, revoke, expiry
- Extend `cleanup-idle-labs` (or new `cleanup-access-sessions`) cron path:
  - Find `access_sessions` with `expires_at < now()` and `status IN ('active','created')` → call provider `revokeSession` → set `status='expired'`, write event.
  - Find sessions inactive > N min → set `status='expired'`.
  - Detect orphaned provider role assignments (Azure) / orphan federation tokens (AWS rotates naturally) and reconcile.
- Schedule via `pg_cron` (already used in project).

### Phase 7 — Audit + reports
- Reports tab on template detail (batch-wise / workspace-wise usage, sessions generated/expired/refreshed/failed, credit consumed, provider-wise totals).
- Global `/admin/reports/cloud-access` with per-user, per-template, per-batch, per-workspace-batch, per-provider breakdowns.
- All powered by `access_sessions` + `access_session_events`.

## Out of scope for v1 (call out explicitly)
- Real credit/billing integration with cloud providers (we'll track *configured* credit and *consumed estimate*, not live $ spend).
- GCP real provider.
- Per-tenant AWS sub-account provisioning (single AWS account; per-template IAM role does the scoping).
- Encrypted-at-rest secrets inside `access_sessions` — Lovable Cloud columns are at-rest encrypted by Postgres but I will not hand-roll AES on top in v1.

## What I need from you to start

Reply with answers to Q1-Q4. Once you confirm, I will start with **Phase 1 (migration)**, then return for review before Phase 2.
