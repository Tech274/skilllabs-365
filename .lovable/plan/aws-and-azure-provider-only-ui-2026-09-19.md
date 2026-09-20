# AWS and Azure provider-only UI

## Scope
- Keep existing backend adapters, routes, stored records, and provider types unchanged.
- Make AWS and Azure the only providers admins can choose when creating Resource Provider accounts or Cloud Access templates.
- Remove unsupported providers from launch-facing/provider pickers and “coming soon” first-class choices.
- Preserve existing historical data and reporting; unsupported-provider records may remain readable where already stored, but cannot be newly selected or launched.

## Changes
- Add a shared frontend list of active providers containing only AWS and Azure, while retaining the full provider metadata map for compatibility with existing records.
- Update Resource Providers to offer only AWS and Azure when adding accounts and show only their active account groups in the main provider view.
- Update Cloud Access Catalogue creation and filtering to AWS/Azure only, and adjust empty-state wording.
- Update other editable cloud selectors and picker-style filters that currently expose GCP or unsupported providers, including credential/readiness and budget controls where they act as cloud choices.
- Leave Cloud Quotas unchanged where it already supports only AWS and Azure.
- Do not alter backend provider constants, routes, database types, `types.ts`, WhatsApp content, or publishing state.

## Verification
- Run the TypeScript check and focused tests.
- Open the preview and confirm Resource Providers and Cloud Access provider selectors expose only AWS and Azure.
