# Security policy

Property Portfolio Manager manages confidential property and tenant records. **Do not open a public issue for a suspected vulnerability.** Use GitHub’s **Report a vulnerability** private advisory flow for this repository, or contact the repository owner privately through an address listed on their GitHub profile if that flow is unavailable. Do not attach production documents, keys, SAS URLs, authentication headers, email bodies or personal records. Include the affected component, safe reproduction steps, impact and whether you have observed exposure.

The maintainer should acknowledge a report, contain access, rotate any exposed credential, preserve privacy-safe evidence, reproduce the issue with synthetic data, fix and test it, then publish an advisory when appropriate. Please avoid accessing another user’s data, destructive testing and denial-of-service tests against a live deployment.

## Supported versions

Only the latest `main` source is maintained. Individual self-hosted operators are responsible for applying updates, rotating their secrets and monitoring their Azure deployment. No hosted service or response-time guarantee is provided by this repository.

## Security model and limits

- Static Web Apps handles Microsoft sign-in, then the Azure Functions API checks platform invitation and organisation membership for every portfolio request. Super admins are server-recognised and actor-attributed.
- Cosmos records use `/organizationId` partitions. Azure Blob containers are private; authorised short-lived SAS URLs are issued by the API.
- The reminder scheduler route accepts an API key from GitHub Actions. Keep that key and the Static Web Apps deployment token in GitHub Secrets, never in source or a URL.
- Static Web Apps Free and the current Azure architecture have no private endpoints or malware scanning. Document uploads undergo format/signature checks, which do not prove files are safe. See [security and privacy](docs/security-privacy.md).
- A public source repository does **not** make a deployed instance public. Test Microsoft redirect, invitation, membership, Blob and email boundaries in your own Azure environment after deployment.
