# Azure services and costs

The Bicep in `infra/` deploys these resources. The figures below are a guide checked against Microsoft documentation on 20 September 2026. **Check your region, currency, offer and current [Azure pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) before provisioning.** A free allowance on one resource does not make the whole deployment free.

| Service | Used for | Cost model and limits |
|---|---|---|
| [Azure Static Web Apps Free](https://learn.microsoft.com/en-us/azure/static-web-apps/plans) with managed Azure Functions | Hosts React and the HTTP API; provides Microsoft sign-in. | Free plan selected by Bicep. Includes managed HTTP API, custom domains and managed TLS, subject to Free plan quotas; no SLA or private endpoint. No separate Functions app is provisioned. |
| [Cosmos DB for NoSQL free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier) | Directory and organisation records in a single partitioned container. | **One free-tier account per Azure subscription**, enabled only at creation. First **1,000 RU/s and 25 GB** are free for the life of that account. This app provisions 400 RU/s. Excess throughput/storage and some optional features are billable. Use a subscription without an existing free-tier account or create a new subscription. |
| [Azure Blob Storage](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/) | Private documents and property pictures; Standard LRS Hot tier. | Pay for stored data, operations and applicable transfer. The app has a **5 GiB alert threshold**, which is an application alert, not a free Storage allowance. Blob/container soft delete keeps recoverable copies for seven days and may use capacity. |
| [Azure Communication Services Email](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing) plus Email Communication Service | Invitations, compliance/rent reminders, deletion notices and rental-year backups. | **Not free.** Pay per recipient message **and** per MB transferred, including attachments. Microsoft’s illustrative rates are **US$0.00025 per email to a recipient + US$0.00012 per MB**. Actual rates vary; check the [live ACS pricing page](https://azure.microsoft.com/en-us/pricing/details/communication-services/) and your invoice. A 1 MiB backup to 10 owners is roughly 10 message charges plus about 10 MiB transfer at those example rates. |
| [Azure Monitor metric alert](https://azure.microsoft.com/en-us/pricing/details/monitor/) and action group | Emails the maintainer when Storage used capacity crosses 5 GiB. | Metric alert rules and some notifications may be metered; do not assume the alert is free. The Bicep creates one rule and one email action group. |
| [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | CI, deployment and daily reminder request. | Standard GitHub-hosted runners are free for public repositories under current GitHub policy. Private repositories have quotas; larger runners and some storage can be charged. |
| Your DNS registrar/provider | Website and verified email domain. | Domain registration and optional DNS services depend on your provider and are separate from Azure. |

The code uses server-side Cosmos and Storage account keys because managed Static Web Apps functions do not provide general managed identity access to these data services in this architecture. These keys are application settings, never browser settings. [Managed API constraints](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions). An architecture change to a separate Functions app, Key Vault or private endpoints can add cost and requires a security review.

## Cost checks after deployment

1. In Azure Portal, open **Subscriptions → your subscription → Cost Management → Cost analysis** and inspect daily spend by resource.
2. Set a subscription budget before inviting users. Budget alerts notify you but do not cap charges. [Azure budget instructions](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).
3. In Cosmos, confirm **Free Tier Discount: Applied** and that the `records` container is 400 RU/s.
4. In Storage, watch used capacity and transaction counts; large rental-year backups also increase ACS transfer.
5. In ACS, review message volume and failed sends. The daily workflow only sends due messages, but invitations and backups can add to usage.
