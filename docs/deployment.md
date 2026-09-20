# Deploy your own instance

This guide creates a **new** Property Portfolio Manager instance in your Azure subscription. It does not migrate an existing portfolio. Complete the steps in order; use synthetic records for the first acceptance checks.

## 1. Create or choose an Azure subscription

1. Sign in at the [Azure portal](https://portal.azure.com/) with the account that will own the Azure bill. New users can [create an Azure account](https://learn.microsoft.com/en-us/dotnet/azure/create-azure-account); existing users can use **Subscriptions → Add** if their billing account permits it. Azure may ask for a payment method, even when some allowances are free.
2. Open **Subscriptions** and note the subscription name and ID privately. You need rights to deploy resources and create Azure Monitor alerts. If an organisation controls billing, ask its Azure administrator for the required access.
3. Open **Azure Cosmos DB** in that subscription and check whether an account already has **free tier enabled**. Microsoft allows **one free-tier Cosmos DB account per subscription**, with the first **1,000 RU/s and 25 GB** free for the lifetime of that account. This template requests free tier and provisions a 400 RU/s container. If a free-tier account already exists, choose another subscription or create a new one; do not delete an account that may hold data. More usage and other Azure services are billable. [Microsoft Cosmos free-tier guide](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier).
4. Create a modest monthly **Cost Management → Budgets** alert for the subscription (for example at 50%, 80% and 100% of the amount you accept). A budget warns; it does not stop services. [Azure budget guide](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).

Read the [service and cost table](costs.md) before continuing. You also need a DNS domain you control for the website and ACS custom email sender.

## 2. Prepare your computer and repository

Install [Git](https://git-scm.com/downloads), [Node.js 22+](https://nodejs.org/en/download), [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli), [Azure Developer CLI (`azd`)](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/install-azd) and [Azure Functions Core Tools 4](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local). On Windows, use PowerShell. Fork or copy this repository into **your** GitHub account. Keep the repo private until you have reviewed its files, then make it public if desired; deployment does not require the source repository to be public.

In the repository root:

```powershell
az login
az account list --output table
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
az bicep build --file infra/main.bicep
```

The initial `npm audit` check requires access to the npm advisory service. Run `npm.cmd audit --audit-level=moderate` when online and resolve findings before publishing.

## 3. Answer the deployment questions

Run the local setup script:

```powershell
.\scripts\setup-deployment.ps1
```

It asks which subscription to use, checks the one-free-Cosmos-account rule, then asks for a new `azd` environment, resource group, regions, website hostname, email domain, **the exact Microsoft account to make initial super admin**, and an alert recipient. It refuses an existing resource group or an unverifiable existence check; it must not update an unrelated deployment. It creates a random reminder scheduler key and stores the values in the local ignored `.azure` environment. The admin account is chosen by **you**; no project maintainer account is built into the deployment. Protect that Microsoft account with MFA. If your PowerShell policy blocks local scripts, run `powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-deployment.ps1` for this invocation after reviewing the script.

The website hostname can be a subdomain such as `portfolio.example.com`; the email domain can be `example.com` or an owned sending subdomain. Both must belong to you. The data region examples are `uksouth` and `westeurope`; choose available regions close to your users. If setup says a free-tier Cosmos account is present, stop and choose another subscription. Do not reuse a production resource group or domain without planning a migration.

## 4. Provision and deploy

Review the subscription and resource group before creating anything billable:

```powershell
az account show --query '{name:name,id:id}' --output table
azd env get-values
azd provision --preview
```

`azd env get-values` may display the scheduler key; view it privately and never paste the output into an issue or terminal recording. When the preview matches your intended subscription and the [cost table](costs.md), run:

```powershell
azd provision
azd deploy
```

The deployment creates a Static Web App, managed HTTP API, one Cosmos account/database/container, private Storage account/container, ACS and Email Communication Service, and one Azure Monitor storage alert/action group. It adds a resource-group delete lock. It does **not** create a dedicated Functions app, Key Vault, public Blob container or paid Static Web Apps plan. `azd` returns the Azure-generated `WEB_URL`; open that URL first and check `/api/health` returns `{"status":"ok"...}`. Do not send invitations yet: the email domain and custom website hostname are still being connected.

## 5. Connect website DNS and ACS Email

Follow [DNS and email domain setup](dns-email.md). The Email Communication Service creates a customer-managed domain, initially unlinked. In Azure, copy **your** ownership TXT, SPF, DKIM and DKIM2 records into your DNS provider, verify all four, then run:

```powershell
azd env set EMAIL_DOMAIN_READY true
azd provision
```

This second provision links the verified domain and creates the `reminders@<your-email-domain>` sender. The Bicep intentionally stops issuing updates to the verified domain after you set `EMAIL_DOMAIN_READY=true`, because recreating it can reset verification. Add the website custom domain to Static Web Apps, create its DNS records and wait for Azure-managed TLS. Re-test the custom URL and Microsoft redirect. ACS Email is metered; see [email delivery and pricing](email-delivery/README.md).

## 6. Sign in as the initial administrator

Open the site with the exact Microsoft account entered during setup. The platform should recognise it as a **Super admin** without a prior invitation. Create an organisation, then use [administrator steps](administrator-guide.md) to invite other Microsoft accounts. The user-facing code is public, but an arbitrary Microsoft account must see **Invitation required** and must not receive portfolio data. The default Static Web Apps Microsoft provider can authenticate any Microsoft account; the API invitation and membership checks are the real access gate. [Microsoft authentication behaviour](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization).

## 7. Configure GitHub deployment and reminder workflow

In your GitHub repository, open **Settings → Secrets and variables → Actions**. Add:

| Kind | Name | Value |
|---|---|---|
| Secret | `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token from **your** Static Web App in Azure Portal → Manage deployment token. |
| Secret | `REMINDER_API_KEY` | The generated scheduler key from your local `azd` environment. Do not create a different key. |
| Variable | `PORTFOLIO_API_URL` | The Azure-generated `https://...azurestaticapps.net` base URL, without a trailing slash. |
| Variable | `AZURE_DEPLOY_ENABLED` | Set to `true` only after the deployment token is stored. This opts your repo into automatic deployment on `main` pushes. |
| Variable | `REMINDERS_ENABLED` | Set to `true` only after ACS is verified, the scheduler key is stored and you are ready for email sends. |

The Azure workflows are opt-in: without these two variables their jobs are skipped, so a fresh copy of this repository does not try to deploy or send email. If a workflow shows **Disabled** under **Actions**, enable it after adding the corresponding secret and variable. The deployment workflow then runs after pushes to `main` and on manual dispatch. Pull requests run validation only; they never receive the deployment token. Protect `main` with reviews and required checks before enabling automatic deployment. The reminder workflow runs daily at **08:00 UTC**, which is 09:00 UK summer time and 08:00 UK winter time. It calls `POST /api/reminders/run` with the scheduler key. Run it manually once from **Actions → Send email reminders → Run workflow** after ACS and DNS are ready. A `count: 0` result is normal when nothing is due.

The scheduler endpoint is publicly routable because the managed Static Web Apps API has only HTTP triggers, but it rejects requests without the 32+ character key. Do not put the key in the URL or browser code. Details are in [email delivery](email-delivery/README.md).

If you make your source repository public, enable **Settings → Code security and analysis → Private vulnerability reporting**, then add branch protection for `main`. The repository includes [contributing](../CONTRIBUTING.md), [security reporting](../SECURITY.md) and an [MIT licence](../LICENSE); review their owner/contact wording for your fork.

## 8. Acceptance checks

- Microsoft sign-in redirects back to **your** custom hostname; the configured admin sees **Super admin**.
- An uninvited Microsoft account sees **Invitation required**. An editor cannot open Platform admin or access another organisation ID.
- Create a synthetic organisation, property, tenant, rent payment and compliance item. Check overview and finance figures.
- Upload a synthetic document; its Blob container is private and a download requires a fresh authorised URL.
- Send one controlled invitation and reminder to an account you control. Confirm sender address and delivery in ACS.
- Review Azure **Cost Management**, Cosmos free-tier status and Storage capacity. Never assume a zero invoice.

Use [testing](testing.md) for more checks and [troubleshooting](troubleshooting.md) for failures. Keep `.azure/`, `local.settings.json`, real screenshots and any exported records out of Git.
