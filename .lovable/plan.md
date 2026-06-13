## Goal
Add an access-control + org-scoping + content-library layer to SkillTrack-365 Labs so admins can manage certifications, mock exams, a question bank, gated resources, manual access grants, and orgs — without any payment/Stripe code.

Because none of this exists yet, I'll deliver it in **5 reviewable batches**. You approve each batch before I start the next. Below is the full scope; today (after approval) I begin **Batch A** only.

---

## Batch A — Foundation: schema, roles, access engine

**New DB objects (one migration):**
- enum extension: add `super_admin`, `content_admin`, `org_exec`, `org_manager` to `app_role`
- `organizations` (name, slug, created_by)
- `org_members` (org_id, user_id, role: exec|manager|member)
- `resources` (title, description, kind, storage_path, external_url, published, org_id, required_role, required_plan, downloads_enabled)
- `certifications_catalog` (slug, name, description, org_id, published)
- `mock_exams` (cert_slug, title, duration_min, org_id, published)
- `question_bank` (mock_exam_id, prompt, choices jsonb, answer, org_id)
- `access_rules` (asset_type, asset_id, required_role, required_plan, active)
- `manual_access_grants` (user_id, asset_type, asset_id, certification_slug, plan_key, starts_at, ends_at, active, granted_by)
- `subscriptions` (stub table for Batch 4 future — empty, RLS-locked)
- Security-definer helpers: `is_super_admin(uuid)`, `is_org_member(uuid, uuid)`, `is_org_role(uuid, uuid, text)`, `resolve_caller_org_id()`
- RLS + GRANTs on every new table
- Private storage bucket `resources` + RLS

**New lib files:**
- `src/lib/access-control.functions.ts` — `checkAssetAccess`, `requestResourceAccess`, `requestMockExamLaunch`
- `src/lib/admin-content.functions.ts` — cert + mock exam CRUD with org_id
- `src/lib/question-bank.functions.ts` — list/upsert/import questions with org_id
- `src/lib/manual-grants.functions.ts`

Access engine rules:
- admin / super_admin / content_admin → bypass
- role rule → pass via `user_roles` / `org_members`
- plan rule → pass via active `manual_access_grants` (subscriptions wired but inert until Batch 4)

---

## Batch B — Admin UI for content + orgs
- `/admin/organizations`
- `/admin/certifications`
- `/admin/mock-exams`
- `/admin/question-bank` (with CSV import, org filter, global/org selector)
- Org scope column + filter everywhere
- Non-super org users default to their org; global option hidden

## Batch C — Access rules + manual grants admin
- `/admin/access` — list/create/edit `access_rules`, grant manual access
- Resource admin page `/admin/resources` with explicit admin preview function

## Batch D — Learner enforcement wiring
- Resource open/download → `requestResourceAccess` only (no direct signed URLs in learner UI)
- Mock exam launch button → `requestMockExamLaunch` gate
- Friendly blocked toasts: requires plan / downloads disabled / not published / forbidden
- Hide storage paths from learner UI

## Batch E — Reports/subscribers MVP + cleanup + tests
- `/admin/reports` MVP cards (learners, certs, mock exams, grants) + CSV export
- `/admin/subscribers` MVP (manual grants view, "Stripe pending" note)
- Footer dead-link cleanup, mojibake fix in touched files
- Deno tests for `requestResourceAccess`, `requestMockExamLaunch`, manual grant pass, org isolation, question-bank org filter

---

## Out of scope (explicit)
- Stripe / Paddle / payments / invoices — Batch 4 in your spec, intentionally skipped
- Migrating any existing lab/VM tables — left untouched
- TanStack Start migration — staying on Vite + React Router
- `.lovable/plan.md` — file doesn't exist here, will skip

## Technical notes
- Reuses existing `RoleProtectedRoute`, `DashboardLayout`, `EmptyState`, design tokens
- New routes added to `src/App.tsx`
- All new public-schema tables get `GRANT` + RLS + policies in same migration
- `subscriptions` table created locked so Batch 4 only flips logic, not schema

## Today's deliverable if approved
Only **Batch A**: the migration + the 4 lib files + helper RLS functions. No UI yet. You'll review the migration before it runs. After Batch A is green, I start Batch B.

**Ack with "go" and I'll fire Batch A.**