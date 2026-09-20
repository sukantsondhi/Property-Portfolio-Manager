# Property Portfolio Manager agent guidance

## Fast repository brief

Property Portfolio Manager is an open source, self-hosted, invitation-only web application for managing UK rental properties, tenants, rent, expenses, compliance, documents, rental-year history and organisation access. The source can be public while each deployed instance keeps Microsoft-account-only access to confidential portfolio data. The product goal is a clear property-manager workflow with reliable finance figures, recoverable mistakes, immutable closed history and no confidential data or privileged capability exposed to the browser.

The security boundary is the Azure Functions API, never React. Every portfolio request must resolve an invited Microsoft identity, authorise membership or approved super-admin access to one selected organisation, and read/write only that organisation's Cosmos partition.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/web` | React 19/Vite UI. Treat as an untrusted client. |
| `src/web/src/context/PortfolioContext.tsx` | Loads organisation-scoped records and exposes shared mutation helpers. |
| `src/web/src/lib/api.ts` | Only supported browser-to-API request path; attaches the selected organisation ID. |
| `src/web/src/pages/PropertyDetailPage.tsx` | Main property, tenancy, tenant, compliance, document and rental-year workspace. |
| `src/web/src/pages/FinancePage.tsx` | Read-only finance reporting by property/year. |
| `src/web/src/lib/finance.ts` | Browser presentation copy of the tested tenant/month rent-ledger rules. Keep aligned with the API implementation. |
| `src/api` | Azure Functions v4 API and the authoritative security/data rules. |
| `src/api/src/services/auth.ts` | Microsoft principal parsing and organisation authorisation entry point. |
| `src/api/src/services/directory.ts` | Platform invitations, users, organisations, memberships, roles and security audit metadata. |
| `src/api/src/services/store.ts` | Organisation-scoped Cosmos persistence, relationships, optimistic concurrency, archive/delete, rent guards and rental-year lifecycle. |
| `src/api/src/services/finance.ts` | Authoritative dashboard and tenant/month rent-ledger calculations. |
| `src/api/src/functions/records.ts` | Validated generic record routes plus protected advance-rent workflows. |
| `src/api/src/functions/rentalYears.ts` | Rollover, backup email and restored-history lifecycle routes. |
| `src/api/src/functions/documents.ts` / `services/blobs.ts` | Bounded API uploads, actor-bound reservations, create-only Blob writes and short-lived read access. |
| `src/api/src/services/reminders.ts` | Compliance and rent-collection selection plus server-side email templates. |
| `infra` | Existing Bicep architecture. Changes require an explicit cost/security review. |
| `.codex` | Optional ignored local maintainer handoff and launchers; public guidance is in `docs`. |
| `docs` | Developer, administrator, user, operations, deployment, security and testing documentation. |

Read the nearest nested `AGENTS.md` before changing `src/api` or `src/web`.

## Core data and workflow connections

- Cosmos uses one `records` container partitioned by `/organizationId`. `_platform` is reserved for directory, invitations, membership, reminder-delivery hashes and audit metadata. Never perform an unpartitioned portfolio query.
- All portfolio children retain explicit relationships: `propertyId`, optional `tenantId`/`tenantIds`, optional `tenancyId`, and `rentalYearId`. Validate that every linked record belongs to the same property, rental year and authorised organisation.
- Money is integer pence. Dates are ISO dates and rent belongs to explicit `appliesToMonth` (`YYYY-MM`), falling back to `paidDate`/`dueDate` only for old records.
- A rent liability exists once per tenant/month, not once per payment row. Partial, Late and Adjusted instalments are additive receipts against that single liability. Paid is a singleton; linked In advance allocations settle their respective months. A Waived entry reduces that tenant/month's expected amount to rent actually retained. Never let an overpayment or a future allocation offset another tenant/month's arrears.
- The authoritative finance implementation is `src/api/src/services/finance.ts`; `src/web/src/lib/finance.ts` mirrors it for immediate UI reporting. Any finance-rule change must update both plus parity regression tests. Verify pence arithmetic, month attribution, instalment deduplication, waiver behaviour, future advances, tenant agreement dates, archived records and closed/restored-year filtering.
- Current operational records link to a `current` rental year. Rollover closes the outgoing year, stores `propertySnapshot`, links outgoing records and copies compliance evidence while leaving the live compliance record unscoped for future renewal reminders.
- Closed years are read-only. One closed year per property may enter `restored` correction state under the lifecycle guard; it must return to closed History before another restore or rollover. Never edit the live property when correcting a historical snapshot.
- Ordinary records use `_etag` optimistic concurrency. Current-year child writes include the year ETag in their Cosmos batch; restored-year lifecycle guards and rent month guards remain atomic. An organisation mutation guard coordinates quota reservations and deletion fences. Conditional deletes retain pending Blob cleanup metadata until acknowledged.
- Directory identity and membership changes use a conditional `_platform` transaction guard. First acceptance cannot create duplicate users; revocation covers legacy duplicate identity rows. Never put email/Blob side effects inside a retryable transaction callback.
- Blob keys are server-generated under `org/{organizationId}/{propertyId}/...`. Upload bytes pass through the authorised API with a hard 25 MiB streamed limit, timeout, actor-bound reservation and create-only Blob write. No browser write SAS is issued; old upload-URL/completion routes return 410. Reads use short-lived read-only SAS URLs. Quotas are 5 GiB/5,000 documents per organisation and three outstanding uploads per actor; failed cleanup remains accounted for.
- The existing daily reminder workflow handles live compliance and rent-collection email. Closed compliance snapshots never send reminders. Atomic delivery claims prevent overlapping sends; confirmed failures can retry, ambiguous outcomes remain suppressed for review. Delivery records contain hashes and minimal metadata, never email bodies, tenant notes or document content.
- Owner, Editor and Super admin views differ for UX, but the API enforces all roles. Super admins have the product-owner-approved owner-equivalent access to active organisations while remaining actor-attributed and partition-scoped.

## Product invariants

- This is a private, invitation-only application for Microsoft accounts. Do not weaken the platform invitation check, organisation membership check, or Microsoft-only identity requirement.
- Treat property, tenant, financial, compliance, and document data as confidential. Never log personal records, authentication headers, connection strings, access keys, SAS URLs, email bodies, or document contents.
- Never place secrets, service credentials, privileged APIs, or durable Blob URLs in `src/web`. Browser code may receive only short-lived, least-privilege URLs from an authorised API request.
- Keep every portfolio read and write scoped to the authorised `organizationId`. Cosmos records must retain that partition key, and Blob names must remain under the matching organisation prefix.
- Preserve optimistic concurrency for edits/deletes and read-only behaviour for closed rental years.
- The deployment is intentionally constrained to the Bicep-declared Azure architecture. Static Web Apps Free and Cosmos free tier have limits; Blob, ACS Email and some monitoring usage are metered. Do not add an Azure resource, third-party service, paid SKU, dependency, or background workload without explicit approval and a documented cost/security review.
- The product owner explicitly approved owner-equivalent access to every active organisation for super admins. Preserve the platform-admin check, organisation partition scope, actor attribution, destructive-action confirmations and directory audit events; never turn this into anonymous or front-end-only authorization.

## Working agreements

- Read `docs/architecture.md`, `docs/security-privacy.md` and `docs/testing.md` before material changes. Maintainers with a local `.codex` handoff should also read and update it when architecture, contracts or important findings change.
- Preserve unrelated working-tree changes. Keep `.azure` environments, `.codex` private handoff files, `.vscode` settings and `LOCAL_SECURITY_FINDINGS.md` out of a public commit.
- Use Node.js 22+. On Windows, invoke npm as `npm.cmd` when PowerShell execution policy blocks `npm.ps1`.
- Run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build` after code changes. If sandbox policy blocks Vitest/esbuild traversal, rerun the same bounded command with approval rather than weakening the tests.
- Validate all client input in the API with Zod. UI validation is additional UX, never the security boundary.
- Prefer backward-compatible record evolution because Cosmos contains schemaless production records created by older releases.
- Use UK English in user-facing copy and GBP/pence for stored money.

## Required session continuity

At the start of every material session:

1. Read this file, the nearest nested `AGENTS.md`, and the architecture, security and testing docs. Read optional local `.codex` context if present.
2. Confirm the requested branch, clean/dirty worktree state and current `origin` state before switching or editing.
3. Trace the existing API, persistence and UI paths before changing a cross-cutting rule; do not repair only the visible component.

Before ending every material session, update the durable context:

1. Update the **Current handoff** below with the date, branch, important finding/decision, verification state, unfinished work and a concrete warning about what not to regress.
2. Update optional local `.codex` progress/data-layout/test-evidence files if present. Record commands actually run and do not claim unavailable hosted/email checks passed.
3. Update this file's stable sections whenever architecture, security, finance or workflow invariants change. Keep the handoff concise by replacing stale session details rather than accumulating an unbounded diary.
4. Record safe future work explicitly. Never record credentials, personal/customer records, auth headers, SAS URLs, email bodies or production document contents.

## Current handoff (update every material session)

- Publication preparation: 2026-09-21 on `main`. The owner approved committing and pushing the reviewed fixes without a PR, and replacing the unpublished application's personal commit email with the GitHub no-reply identity. The metadata-only rewrite produced `092eeed` with an identical file tree; the remote was still README-only `889c11583ff16ea88c23e3eef01390ef8f95cb8d` before publication. GitHub Actions deployment/reminder opt-in variables were absent. Do not enable them on this source repository. No live probing or Azure changes were authorised; earlier hosted-release/security-setting claims remain unverified.
- Implemented: atomic directory acceptance/revocation and owner checks; bounded API uploads with no browser write grants, actor-bound reservations and quotas; same-year relationship checks, current-year close guards, conditional deletion fences and durable Blob cleanup; atomic reminder claims with uncertain-send suppression. Production rejects local auth/memory storage. Setup refuses an existing resource group. No resource, dependency, paid SKU or background workload was added.
- Verification: `npm.cmd ci` completed with zero reported vulnerabilities. Final `npm.cmd run typecheck`, `npm.cmd test` (23 files / 132 tests: 26 web and 106 API), and `npm.cmd run build` passed. Focused regression tests, setup PowerShell parsing and `git diff --check` passed. Editor diagnostics report existing workflow-variable and Markdown table-spacing warnings, not TypeScript errors. Infrastructure and dependency manifests/lockfiles were unchanged. No emulator smoke run, live sign-in, Cosmos/Blob/ACS operation, deployment or billing checks have run.
- Upgrade warning: API and web must deploy together; refresh old clients. Previously issued write SAS URLs remain valid until expiry or an operator rotates their key. Legacy orphan blobs and previously duplicated directory records require private operational review; removal now revokes duplicate identities. Do not claim local code changes revoked old grants or repaired hosted data.
- Preserve: invitation-only Microsoft access, organisation partition scope, super-admin attribution, no PR deployment secrets, no untrusted-origin principal headers, conditional Cosmos guards, no deletion of registered blobs through upload validation, and no automatic retry of uncertain email sends. Safe follow-up: controlled deployed acceptance including managed-API upload size/time limits, Cosmos RU contention, failure recovery and ACS claim reconciliation. Per-organisation quotas are not a subscription spending cap; no live security posture or compromise is verified.

## Code review rules

- Flag any client-side secret, unscoped Cosmos query, public Blob access, long-lived SAS, missing membership authorization, cross-property relationship, HTML/email injection, or mutation of historical records.
- Flag any infrastructure change that can introduce a paid SKU or bypass the existing private/invite-only model.
- For finance changes, verify month attribution, pence arithmetic, archived/closed-year filtering, and no double counting.
- For destructive actions, require server-side role checks and explicit confirmation; UI hiding alone is insufficient.
