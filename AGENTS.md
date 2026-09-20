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
| `src/api/src/functions/documents.ts` / `services/blobs.ts` | Private upload completion, signature validation and short-lived authorised access. |
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
- Ordinary records use `_etag` optimistic concurrency. Rent month guards and restored-year lifecycle guards must remain atomic with their protected Cosmos writes.
- Blob keys are server-generated under `org/{organizationId}/{propertyId}/...`. The container is private. The browser receives only short-lived, least-privilege upload/read URLs after an authorised request and never stores durable SAS URLs.
- The existing daily reminder workflow handles live compliance and rent-collection email. Closed compliance snapshots never send reminders. Delivery records contain hashes and minimal metadata, never email bodies, tenant notes or document content.
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

- Last updated: 2026-09-20 for public `main`; initial public release commit `796b94f` was pushed with the GitHub no-reply author identity, and opt-in workflow fix PR #1 was squash-merged as `8623f5b`. Redundant handoff/PR branches were removed locally and remotely; only `main` remains.
- Decision: the public project is Property Portfolio Manager. Deployment prompts for the bootstrap Microsoft super admin and requires the deployer's own subscription, hostnames and ACS domain. The README now provides a workflow-led feature tour, role matrix, architecture summary, contribution path and eight referenced synthetic screenshots, including genuine Editor and super-admin views. Prior personal deployment defaults and public docs were removed; private handoff and deployment files are ignored.
- Security finding: pull requests now validate without deployment tokens; the API requires an explicit Microsoft identity provider; unknown exceptions log only their class; ACS reminder sends reject failed status. The separate ignored `LOCAL_SECURITY_FINDINGS.md` is for backporting to the original private project.
- Verification: patched Vitest 4.1.11 and all three lockfiles; online npm audit returned zero vulnerabilities; 22 Vitest files / 101 tests, typecheck, production build, Bicep build and lint passed. The local 67-check synthetic smoke suite passed while preparing the expanded README. All nine synthetic UI screenshots were visually inspected; the README references eight valid 1440×900 PNGs, all 29 relative links resolve, `git diff --check` passes and editor diagnostics report no Markdown errors. GitHub `validate` passed on both the opt-in PR and merged `main`. Real Azure sign-in, ACS delivery, DNS and billing were not exercised.
- GitHub security: public repository has secret scanning, push protection, Dependabot alerts/security updates, private vulnerability reporting, and `main` protection requiring a passing `validate` check and PR. The source repo has no Actions secrets; its deploy and reminder workflows are disabled. The initial push triggered a deploy failure at the final deploy step because the template workflow was not opt-in.
- Template behaviour: deployment and reminder jobs now require `AZURE_DEPLOY_ENABLED=true` and `REMINDERS_ENABLED=true` respectively, with updated setup/troubleshooting docs. Each adopter supplies their own Azure secrets and enables the matching workflow after provisioning. Keep the source workflows disabled; this repository is for others to copy, while the owner already has a separate private deployment. Avoid reintroducing automatic source-repo deployment, personal admin defaults, PR secret exposure, cross-organisation data access, incorrect rent/email semantics or raw exception logging.

## Code review rules

- Flag any client-side secret, unscoped Cosmos query, public Blob access, long-lived SAS, missing membership authorization, cross-property relationship, HTML/email injection, or mutation of historical records.
- Flag any infrastructure change that can introduce a paid SKU or bypass the existing private/invite-only model.
- For finance changes, verify month attribution, pence arithmetic, archived/closed-year filtering, and no double counting.
- For destructive actions, require server-side role checks and explicit confirmation; UI hiding alone is insufficient.
