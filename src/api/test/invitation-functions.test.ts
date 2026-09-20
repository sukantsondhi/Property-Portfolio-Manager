import { HttpRequest } from "@azure/functions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrganizationInvitation,
  createPlatformInvitation,
  deleteOrganization,
  invitationRoutes,
  listOrganizationMembers,
  listPlatformInvitationStatus,
} from "../src/functions/organizations";
import { getDirectory, resetDirectoryForTests } from "../src/services/directory";
import { getStore, setStoreForTests } from "../src/services/store";

const admin = { userId: "admin-provider-id", email: "admin@example.com", roles: ["authenticated"] };
const principal = Buffer.from(JSON.stringify({
  identityProvider: "aad",
  userId: admin.userId,
  userDetails: admin.email,
  userRoles: admin.roles,
})).toString("base64");

function request(method: string, path: string, body?: unknown, params: Record<string, string> = {}, organizationId?: string) {
  return new HttpRequest({
    method,
    url: `http://localhost/api/${path}`,
    params,
    headers: {
      "content-type": "application/json",
      "x-ms-client-principal": principal,
      ...(organizationId ? { "x-organization-id": organizationId } : {}),
    },
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

describe("invitation HTTP functions", () => {
  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    process.env.PLATFORM_ADMIN_EMAILS = admin.email;
    process.env.WEB_URL = "https://property.example.com";
    resetDirectoryForTests();
    setStoreForTests();
  });

  afterEach(() => {
    resetDirectoryForTests();
    setStoreForTests();
    delete process.env.DATA_BACKEND;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.WEB_URL;
  });

  it("uses dedicated list, create and revoke routes", () => {
    expect(invitationRoutes).toEqual({
      organizationMembers: "organizations/{id}/members",
      organizationInvitationCreate: "organizations/{id}/invitations",
      organizationDelete: "organizations/{id}",
      platformInvitations: "platform/invitations",
      platformInvitationCreate: "platform/invitations/create",
      platformInvitationRevoke: "platform/invitations/{id}",
      platformAdminUpdate: "platform/admins",
      platformUserRemove: "platform/users/{id}",
    });
  });

  it("creates and lists a platform invitation through its HTTP handlers", async () => {
    const mailer = vi.fn().mockResolvedValue(undefined);
    const created = await createPlatformInvitation(request("POST", "platform/invitations/create", { email: "member@example.com" }), mailer);
    expect(created).toMatchObject({ status: 201, jsonBody: { email: "member@example.com", status: "pending", emailDelivery: "sent" } });
    expect(mailer).toHaveBeenCalledOnce();

    const listed = await listPlatformInvitationStatus(request("GET", "platform/invitations"));
    expect(listed.status).toBe(200);
    expect(listed.jsonBody).toEqual(expect.arrayContaining([expect.objectContaining({ email: "member@example.com", status: "pending" })]));
  });

  it("keeps saved access pending and explains when invitation email delivery fails", async () => {
    const failed = await createPlatformInvitation(
      request("POST", "platform/invitations/create", { email: "delivery-failed@example.com" }),
      vi.fn().mockRejectedValue(new Error("delivery failed")),
    );
    expect(failed).toMatchObject({ status: 502, jsonBody: { error: { code: "invitation_email_failed" } } });
    const listed = await listPlatformInvitationStatus(request("GET", "platform/invitations"));
    expect(listed.jsonBody).toEqual(expect.arrayContaining([expect.objectContaining({ email: "delivery-failed@example.com", status: "pending" })]));
  });

  it("creates and lists an organisation invitation through its HTTP handlers", async () => {
    const organization = await getDirectory().createOrganization("Test Portfolio", admin);
    await getDirectory().createPlatformInvitation("member@example.com", admin);
    await getDirectory().resolveUser({ userId: "member-provider", email: "member@example.com", roles: ["authenticated"] });
    const mailer = vi.fn().mockResolvedValue(undefined);
    const created = await createOrganizationInvitation(request("POST", `organizations/${organization.id}/invitations`, { email: "member@example.com", role: "editor" }, { id: organization.id }, organization.id), mailer);
    expect(created).toMatchObject({ status: 201, jsonBody: { status: "accepted", role: "editor", emailDelivery: "sent" } });
    expect(mailer).toHaveBeenCalledOnce();

    const listed = await listOrganizationMembers(request("GET", `organizations/${organization.id}/members`, undefined, { id: organization.id }, organization.id));
    expect(listed.status).toBe(200);
    expect(listed.jsonBody).toMatchObject({ members: expect.arrayContaining([expect.objectContaining({ email: "member@example.com", status: "accepted" })]) });
  });

  it("requires exact confirmation and purges an organisation with its document blobs", async () => {
    const organization = await getDirectory().createOrganization("Delete Me", admin);
    const store = getStore(organization.id);
    await store.create("property", { name: "House" }, admin);
    await store.create("document", { blobName: "org/delete-me/document.pdf" }, admin);
    const deleteRequest = (confirmationName: string) => request("DELETE", `organizations/${organization.id}`, { confirmationName }, { id: organization.id }, organization.id);

    const rejected = await deleteOrganization(deleteRequest("Wrong name"), vi.fn());
    expect(rejected).toMatchObject({ status: 400, jsonBody: { error: { code: "confirmation_mismatch" } } });
    expect(await store.list("property")).toHaveLength(1);

    const blobDeleter = vi.fn().mockResolvedValue(undefined);
    const deleted = await deleteOrganization(deleteRequest("Delete Me"), blobDeleter);
    expect(deleted).toMatchObject({ status: 200, jsonBody: { name: "Delete Me", deletedRecordCount: 2, deletedBlobCount: 1, blobCleanupFailures: 0 } });
    expect(blobDeleter).toHaveBeenCalledWith("org/delete-me/document.pdf");
    expect((await getDirectory().resolveUser(admin)).organizations).toHaveLength(0);
    expect(await store.list("property")).toHaveLength(0);
  });
});
