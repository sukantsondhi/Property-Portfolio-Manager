# Architecture

## Request flow

1. Static Web Apps redirects the visitor to the preconfigured Microsoft provider.
2. The API parses the trusted `x-ms-client-principal` header supplied by Static Web Apps.
3. The directory service checks the immutable provider user ID against an active platform user. On first access it may bind an unexpired email invitation to that ID.
4. The organisation selector lists active memberships; a super admin sees every active organisation with owner-equivalent access.
5. Portfolio requests carry `x-organization-id`. The API verifies membership or super-admin status before constructing an organisation-scoped record store.
6. Cosmos reads and queries include the same `organizationId` partition key.

Uninvited accounts can complete Microsoft authentication because this is a limitation of preconfigured authentication on Static Web Apps Free. They cannot pass the API invitation check and receive no organisation data.

## Azure resources

| Component | Resource | Region/SKU |
|---|---|---|
| React and managed API | Static Web Apps | Deployer-selected web region (example: West Europe), Free |
| Records and directory | Cosmos DB for NoSQL | Deployer-selected data region (example: UK South), 400 RU/s, free-tier account |
| Documents | StorageV2 Blob | Same data region, Standard LRS, private container |
| Reminder, invitation and rental-year backup email delivery | Communication Services + Email | Europe data location |
| Capacity notification | Azure Monitor action group + metric alert | Global |

## Directory records

Directory records use the reserved `_platform` partition:

- `platformUser`: active user and immutable provider user ID.
- `platformInvitation`: maintainer approval, email, status and expiry.
- `organization`: organisation name and lifecycle state.
- `organizationMembership`: user, organisation and owner/editor role.
- `organizationInvitation`: owner-issued sharing request.
- `reminderDelivery`: SHA-256 delivery key for deduplication.
- `auditEvent`: security-sensitive activity metadata.

Portfolio records use their organisation UUID as the partition key. These include property, tenant, guarantor, reference, tenancy, rent payment, expense, compliance, document and rental year.

## Roles

- Super administrator: creates/removes platform access, grants/revokes persisted super-admin access and receives owner-equivalent access to every active organisation. Bootstrap admins remain in secure server configuration.
- Organisation owner: manages all portfolio records and organisation access.
- Organisation editor: manages portfolio records but cannot change membership.

Permanent archive deletion and organisation deletion require resolved owner-equivalent authorization. The final explicit organisation owner cannot be removed. Super-admin organisation access is server-side, partition-scoped and actor-attributed; it never exposes a global unpartitioned record query.

## Invitation email model

Creating or refreshing a pending platform invitation sends a platform sign-in email to the normalized invited address. The person must accept platform access before an organisation owner can add them. Adding the accepted account sends the organisation name, role and Microsoft sign-in URL. Existing membership does not create a duplicate.

## Organisation deletion model

Organisation deletion requires owner-equivalent authorization plus an exact server-validated name confirmation. The record store removes the entire organisation partition, document blobs are deleted from the private container, all memberships and invitations are revoked, and the directory organisation is marked deleted with an audit event. Former members receive a deletion notification. Other organisations and platform accounts are unaffected.

## Reminder model

Compliance records store one to three unique offsets from 0–365 days. New records default to `[30, 7, 1]`. The scheduler checks exact offsets once daily, sends separate messages per organisation/recipient and records a hashed delivery key composed from organisation, record, date, offset and recipient.

The live compliance record is also checked on its expiry date. Every year-linked compliance snapshot is excluded, so rollover preserves evidence without duplicate renewal emails.

Properties store `rentCollectionDay` from 1–31. The same daily scheduler reports the current month's tenant status on that day (clamped to the month's final day), every seven days while unsettled, and once on completion. Its per-recipient key contains organisation, property, month and stage. Only minimal delivery metadata is retained; message bodies and tenant notes are not copied to the platform partition.

## Document model

Blob keys use `org/{organizationId}/{propertyId}/{category}/{documentId}/{filename}`. Blob containers are private. Upload and download URLs require membership or super-admin authorization and expire after ten minutes. Upload completion recomputes the expected key, requires exact size/MIME/extension agreement and checks PDF/JPEG/PNG/WebP/Office signatures before creating metadata; rejected blobs are removed. Normal downloads are forced as attachments; approved property images use inline read-only URLs. Property records store only `imageDocumentId`, never a SAS URL.

## Detailed Cosmos layout

The single `records` container is partitioned by `/organizationId`. `_platform` holds `platformUser`, `platformInvitation`, `organization`, `organizationMembership`, `organizationInvitation`, `reminderDelivery` and `auditEvent`. Each organisation UUID owns its `property`, `rentalYear`, `tenant`, `guarantor`, `reference`, legacy `tenancy`, `rentPayment`, `expense`, `compliance` and `document` records.

```text
property
|- rentalYear (closed years contain the outgoing propertySnapshot)
|- tenant -> guarantor/reference
|- rentPayment (tenantId, appliesToMonth)
|- expense
|- compliance (live record plus year-linked rollover snapshots)
`- document -> private Blob key
```

All records carry UUID `id`, `organizationId`, `kind`, `archived`, audit timestamps/actors, `version` and `_etag`. Money is integer pence. Rent month is `YYYY-MM`; older payments fall back to the month in `paidDate` or `dueDate`. Expected rent is one liability per applicable tenant/month, while multiple instalment records are additive receipts against that liability. Waivers remove only the uncollected part, and arrears are calculated per tenant/month so an overpayment or future advance cannot hide another outstanding month. Rollover closes the current year, stores an immutable property-field snapshot, links year-scoped records, copies a compliance snapshot, and prevents later editing or archiving.

A closed year can be explicitly changed to `restored` for correction and saved back to `closed`. The actual current year remains current, only one restored year is allowed per property, and further rollover is blocked during the correction session. Every record mutation remains organisation-scoped and uses existing optimistic concurrency.

## Rental-year email backup

When an owner starts the next rental year, the API sends each active owner a separate structured summary of the outgoing property, rental year, tenants, guarantors, references, agreements, rent, expenses, compliance, document metadata and audit fields. Files are attached while the raw total stays under 6 MiB, leaving room under the provider's 10 MB request limit. Every document remains listed, and an authenticated organisation/history link covers files that are too large or temporarily unavailable. The link is not a bearer SAS and still requires Microsoft sign-in and current Owner or Super admin access.
