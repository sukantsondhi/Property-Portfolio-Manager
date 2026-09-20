# Email delivery

Property Portfolio Manager uses **Azure Communication Services (ACS) Email**. Email is **pay as you go**, even when the web app and Cosmos database are within free allowances. [Microsoft’s pricing explanation](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing) gives illustrative rates of **US$0.00025 per recipient email plus US$0.00012 per MB transferred to each recipient**; check the [current ACS pricing page](https://azure.microsoft.com/en-us/pricing/details/communication-services/) for your agreement and region. Headers, body and attachments count toward transferred data.

## What Azure creates

The Bicep creates both an **Email Communication Service** and an **Azure Communication Services** resource in the Europe data geography, plus a customer-managed sending domain. You must own that domain and verify Domain ownership, SPF, DKIM and DKIM2 in your DNS. After verification, `EMAIL_DOMAIN_READY=true` links the domain and creates `reminders@<your-domain>`. The managed API stores the ACS connection string as a server-side Static Web Apps application setting. It must never appear in Vite variables, screenshots or GitHub files. See [DNS setup](../dns-email.md) and Microsoft’s [custom domain](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/add-custom-verified-domains) and [connect domain](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/connect-email-communication-resource) guides.

## Which messages are sent

| Message | Trigger | Recipient and content |
|---|---|---|
| Platform invitation | A super admin invites a Microsoft email. Reinviting a pending address refreshes and resends it. | Exact invited address; sign-in link; 14-day invitation expiry. An already accepted user is not re-emailed. |
| Organisation membership | An owner or super admin adds an accepted platform user as Editor or Owner. | That member; organisation name, role and sign-in link. |
| Compliance reminder | A live compliance record is due at its chosen offsets (default 30, 7 and 1 days before) and on the due date. | Every active organisation member; property, item and due date. Disable reminders per record to stop them. Closed-year snapshots do not send. |
| Rent collection update | On each property’s chosen monthly collection day, then every seven days while a tenant remains unsettled. | Every active organisation member; per-tenant status, received/expected amount and that tenant’s payment notes. Day 29–31 uses the last day in a shorter month. |
| Rent settled | Once every tenant for that property/month is recorded as Paid, In advance, Waived or Adjusted. | Every active member receives one completion stage for that property/month. Status labels remain accurate; it does not say all tenants paid. |
| Rental-year backup | An owner starts a new rental year and closes the outgoing year. | Each active owner separately; structured record summary, a secure history link and eligible attachments up to 6 MiB raw total. Other files remain accessible through authenticated History. |
| Organisation deletion notice | An owner or super admin deletes the organisation after confirmations. | Former members are notified on a best-effort basis. |

**There is no blanket “end of month” summary email.** A property set to collect on day 31 produces its initial rent email on the last day of shorter months; another property can use any day 1–31. Weekly follow-ups use the original collection date, even if they cross into the next calendar month. The daily scheduler runs at **08:00 UTC** (09:00 in UK summer, 08:00 in UK winter), so delivery time can vary with Azure/GitHub processing. A payment row’s status drives reminder settlement; finance accounting follows separate tenant/month rules. Due, Partial and Late remain unsettled. Adjusted is an additive receipt; Waived reduces only the uncollected liability for that tenant/month.

## Scheduler and deduplication

After the deployer sets the `REMINDERS_ENABLED=true` GitHub Actions variable, `.github/workflows/email-reminders.yml` calls `POST /api/reminders/run` once daily using `REMINDER_API_KEY` in a request header. Without that opt-in, the job is skipped. The endpoint is intentionally reachable without browser authentication because GitHub Actions is the caller, but it requires the generated 32+ character key. Store the same value in the Static Web App setting and the GitHub Actions secret. Use the Azure-generated app hostname in `PORTFOLIO_API_URL`; custom DNS proxies may challenge non-browser requests. The app selects due items server-side, then writes hashed per-recipient delivery-stage records in the reserved `_platform` Cosmos partition. Those records contain minimal routing metadata, never email bodies or tenant notes. A successful stage is not sent twice. If ACS reports a failed status, the app leaves that stage eligible for a later run.

The other publicly reachable endpoint is `GET /api/health`, which returns only a simple service status. Portfolio routes require Microsoft sign-in, platform access and organisation authorisation even though the Azure Functions HTTP registrations use `authLevel: "anonymous"`; Static Web Apps routing and the API’s own checks enforce the boundary.

For a manual check, use **GitHub → Actions → Send email reminders → Run workflow** with a controlled organisation/date and a mailbox you own. Check workflow success, ACS Email delivery status and the receiving mailbox. Local tests construct messages but do not prove real Azure delivery. Never print the key, connection string, full message body or customer addresses into public logs.

## Expected spend example

At Microsoft’s illustrative rates, 100 small recipient emails of 0.1 MB each cost about `100 × $0.00025 + 10 MB × $0.00012 = $0.0262` before taxes or other charges. A single email to ten recipients is billed against ten recipient deliveries and data sent to each. Attachments make backup emails much larger. Actual invoice pricing can differ.

## If mail does not arrive

1. Check Domain, SPF, DKIM and DKIM2 all show **Verified** in Email Communication Service; confirm the linked domain and `reminders` sender. Do not create two SPF TXT policies at the same name.
2. Check the deployed `EMAIL_DOMAIN_READY` value and that the API settings include a valid ACS connection string and `REMINDER_SENDER_ADDRESS`. Inspect values privately in Azure Portal.
3. Confirm the GitHub secret matches `REMINDER_API_KEY`, the `PORTFOLIO_API_URL` variable points to the generated Azure hostname, and the scheduled workflow ran. GitHub schedules can run late.
4. Check recipient formatting, ACS sending limits, suppression/bounce and service health. The app returns a failure if ACS reports a failed send; a `count: 0` result can simply mean nothing was due.
5. If the wrong content or recipient was targeted, disable the schedule or rotate the key while investigating. Keep private records out of public tickets.
