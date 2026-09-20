# API-specific guidance

- Every portfolio route must call `authorizeOrganization`; owner-only destructive routes must pass `true`.
- Directory/platform routes must start from `authenticateIdentity` or `authenticatePlatform` and enforce super-admin checks server-side.
- Keep Cosmos queries partition-scoped. `_platform` is reserved for directory, invitation, role, delivery-deduplication, and audit records.
- Store currency as integer pence and dates as ISO `YYYY-MM-DD` (or timestamps for audit fields).
- Blob operations must use server-generated organisation-prefixed names and short-lived SAS permissions. Never accept an arbitrary blob key from the browser without recomputing and comparing it.
- Do not expose secrets or sensitive values through responses, errors, or logs.
- Add or update Vitest coverage for schemas, authorization, relationship checks, finance calculations, and email generation.
- `src/services/finance.ts` is the authoritative tenant/month ledger. Expected rent is one liability per tenant/month; never sum `amountDuePence` per instalment row or offset one tenant's arrears with another tenant's overpayment/future advance. Keep the web mirror and parity tests aligned.
