# Website DNS and ACS sender domain

Use a domain you own. The example `portfolio.example.com` / `example.com` values below are placeholders; **Azure generates verification values for your resources**. DNS menus vary by registrar. Keep values copied from Azure out of Git and public issues.

## Website custom hostname

1. After `azd provision` and `azd deploy`, find the generated `https://...azurestaticapps.net` URL in `azd` output or in your Static Web App **Overview**. Confirm the generated site opens.
2. In Azure Portal, open **Static Web Apps → your app → Custom domains → Add**. Enter the website hostname supplied during setup, such as `portfolio.example.com`. Choose the external DNS validation method Azure offers and copy its exact validation record.
3. At your DNS provider, create the requested TXT record and the CNAME from your chosen hostname to the generated `*.azurestaticapps.net` hostname. If your DNS provider has a proxy switch, leave the CNAME in **DNS only** mode until validation and Microsoft sign-in work. Azure manages the site TLS certificate.
4. Wait for validation and HTTPS. Test the custom site, sign-in redirect and `/api/health` on the custom host. A DNS proxy or bot challenge can intercept authenticated API calls; test each method if you later enable one. [Microsoft custom domain guide](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain-external).

The app’s `WEB_URL` is the custom hostname chosen at setup. Invitation and reminder links will use it. Do not send real invitations until DNS and HTTPS work.

## ACS custom sending domain

1. Open **Email Communication Services → your email service → Provision domains → your domain**. The first provision creates a **Customer managed** domain but leaves it unlinked.
2. Add the **domain ownership TXT** value Azure shows to your DNS provider; start verification in Azure. Then add the exact **SPF TXT**, **DKIM CNAME** and **DKIM2 CNAME** records Azure shows and verify each. DNS propagation may take time. [Microsoft custom-domain steps](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/add-custom-verified-domains).
3. If the domain already sends email through another provider, merge that provider into the single SPF policy. Do not publish two `v=spf1` records for the same name. Ask your existing mail provider for a safe combined policy before changing live email DNS. DKIM selector names and targets must match the values shown for your ACS domain.
4. Add a DMARC policy appropriate to your domain and monitor results. DMARC is separate from Azure’s four required Domain/SPF/DKIM/DKIM2 verification states. Do not invent a reporting mailbox that does not exist.
5. Once all four required states show **Verified**, run `azd env set EMAIL_DOMAIN_READY true` and `azd provision`. This links the verified domain to the Communication Service and creates the `reminders` sender username. Azure requires the Email and Communication resources to be in the same data geography; this Bicep places both in Europe. [Microsoft link-domain steps](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/connect-email-communication-resource).
6. Send one controlled invitation and one controlled reminder to an account you own. Confirm the From address is `reminders@<your-domain>` and review ACS delivery status.

The sender domain can be a dedicated subdomain to keep application email separate from your normal mailbox DNS. ACS charges by delivered recipient message and transferred data; see [email delivery](email-delivery/README.md).
