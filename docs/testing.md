# Testing and acceptance

## Automated commands

```powershell
npm.cmd ci
npm.cmd audit --audit-level=moderate
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
az bicep build --file infra/main.bicep
az bicep lint --file infra/main.bicep
```

The API tests cover Microsoft identity parsing and immutable identity binding, invitation isolation, roles, schemas, finance, reminders, restored years, document checks and store lifecycle. UI tests cover formatting, navigation, archive, tenancy and historical editing. `npm.cmd run smoke:local` exercises the local Functions API and Azurite with synthetic records and files. Start both local services first; it does not use Azure.

Security regressions include concurrent invitation acceptance/revocation and last-owner removal, conditional Cosmos directory/store batches, closed-year write races, stale deletes and cleanup retries, cross-year relationships, actor-bound upload finalisation, bounded request bodies, create-only Blob writes, capacity reservation races, revoked upload access and concurrent/uncertain reminder delivery. SDK effects are mocked in unit tests; those tests do not establish live Azure behaviour. The smoke script refuses non-loopback API URLs.

For manual local testing on Windows, copy `src/api/local.settings.example.json` to ignored `src/api/local.settings.json`, then use three terminals from the repository root:

```powershell
# Terminal 1: local Azurite only. This is a public dummy account, never an Azure key.
$env:AZURITE_ACCOUNTS = 'localdev:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
npx.cmd --yes azurite@3.36.0 --silent --location .azurite
```

```powershell
# Terminal 2: Azure Functions Core Tools 4
Set-Location src/api
func start
```

```powershell
# Terminal 3: React/Vite
npm.cmd run dev
```

Vite serves `http://localhost:5173` and proxies `/api` to Functions at `http://localhost:7071`. `LOCAL_AUTH=true` and the public Azurite key are **local-only**; never set them in Azure. On macOS/Linux, use the equivalent environment variable and [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) commands, `func start`, and `npm run dev`.

## Live acceptance checklist

- Uninvited Microsoft account sees Invitation required and no data.
- Platform admin can create and revoke an invitation.
- Platform and organisation invitation actions send the correct branded email and sign-in destination.
- Platform and organisation registers show one status row per email and repeated invitation attempts do not create duplicate active invitations.
- Invited user can create an organisation.
- Owner can share an organisation with another invited user.
- Shared user sees the organisation in the selector after a new session.
- Editor cannot open owner-only member management actions.
- Only an owner or super admin can permanently delete an organisation, and exact-name confirmation removes its records, blobs and memberships without affecting other organisations.
- User with two organisations sees different records/totals in each.
- Guessed organisation/property/document IDs do not expose data or SAS URLs.
- Property, tenant, tenancy, guarantor, reference, rent, expense and compliance CRUD works.
- Rental-year rollover moves old year-linked records into History.
- Archive, restore and confirmed permanent delete work.
- Compliance offset validation rejects duplicates and accepts one to three values.
- Manual reminder run sends separate organisation emails once only.
- Property pictures, compliance files and general documents upload through `POST /api/documents/upload`; unsupported MIME types, spoofed signatures and oversized bodies are rejected before a Blob write. The browser receives no write SAS; authorised read URLs still work.
- Confirm 25 MiB uploads fit the deployed managed API's request/time limits; slower uploads fail safely, and archived failed reservations can be cleaned up. Verify per-organisation quota and pending-upload rejection with synthetic records.
- Verify old upload-URL/completion routes return 410 without modifying an existing document, and refreshing the web client uses the new API.
- Closed rental years show immutable property, tenant, guarantor, reference, tenancy, finance, compliance and document snapshots; historical documents remain downloadable.
- Starting a new rental year sends each active owner a separate structured backup email and uses the secure history link for files that cannot be attached.
- Your custom website hostname has valid TLS and security headers.
- SPF, DKIM, DKIM2 and DMARC resolve correctly.

Record evidence without screenshots containing personal data or secrets.
