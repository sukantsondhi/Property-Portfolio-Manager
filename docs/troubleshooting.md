# Troubleshooting

## Sign-in works but “Invitation required” appears

The Microsoft account has no active platform invitation, its invitation expired or was revoked, or a previous acceptance was bound to a different Microsoft provider user ID. Confirm the exact signed-in address. A super admin can create or refresh the platform invitation. Sign out at `/.auth/logout` and try again. Never manually change a bound provider ID without investigating identity ownership.

## No organisations appear

Platform acceptance does not create organisation membership. The user can create a new organisation, or an Owner can add the already accepted platform user through **Organisation → Members**. Reload the session after accepting an invitation.

## API request returns HTML or a generic failure

The website custom DNS proxy or security challenge may have intercepted `/api`. Use the generated Azure Static Web Apps hostname to compare, and keep the custom hostname DNS-only until Microsoft redirect and all API methods work. Do not bypass the API’s authentication or membership checks.

## Organisation not found after switching

Return to `/select-organization` and select an active membership. The browser remembers a selected organisation ID for convenience, but the API reauthorises every request. Never change Cosmos records to “fix” an unrecognised organisation without checking membership.

## Reminder workflow returns 401

The GitHub `REMINDER_API_KEY` secret and Static Web Apps application setting must match and be at least 32 characters. Rotate both to a new random value if uncertain. A direct browser request without the key should return 401. Keep the key out of URLs and logs.

## Azure workflows are skipped or disabled

A fresh copy intentionally skips deployment and email jobs. After deploying your own Azure resources, add the matching GitHub secrets and set `AZURE_DEPLOY_ENABLED=true` for future `main` deployments and `REMINDERS_ENABLED=true` for scheduled email. If a workflow was disabled in **Actions**, enable it there after configuration. The source template does not contain Azure credentials and should not deploy on behalf of its maintainer.

## Reminder workflow receives a DNS proxy challenge

Set the GitHub `PORTFOLIO_API_URL` variable to the Azure-generated `https://...azurestaticapps.net` base URL, not a proxied custom hostname. Emails still link to the configured custom `WEB_URL`.

## Reminder count is zero or an email does not arrive

A zero count is expected when no live compliance item matches an offset/due date and no property rent stage is due. Check the current **UTC** date, compliance `reminderEnabled`, property collection day, active members and prior deduplication stage. For delivery failures, confirm the ACS domain’s **Domain, SPF, DKIM and DKIM2** states, linked domain, sender username and recipient status. Check ACS suppression/bounce and Azure service health. See the [email guide](email-delivery/README.md).

## Custom website hostname stays pending

Copy the TXT validation value exactly from **your** Static Web App and point the chosen CNAME at its generated host. Remove conflicting A/AAAA/CNAME records at that name. Wait for DNS propagation and Azure TLS issuance. If using a DNS proxy, leave it off until validation completes.

## Cosmos free-tier provisioning fails

Only one free-tier Cosmos account is allowed per subscription. Choose a subscription without one, or create a new subscription. Do not disable `enableFreeTier` or delete an existing account merely to make provisioning succeed; either can have cost or data-loss consequences. Check subscription permissions and regional availability as well.

## Resource-group changes are blocked by a lock

The Bicep adds a **CanNotDelete** resource-group lock to prevent accidental deletion. Inspect it in Azure Portal before any intentional resource replacement or cleanup. Do not remove the lock as routine troubleshooting; first identify which operation needs deletion and whether it holds data.

## Document upload or download fails

Check `DOCUMENT_UPLOADS_ENABLED`, file type and 25 MiB limit, organisation membership, property/year state and available document quota. Uploads now pass through the API, not Storage CORS. A 410 response from the old upload routes requires a browser refresh after the API and web deployment. A timed-out or failed upload can leave an archived reservation; ask an owner to remove it after two minutes. Accepted archived documents may be restored, but failed upload reservations cannot. A signed read URL expires after ten minutes; request a new one. Never paste a signed URL or account key into a public issue.

## Static Web App deployment token is rejected

Get the deployment token for **this** Static Web App from Azure Portal and replace `AZURE_STATIC_WEB_APPS_API_TOKEN` in your GitHub Actions secrets. A token from another app will not work. Review who can push to `main`; only that branch and manual dispatch receive the deployment token.

## CI fails but local build succeeds

Use Node.js 22+, check all three lockfiles, and run `npm ci`, typecheck, tests, build and Bicep build from the root. `npm audit` needs advisory network access. Keep pull-request CI free of secrets even when troubleshooting.

## Cosmos returns HTTP 429

Inspect RU/s and the query’s `organizationId` partition scope. The SDK retries transient throttles. Increasing above the free allowance may add charges; review [costs](costs.md) first.

## Emergency containment

Disable the GitHub reminder schedule if the wrong mail is being sent. Revoke affected organisation/platform access, rotate an exposed key or token, preserve privacy-safe audit metadata and verify the boundary before resuming. Report a source-code vulnerability through [SECURITY.md](../SECURITY.md).
