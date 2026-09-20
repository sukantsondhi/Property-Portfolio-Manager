import { afterEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/domain/types";
import { DirectoryService, MemoryDirectoryBackend } from "../src/services/directory";

const user = (email: string): AuthenticatedUser => ({ userId: `id-${email}`, email, roles: ["authenticated"] });

describe("multi-tenant directory", () => {
  afterEach(() => delete process.env.PLATFORM_ADMIN_EMAILS);
  it("admits only invited users and isolates organisation membership", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    const directory = new DirectoryService(new MemoryDirectoryBackend());
    const admin = user("admin@example.com");
    const outsider = user("outsider@example.com");
    await expect(directory.resolveUser(outsider)).rejects.toMatchObject({ code: "invitation_required" });
    await directory.createPlatformInvitation("member@example.com", admin);
    const member = user("member@example.com");
    await expect(directory.resolveUser(member)).resolves.toMatchObject({ user: { email: "member@example.com" } });
    const first = await directory.createOrganization("First Portfolio", admin);
    const second = await directory.createOrganization("Private Portfolio", admin);
    await directory.inviteMember(first.id, member.email, "editor", admin);
    await expect(directory.authorize(member, first.id)).resolves.toMatchObject({ organizationRole: "editor" });
    await expect(directory.authorize(member, second.id)).rejects.toMatchObject({ code: "organization_not_found" });
  });
  it("prevents removing the final owner", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    const directory = new DirectoryService(new MemoryDirectoryBackend());
    const admin = user("admin@example.com");
    const organization = await directory.createOrganization("Portfolio", admin);
    const members = await directory.listMembers(organization.id, admin);
    await expect(directory.removeMembership(organization.id, members.members[0].id, admin)).rejects.toMatchObject({ code: "last_owner" });
  });
  it("prevents a super admin from removing a platform user's final-owner access", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    const directory = new DirectoryService(new MemoryDirectoryBackend());
    const admin = user("admin@example.com");
    const owner = user("owner@example.com");
    await directory.createPlatformInvitation(owner.email, admin);
    const accepted = await directory.resolveUser(owner);
    await directory.createOrganization("Owner Portfolio", owner);
    const platformUser = (await directory.listPlatformInvitations(admin)).find((record) => record.email === owner.email)!;
    expect(accepted.user.email).toBe(owner.email);
    await expect(directory.deactivatePlatformUser(platformUser.id, admin)).rejects.toMatchObject({ code: "last_owner" });
  });
  it("allows only the configured platform administrator to create platform invitations", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin-one@example.com";
    const directory = new DirectoryService(new MemoryDirectoryBackend());
    const admin = user("admin-one@example.com");
    await directory.createPlatformInvitation("owner@example.com", admin);
    const organizationOwner = user("owner@example.com");
    await directory.resolveUser(organizationOwner);
    await directory.createOrganization("Owner Portfolio", organizationOwner);

    await expect(directory.createPlatformInvitation("tester@example.com", organizationOwner)).rejects.toMatchObject({ code: "admin_required" });
    await expect(directory.createPlatformInvitation("tester@example.com", admin)).resolves.toMatchObject({ email: "tester@example.com" });
  });
  it("keeps one platform access row and reports pending then accepted", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    const backend = new MemoryDirectoryBackend();
    const directory = new DirectoryService(backend);
    const admin = user("admin@example.com");

    const [first, repeated] = await Promise.all([
      directory.createPlatformInvitation("member@example.com", admin),
      directory.createPlatformInvitation("MEMBER@example.com", admin),
    ]);
    expect(first.id).toBe(repeated.id);
    expect((await backend.all()).filter((item) => item.kind === "platformInvitation" && item.email === "member@example.com")).toHaveLength(1);
    const refreshed = await directory.createPlatformInvitation("member@example.com", admin);
    expect(refreshed).toMatchObject({ id: first.id, status: "pending", existing: true });
    expect((await directory.listPlatformInvitations(admin)).filter((item) => item.email === "member@example.com")).toMatchObject([{ status: "pending" }]);

    await directory.resolveUser(user("member@example.com"));
    expect((await directory.listPlatformInvitations(admin)).filter((item) => item.email === "member@example.com")).toMatchObject([{ status: "accepted" }]);
    await expect(directory.createPlatformInvitation("member@example.com", admin)).resolves.toMatchObject({ status: "accepted", existing: true });
  });
  it("requires platform access before an owner can add an organisation member", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    const backend = new MemoryDirectoryBackend();
    const directory = new DirectoryService(backend);
    const admin = user("admin@example.com");
    const organization = await directory.createOrganization("Portfolio", admin);

    await expect(directory.inviteMember(organization.id, "member@example.com", "editor", admin)).rejects.toMatchObject({ code: "platform_user_required" });
    await directory.createPlatformInvitation("member@example.com", admin);
    await directory.resolveUser(user("member@example.com"));
    await directory.inviteMember(organization.id, "member@example.com", "owner", admin);
    const accepted = await directory.listMembers(organization.id, admin);
    expect(accepted.members).toEqual(expect.arrayContaining([expect.objectContaining({ email: "member@example.com", role: "owner", status: "accepted" })]));
    expect(accepted.invitations.some((item) => item.email === "member@example.com")).toBe(false);
  });
  it("allows only an organisation owner to delete an organisation", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    const directory = new DirectoryService(new MemoryDirectoryBackend());
    const admin = user("admin@example.com");
    const editor = user("editor@example.com");
    await directory.createPlatformInvitation(editor.email, admin);
    await directory.resolveUser(editor);
    const organization = await directory.createOrganization("Private Portfolio", admin);
    await directory.inviteMember(organization.id, editor.email, "editor", admin);

    await expect(directory.deleteOrganization(organization.id, organization.name, editor, async () => ({ deletedRecordCount: 0, deletedBlobCount: 0, blobCleanupFailures: 0 }))).rejects.toMatchObject({ code: "owner_required" });
  });
  it("binds an accepted invitation to the immutable Microsoft provider identity", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    const directory = new DirectoryService(new MemoryDirectoryBackend());
    await directory.createPlatformInvitation("member@example.com", user("admin@example.com"));
    await directory.resolveUser({ userId: "microsoft-object-one", email: "member@example.com", roles: ["authenticated"] });
    await expect(directory.resolveUser({ userId: "microsoft-object-two", email: "member@example.com", roles: ["authenticated"] })).rejects.toMatchObject({ code: "identity_mismatch" });
  });
  it("gives a super admin owner-equivalent access without weakening editor boundaries", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    const directory = new DirectoryService(new MemoryDirectoryBackend());
    const admin = user("admin@example.com");
    const owner = user("owner@example.com");
    const editor = user("editor@example.com");
    await directory.createPlatformInvitation(owner.email, admin);
    await directory.createPlatformInvitation(editor.email, admin);
    await directory.resolveUser(owner);
    await directory.resolveUser(editor);
    const organization = await directory.createOrganization("Owner Portfolio", owner);
    await directory.inviteMember(organization.id, editor.email, "editor", owner);

    await expect(directory.authorize(admin, organization.id, true)).resolves.toMatchObject({
      isPlatformAdmin: true,
      organizationRole: "owner",
    });
    await expect(directory.authorize(editor, organization.id, true)).rejects.toMatchObject({ code: "owner_required" });
  });
  it("recognises both configured bootstrap super administrators", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin-two@example.com, admin-one@example.com";
    const directory = new DirectoryService(new MemoryDirectoryBackend());
    const firstAdmin = user("admin-two@example.com");
    const secondAdmin = user("admin-one@example.com");
    const organization = await directory.createOrganization("Shared Portfolio", firstAdmin);

    await expect(directory.resolveUser(firstAdmin)).resolves.toMatchObject({ user: { isPlatformAdmin: true } });
    await expect(directory.resolveUser(secondAdmin)).resolves.toMatchObject({
      user: { isPlatformAdmin: true },
      organizations: [expect.objectContaining({ id: organization.id, role: "owner" })],
    });
  });
});
