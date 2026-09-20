# Operations runbook

## Daily

- In a configured instance with `REMINDERS_ENABLED=true`, GitHub runs the single email reminder endpoint at 08:00 UTC. It covers both live compliance expiry dates and per-property rent collection dates; no separate scheduler is required.
- Review failed workflow notifications.
- A successful run with `count: 0` is normal when nothing is due.

Compliance reminders go to every active member of the organisation at the configured offsets and on the expiry date. Only the live compliance record (without `rentalYearId`) is scanned; rollover snapshots never send. Rent reminders go to the same active members on the configured collection day, every seventh day afterwards until settled, and once when all tenants are Paid, covered In advance, Waived or Adjusted. Per-recipient delivery hashes prevent a successful stage from being sent twice.

Templates and selection rules are server-side in `src/api/src/services/reminders.ts`. The authorised scheduler/deduplication handler is `src/api/src/functions/reminders.ts`. Do not move templates, recipients, credentials or delivery decisions into the browser.

## Weekly

- Review Static Web Apps and API failures.
- Review Cosmos throttling (HTTP 429) and RU consumption.
- Review Storage used capacity and failed requests.
- Review pending platform invitations, accepted users and super-admin grants. Organisation membership is available only after platform acceptance.
- Confirm email-domain verification and sender reputation remain healthy.

## Monthly

- Review Azure Cost Management and budget alerts.
- Review organisation membership with owners.
- Test a reminder in a controlled organisation/date.
- Run `npm audit`, CI, Bicep validation and dependency updates.
- Confirm Cosmos backup configuration and Blob soft-delete settings.

## Capacity

The initial Storage alert fires above 5 GiB, an application business threshold rather than Azure's account limit. Investigate unexpected upload growth immediately. Cosmos free tier covers 1,000 RU/s and 25 GB; the container uses 400 RU/s. Azure offers and free allowances can change, so confirm the subscription invoice and Cost Management view rather than assuming a permanent zero cost.

## Reminder incident

1. Disable the GitHub schedule or rotate/remove `REMINDER_API_KEY` if messages are unsafe.
2. Check workflow output without printing the key.
3. Confirm Email domain/link/sender status.
4. Query only delivery metadata; do not paste customer record contents into tickets.
5. Correct the issue and run a controlled manual reminder.
6. Record incident time, affected organisations, message count and remediation.

## Data recovery

- Cosmos uses periodic backups. Open an Azure support restore request if a logical deletion cannot be recovered through Archive.
- Blob/container soft delete is seven days. Restore through Storage data protection tools before the retention expires.
- Confirm your own retention and export policy before using the app with real tenants; the application has no self-service bulk export.

## Cost controls

Keep the Static Web App on Free and Cosmos below its allowance. Blob transactions/capacity, ACS Email and monitoring can still incur charges. Standard GitHub-hosted runners are currently free for public repositories; private repositories have allowances. Configure subscription or resource-group budget alerts at 50%, 80% and 100% of your own monthly budget. See [costs](costs.md).
