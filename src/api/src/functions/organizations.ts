import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { z } from "zod";
import { authenticateIdentity, authenticatePlatform, authorizeOrganization } from "../services/auth";
import { getDirectory } from "../services/directory";
import { deleteBlob } from "../services/blobs";
import { organizationInvitationEmail, platformInvitationEmail, sendInvitationEmail, type InvitationEmail } from "../services/invitationEmails";
import { json, problem, StoreError } from "../services/responses";
import { getStore } from "../services/store";
import { organizationDeletedEmail, sendPortfolioEmail } from "../services/portfolioEmails";

const organizationInput = z.object({ name: z.string().trim().min(2).max(120) });
const invitationInput = z.object({ email: z.email().transform((value) => value.toLowerCase()), role: z.enum(["owner", "editor"]).default("editor") });
const platformInvitationInput = z.object({ email: z.email().transform((value) => value.toLowerCase()) });
const platformAdminInput = z.object({ email: z.email().transform((value) => value.toLowerCase()), enabled: z.boolean() });
const organizationDeletionInput = z.object({ confirmationName: z.string().trim().min(1).max(120) });
type InvitationMailer = (message: InvitationEmail) => Promise<unknown>;

export const invitationRoutes = Object.freeze({
  organizationMembers: "organizations/{id}/members",
  organizationInvitationCreate: "organizations/{id}/invitations",
  organizationDelete: "organizations/{id}",
  platformInvitations: "platform/invitations",
  platformInvitationCreate: "platform/invitations/create",
  platformInvitationRevoke: "platform/invitations/{id}",
  platformAdminUpdate: "platform/admins",
  platformUserRemove: "platform/users/{id}",
});

export async function listOrganizationMembers(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    const identity = authenticateIdentity(request);
    await authorizeOrganization(request, true);
    return json(200, await getDirectory().listMembers(request.params.id, identity));
  } catch (error) { return problem(error); }
}

export async function createOrganizationInvitation(request: HttpRequest, mailer: InvitationMailer = sendInvitationEmail): Promise<HttpResponseInit> {
  try {
    const identity = authenticateIdentity(request);
    await authorizeOrganization(request, true);
    const input = invitationInput.parse(await request.json());
    const result = await getDirectory().inviteMember(request.params.id, input.email, input.role, identity);
    let emailDelivery = "not_required";
    if (!(result.status === "accepted" && result.existing)) {
      try {
        await mailer(organizationInvitationEmail(input.email, request.params.id, result.organizationName, input.role));
        emailDelivery = "sent";
      } catch {
        throw new StoreError(502, "invitation_email_failed", "Access was saved, but the invitation email could not be sent. Try inviting this email again to resend it.");
      }
    }
    return json(201, { ...result, emailDelivery });
  } catch (error) { return problem(error); }
}

export async function listPlatformInvitationStatus(request: HttpRequest): Promise<HttpResponseInit> {
  try { return json(200, await getDirectory().listPlatformInvitations(authenticateIdentity(request))); }
  catch (error) { return problem(error); }
}

export async function createPlatformInvitation(request: HttpRequest, mailer: InvitationMailer = sendInvitationEmail): Promise<HttpResponseInit> {
  try {
    const input = platformInvitationInput.parse(await request.json());
    const result = await getDirectory().createPlatformInvitation(input.email, authenticateIdentity(request));
    let emailDelivery = "not_required";
    if (!(result.status === "accepted" && result.existing)) {
      try {
        await mailer(platformInvitationEmail(input.email));
        emailDelivery = "sent";
      } catch {
        throw new StoreError(502, "invitation_email_failed", "Platform access was saved, but the invitation email could not be sent. Try inviting this email again to resend it.");
      }
    }
    return json(201, { ...result, emailDelivery });
  } catch (error) { return problem(error); }
}

export async function deleteOrganization(request: HttpRequest, blobDeleter: (blobName: string) => Promise<unknown> = deleteBlob): Promise<HttpResponseInit> {
  try {
    const input = organizationDeletionInput.parse(await request.json());
    const identity = authenticateIdentity(request);
    const result = await getDirectory().deleteOrganization(request.params.id, input.confirmationName, identity, async () => {
      const store = getStore(request.params.id);
      const purged = await store.purgeAll();
      const blobResults = await Promise.allSettled(purged.blobNames.map(async (blobName) => {
        await blobDeleter(blobName);
        await store.acknowledgeBlobDeletion(blobName);
      }));
      return {
        deletedRecordCount: purged.deletedCount,
        deletedBlobCount: blobResults.filter((item) => item.status === "fulfilled").length,
        blobCleanupFailures: blobResults.filter((item) => item.status === "rejected").length,
      };
    });
    if (result.blobCleanupFailures) console.error(`Organisation deletion left ${result.blobCleanupFailures} private blob(s) queued for maintainer cleanup.`);
    const notifications = await Promise.allSettled(
      result.notificationRecipients.map((recipient) =>
        sendPortfolioEmail(organizationDeletedEmail(recipient, result.name)),
      ),
    );
    const { notificationRecipients: _notificationRecipients, ...publicResult } = result;
    return json(200, {
      ...publicResult,
      memberNotificationsSent: notifications.filter((item) => item.status === "fulfilled").length,
      memberNotificationFailures: notifications.filter((item) => item.status === "rejected").length,
    });
  } catch (error) { return problem(error); }
}

export async function revokePlatformInvitation(request: HttpRequest): Promise<HttpResponseInit> {
  try {
    await getDirectory().revokePlatformInvitation(request.params.id, authenticateIdentity(request));
    return { status: 204 };
  } catch (error) { return problem(error); }
}

app.http("organizations", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "organizations",
  handler: async (request) => {
    try {
      if (request.method === "GET") return json(200, (await authenticatePlatform(request)).organizations);
      const input = organizationInput.parse(await request.json());
      return json(201, await getDirectory().createOrganization(input.name, authenticateIdentity(request)));
    } catch (error) { return problem(error); }
  },
});

app.http("organizationMembers", {
  methods: ["GET"], authLevel: "anonymous", route: invitationRoutes.organizationMembers,
  handler: listOrganizationMembers,
});

app.http("organizationInvitationCreate", {
  methods: ["POST"], authLevel: "anonymous", route: invitationRoutes.organizationInvitationCreate,
  handler: (request) => createOrganizationInvitation(request),
});

app.http("organizationDelete", {
  methods: ["DELETE"], authLevel: "anonymous", route: invitationRoutes.organizationDelete,
  handler: (request) => deleteOrganization(request),
});

app.http("organizationMember", {
  methods: ["DELETE"], authLevel: "anonymous", route: "organizations/{id}/members/{membershipId}",
  handler: async (request) => {
    try {
      const identity = authenticateIdentity(request);
      await getDirectory().removeMembership(request.params.id, request.params.membershipId, identity);
      return { status: 204 };
    } catch (error) { return problem(error); }
  },
});

app.http("platformInvitationList", {
  methods: ["GET"], authLevel: "anonymous", route: invitationRoutes.platformInvitations,
  handler: listPlatformInvitationStatus,
});

app.http("platformInvitationCreate", {
  methods: ["POST"], authLevel: "anonymous", route: invitationRoutes.platformInvitationCreate,
  handler: (request) => createPlatformInvitation(request),
});

app.http("platformInvitationRevoke", {
  methods: ["DELETE"], authLevel: "anonymous", route: invitationRoutes.platformInvitationRevoke,
  handler: revokePlatformInvitation,
});

app.http("platformAdminUpdate", {
  methods: ["PATCH"], authLevel: "anonymous", route: invitationRoutes.platformAdminUpdate,
  handler: async (request) => {
    try {
      const input = platformAdminInput.parse(await request.json());
      return json(200, await getDirectory().setPlatformAdmin(input.email, input.enabled, authenticateIdentity(request)));
    } catch (error) { return problem(error); }
  },
});

app.http("platformUserRemove", {
  methods: ["DELETE"], authLevel: "anonymous", route: invitationRoutes.platformUserRemove,
  handler: async (request) => {
    try {
      await getDirectory().deactivatePlatformUser(request.params.id, authenticateIdentity(request));
      return { status: 204 };
    } catch (error) { return problem(error); }
  },
});
