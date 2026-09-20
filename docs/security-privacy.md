# Security and privacy

## What encryption provides

Cosmos DB and Azure Storage encrypt data at rest using Azure-managed AES-256 keys and use TLS in transit. Storage anonymous Blob access is disabled. These controls protect data on Azure infrastructure and over networks.

They are not end-to-end encryption. The authorised API must read records to display portfolios and create reminders, and the Azure subscription owner has administrative capability. Do not claim that the operator can never access data.

## Tenant isolation

- Platform access requires a platform invitation, except for the deployer-selected bootstrap super admin.
- Organisation access requires an active membership or an explicitly approved super-admin identity.
- Membership or super-admin status is checked for every portfolio API request, which is then scoped to one organisation partition.
- Records are partitioned by organisation UUID.
- Document SAS issuance repeats organisation/document ownership checks.
- Errors avoid revealing whether another organisation's identifier exists.
- Invitation links carry no bearer access token; the exact invited Microsoft identity must still pass API authorization.

## Data minimisation

Collect only information needed to manage the property. Avoid optional dates of birth, identity evidence or financial notes unless genuinely required. Do not log personal fields, document contents, reminder bodies, SAS URLs or authentication headers.

## Privacy commitments to publish before external onboarding

- Controller identity and contact method.
- Processing purposes and lawful bases.
- Categories of property, tenant and account data.
- Azure, GitHub and any DNS provider used by the operator, with their data locations.
- Retention periods, deletion and export procedure.
- No sale, profiling or advertising use.
- Support/admin access procedure and security incident contact.
- UK GDPR rights and complaint route.

The repository documentation is operational guidance, not legal advice. Have the customer-facing privacy notice and terms reviewed appropriately.

Organisation deletion removes active Cosmos portfolio records and known private Blob objects and revokes all organisation access. Azure service backups, diagnostic records and audit metadata may remain for their configured retention periods; customer-facing deletion wording and policy must accurately describe those periods.

## Residual Free-plan limitations

- Static Web Apps Free has no SLA or private endpoints.
- Preconfigured Microsoft authentication lets any Microsoft account reach authentication; API invitations enforce application access.
- The managed API uses service keys held in encrypted Static Web Apps settings because this Free architecture does not provide the desired managed-identity integration.
- Uploads use a private container, server-recomputed keys, exact MIME/extension/format-signature checks, a 25 MiB limit and ten-minute SAS URLs. Rejected signatures are deleted before metadata is created. The free architecture does not include malware scanning; keep files download-only (except allow-listed inline images), train users not to open unexpected files, and review storage growth. Operators should review this residual limitation before enabling uploads for users they do not trust.

For a commercial production tier, evaluate Static Web Apps Standard or a dedicated Function/App Service, managed identity, Key Vault, private endpoints, customer-managed keys, continuous backup and central audit retention.
