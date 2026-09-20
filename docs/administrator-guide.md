# Administrator guide

## First sign-in and the three access gates

During deployment, `scripts/setup-deployment.ps1` asks **which Microsoft account email will be the initial super admin**. The value is saved as a server-side `PLATFORM_ADMIN_EMAILS` application setting. Sign in with that exact account; it does not need a platform invitation. Protect it with MFA and account recovery. A super admin can create their first organisation from the organisation selector.

For everyone else, access has three gates: Microsoft authentication, a current platform invitation/accepted user record, and membership in the selected organisation. The app uses its own Cosmos invitation records, **not** Static Web Apps custom-role invitations. On first accepted sign-in, the invitation is bound to the immutable Microsoft provider user ID. An email address alone cannot switch identities later.

| Role | Portfolio data | Members and deletion | Platform people |
|---|---|---|---|
| Editor | Create, edit, archive and restore in assigned organisations | No owner-only actions | No |
| Owner | Editor permissions in assigned organisations | Manage members and confirmed destructive actions | No |
| Super admin | Owner-equivalent in every active organisation, with API audit attribution | Yes | Invite users, grant/revoke super admins, remove platform users |

## Invite a Microsoft account to the platform

1. Sign in as a super admin, select or create an organisation, then open **Platform admin**.
2. Under **Add a Microsoft account**, enter the person’s exact Microsoft account email and choose **Create invitation**.
3. The invitation is saved and ACS sends a sign-in link. It expires after **14 days**. If email delivery fails, the UI reports that access was saved; refresh/reinvite the pending address after fixing ACS.
4. The person follows the link and signs in with the same Microsoft account. Once accepted, they can create their own organisation or receive access to yours.

The invitation register distinguishes Pending, Accepted and Revoked. Reinviting a pending email refreshes it; an already accepted account is not re-emailed. Revoke a pending invitation from the same screen. Super admins can grant the super-admin role only to an **already accepted** platform user. A configured bootstrap admin cannot be removed through the UI; change the secure server setting for that account.

## Give someone access to an organisation

1. First confirm the person has **accepted platform access**. Merely sending a platform invitation is not enough.
2. As an Owner or Super admin, open the organisation and choose **Organisation → Members**.
3. Enter the person’s Microsoft email and choose **Editor** or **Owner**. Use Editor for routine property work. The API rejects membership for a person who has not accepted platform access.
4. Membership becomes active and ACS sends an organisation-specific message. The person can switch between their authorised organisations in the sidebar.

Owners can remove members, but the **last owner cannot be removed**. Super admins have owner-equivalent organisation access; every operation remains scoped to that organisation’s Cosmos partition. To remove all platform access, a super admin can use **Platform admin → Remove user** after resolving any last-owner membership. Do not grant super admin merely to let someone edit records.

## Correct, archive or delete data

- Editors can archive and restore ordinary records. Archived items are hidden from active figures.
- An owner can permanently delete archived records after an explicit confirmation. The app cannot restore them afterward; Cosmos/Blob backup policies are the remaining recovery route.
- An owner or super admin can use **Organisation → Danger zone → Delete organisation**. The exact name and a second confirmation are required. Portfolio records, document blobs and memberships are removed; the platform identity remains available for other organisations. This cannot be undone in the application.
- A closed rental year is read-only until **History → Restore for editing**. Only one year per property can be restored at a time. Save it back to History when the correction is complete.

## Recover administrator access

If the bootstrap Microsoft account is lost, a person with Azure permission to edit Static Web Apps application settings can change `PLATFORM_ADMIN_EMAILS` to another controlled Microsoft account, sign in once, then update the local `azd` environment so a later provision does not revert it. This is a highly privileged recovery path; audit the change and protect Azure access with MFA. Do not commit admin addresses to the repository.
