# User guide

## Sign in and choose an organisation

Open your instance’s HTTPS address and choose **Continue with Microsoft**. Use the exact account the platform administrator invited. If you see **Invitation required**, ask the administrator to invite that account; a successful Microsoft login alone does not grant access. On the organisation selector, open an assigned organisation or create your own. **Switch organisation** in the sidebar returns to the selector. Data never moves between organisations automatically.

## Add a home or other rental property

1. Open **Properties → Add property**. Enter a name, property type, address, postcode, bedroom/bathroom counts and status.
2. Enter tenancy start/end dates and expected rent as a monthly or whole-tenancy amount. The form shows the calculated monthly and annual values. The service stores pounds as integer pence.
3. Choose the monthly **Rent collection day** from 1–31. In shorter months, day 29–31 moves to that month’s last day. This controls rent email timing; it does not create a payment automatically.
4. Optionally add a JPG, PNG or WebP property picture. Save, then open the property card to access the detailed workspace.

Use the property tabs to add tenants, tenancies, guarantors, references, compliance, expenses and documents. A new property has a current rental year. Each child record remains linked to its property and year.

## Add tenants, agreements and contacts

In a property, open **Tenants** and add each person’s name, email, monthly rent, room and agreement-related information. University/course fields are optional for student lets. Review deposit status and optional emergency contact/notes. Open **Tenancies** to record the agreement dates, room, deposit and linked tenants. Add a tenant before adding their guarantor or reference; choose the linked tenant in the **Guarantors** or **References** tab. Only enter personal details you need and have authority to retain.

The **Tenancy** tab starts on the current month. Its selector offers the current month and months with recorded rent for that property/year. Each tenant row shows their own status, ledger entries and payment notes. The summary compares month and rental-year receipts against expected rent for agreements active in the chosen month.

## Record rent correctly

Choose **Record rent** from the property workspace, select tenant/month, status, received amount and payment details. The payment belongs to explicit `appliesToMonth`; an older entry without it uses its recorded date. Use:

| Status | Meaning in the ledger |
|---|---|
| Paid | One settled payment for a tenant/month. Recording another Paid replaces the existing row only after confirmation. |
| Partial or Late | Additive instalments. They add received rent without creating another monthly liability. |
| Adjusted | Additive recorded receipt with a reason; counts as settled for email follow-ups. |
| Waived | Reduces the uncollected liability for that tenant/month to rent already retained; counts as settled for email. |
| In advance | Records one receipt across the payment month and 1–48 additional months that fit the agreement and rental year. Linked allocations are edited or archived together. |
| Due | A due/unsettled position with no payment received. |

Edit a wrong entry in place or use **Delete** to move it to Archive. Archived payments leave active calculations; restoration brings them back. Overpayments or future allocations do not erase another tenant/month’s arrears. Finance reports are read-only, grouped by property and rental year, and show recent transactions.

## Expenses and compliance

Under the property, add an **Expense** with category, amount, date and optional note. Finance and overview use active current-year records. Under **Compliance**, choose a category such as EPC, gas safety, EICR, insurance, licence or other, enter a title and expiry/due date, and leave **Send email reminder** on if needed. Default offsets are 30, 7 and 1 days before expiry, plus the due date. You can choose up to three distinct offsets from 0–365 days. Only the live record sends reminders; closed-year copies are evidence, not active schedules.

Rent emails go to active organisation members on the property collection day, weekly while any tenant remains Due, Partial or Late, and once when all are Paid, In advance, Waived or Adjusted. There is **no separate automatic end-of-month digest**. See the [email guide](email-delivery/README.md) for exact timing and costs.

## Private pictures and documents

Use **Documents** or a property/compliance upload control to add PDF, JPG, PNG, WebP, DOCX or XLSX files up to **25 MiB**. The API gives the browser a short-lived upload URL, checks size, MIME, extension and file signature, then creates the record. The Blob container is private. Open or download requires a fresh authorised short-lived URL. Do not forward links or upload untrusted files; this deployment has no malware scanner.

## Rental years and History

When a new tenancy cycle begins, use **Start rental year**, review label/dates/rent and confirm. The outgoing year closes with a property snapshot; its linked records become read-only under **History**. Owners receive separate backup emails, with eligible small attachments and a secure history link. The live compliance item remains available for future renewal reminders.

For a correction, open a closed year in History, choose **Restore for editing**, make the change in that restored year, then **Save edits to History**. The actual current property/year is not overwritten. Another rollover is blocked until the restored year is closed again.

## Archive and access

**Archive** shows recoverable records and lets an editor restore them. Permanent deletion is owner-only and requires confirmation. The organisation’s **Danger zone** can delete an entire organisation after two confirmations. Ask an owner before sharing sensitive tenant data; the administrator guide explains how an accepted platform user is added to a specific organisation.
