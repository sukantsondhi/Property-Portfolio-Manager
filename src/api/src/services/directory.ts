import { CosmosClient, type Container } from "@azure/cosmos";
import { createHash, randomUUID } from "node:crypto";
import type { AuthenticatedUser, OrganizationRole, OrganizationSummary } from "../domain/types";
import { getCredential } from "./credential";
import { StoreError } from "./responses";

const PLATFORM_PARTITION = "_platform";

type DirectoryKind = "platformUser" | "platformInvitation" | "organization" | "organizationMembership" | "organizationInvitation" | "reminderDelivery" | "auditEvent";
type DirectoryRecord = {
  id: string;
  organizationId: typeof PLATFORM_PARTITION;
  kind: DirectoryKind;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const invitationId = (scope: "platform" | "organization", email: string, organizationId = "") =>
  `${scope}-invite-${createHash("sha256").update(`${organizationId}\n${normalizeEmail(email)}`).digest("hex")}`;
const adminEmails = () => new Set((process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean));

interface DirectoryBackend {
  all(): Promise<DirectoryRecord[]>;
  put(record: DirectoryRecord): Promise<DirectoryRecord>;
  remove(id: string): Promise<void>;
}

export class MemoryDirectoryBackend implements DirectoryBackend {
  private records = new Map<string, DirectoryRecord>();
  async all() { return [...this.records.values()]; }
  async put(record: DirectoryRecord) { this.records.set(record.id, record); return record; }
  async remove(id: string) { this.records.delete(id); }
}

class CosmosDirectoryBackend implements DirectoryBackend {
  private container: Container;
  constructor() {
    const endpoint = process.env.COSMOS_ENDPOINT;
    if (!endpoint) throw new Error("COSMOS_ENDPOINT is required.");
    const key = process.env.COSMOS_KEY;
    const client = new CosmosClient(key ? { endpoint, key } : { endpoint, aadCredentials: getCredential() });
    this.container = client.database(process.env.COSMOS_DATABASE ?? "portfolio").container(process.env.COSMOS_CONTAINER ?? "records");
  }
  async all() {
    const { resources } = await this.container.items.query<DirectoryRecord>(
      { query: "SELECT * FROM c WHERE c.organizationId = @organizationId", parameters: [{ name: "@organizationId", value: PLATFORM_PARTITION }] },
      { partitionKey: PLATFORM_PARTITION },
    ).fetchAll();
    return resources;
  }
  async put(record: DirectoryRecord) { return (await this.container.items.upsert(record)).resource as unknown as DirectoryRecord; }
  async remove(id: string) { await this.container.item(id, PLATFORM_PARTITION).delete(); }
}

export class DirectoryService {
  constructor(private backend: DirectoryBackend) {}

  private async records(kind?: DirectoryKind) {
    const records = await this.backend.all();
    return kind ? records.filter((record) => record.kind === kind) : records;
  }
  private async audit(action: string, actor: AuthenticatedUser, details: Record<string, unknown>) {
    const now = new Date().toISOString();
    await this.backend.put({ id: randomUUID(), organizationId: PLATFORM_PARTITION, kind: "auditEvent", action, actorUserId: actor.userId, actorEmail: actor.email, details, createdAt: now, updatedAt: now });
  }
  private async activeUserForEmail(email: string) {
    return (await this.records("platformUser")).find((record) => record.email === normalizeEmail(email) && record.status === "active");
  }

  async resolveUser(identity: AuthenticatedUser): Promise<{ user: AuthenticatedUser; organizations: OrganizationSummary[] }> {
    const email = normalizeEmail(identity.email);
    const bootstrapAdmin = adminEmails().has(email);
    const now = new Date().toISOString();
    const records = await this.records();
    let platformUser = records.find((record) => record.kind === "platformUser" && record.providerUserId === identity.userId && record.status === "active");
    if (!platformUser) {
      const emailUser = records.find((record) => record.kind === "platformUser" && record.email === email && record.status === "active");
      const invitation = records.find((record) => record.kind === "platformInvitation" && record.email === email && record.status === "pending" && String(record.expiresAt) > now);
      if (!bootstrapAdmin && !emailUser && !invitation) throw new StoreError(403, "invitation_required", "This platform is invitation only. Ask the administrator for access.");
      platformUser = emailUser ?? {
        id: randomUUID(), organizationId: PLATFORM_PARTITION, kind: "platformUser", email, status: "active", createdAt: now, updatedAt: now,
      };
      if (platformUser.providerUserId && platformUser.providerUserId !== identity.userId) throw new StoreError(403, "identity_mismatch", "This invitation is already bound to another Microsoft identity.");
      platformUser = await this.backend.put({ ...platformUser, providerUserId: identity.userId, updatedAt: now });
      if (invitation) await this.backend.put({ ...invitation, status: "accepted", acceptedAt: now, acceptedUserId: platformUser.id, updatedAt: now });
    }

    const pendingOrgInvites = records.filter((record) => record.kind === "organizationInvitation" && record.email === email && record.status === "pending" && String(record.expiresAt) > now);
    for (const invitation of pendingOrgInvites) {
      const existing = records.find((record) => record.kind === "organizationMembership" && record.platformUserId === platformUser.id && record.targetOrganizationId === invitation.targetOrganizationId && record.status === "active");
      if (!existing) await this.backend.put({ id: randomUUID(), organizationId: PLATFORM_PARTITION, kind: "organizationMembership", platformUserId: platformUser.id, targetOrganizationId: invitation.targetOrganizationId, role: invitation.role, status: "active", createdAt: now, updatedAt: now });
      await this.backend.put({ ...invitation, status: "accepted", acceptedAt: now, updatedAt: now });
    }

    const refreshed = await this.records();
    const memberships = refreshed.filter((record) => record.kind === "organizationMembership" && record.platformUserId === platformUser!.id && record.status === "active");
    const organizations = refreshed.filter((record) => record.kind === "organization" && record.status === "active");
    const isPlatformAdmin = bootstrapAdmin || platformUser.isPlatformAdmin === true;
    const organizationAccess = isPlatformAdmin
      ? organizations.map((organization) => ({ id: organization.id, name: String(organization.name), role: "owner" as const }))
      : memberships.flatMap((membership) => {
          const organization = organizations.find((candidate) => candidate.id === membership.targetOrganizationId);
          return organization ? [{ id: organization.id, name: String(organization.name), role: membership.role as OrganizationRole }] : [];
        });
    return {
      user: { ...identity, email, isPlatformAdmin },
      organizations: organizationAccess.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async createOrganization(name: string, identity: AuthenticatedUser) {
    const session = await this.resolveUser(identity);
    const platformUser = await this.activeUserForEmail(session.user.email);
    if (!platformUser) throw new StoreError(403, "invitation_required", "Platform access is required.");
    const now = new Date().toISOString();
    const organization = await this.backend.put({ id: randomUUID(), organizationId: PLATFORM_PARTITION, kind: "organization", name: name.trim(), status: "active", createdBy: platformUser.id, createdAt: now, updatedAt: now });
    await this.backend.put({ id: randomUUID(), organizationId: PLATFORM_PARTITION, kind: "organizationMembership", platformUserId: platformUser.id, targetOrganizationId: organization.id, role: "owner", status: "active", createdAt: now, updatedAt: now });
    await this.audit("organization.created", session.user, { organizationId: organization.id });
    return { id: organization.id, name: organization.name, role: "owner" as const };
  }

  async authorize(identity: AuthenticatedUser, organizationId: string, ownerOnly = false) {
    if (!organizationId) throw new StoreError(400, "organization_required", "Select an organisation first.");
    const session = await this.resolveUser(identity);
    const organization = session.organizations.find((item) => item.id === organizationId);
    if (!organization) throw new StoreError(404, "organization_not_found", "Organisation not found.");
    if (ownerOnly && organization.role !== "owner") throw new StoreError(403, "owner_required", "Organisation owner access is required.");
    return { ...session.user, organizationId, organizationRole: organization.role };
  }

  async createPlatformInvitation(email: string, actor: AuthenticatedUser) {
    const session = await this.resolveUser(actor);
    if (!session.user.isPlatformAdmin) throw new StoreError(403, "admin_required", "Platform administrator access is required.");
    const normalized = normalizeEmail(email);
    const activeUser = await this.activeUserForEmail(normalized);
    if (activeUser) return { id: activeUser.id, email: normalized, status: "accepted", acceptedAt: activeUser.createdAt, existing: true };
    const matching = (await this.records("platformInvitation")).filter((record) => record.email === normalized && record.revokedReason !== "superseded").sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const [existing, ...duplicates] = matching;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    for (const duplicate of duplicates) await this.backend.put({ ...duplicate, status: "revoked", revokedReason: "superseded", supersededBy: existing?.id, updatedAt: now });
    const invitation = await this.backend.put({ ...(existing ?? { id: invitationId("platform", normalized), organizationId: PLATFORM_PARTITION, kind: "platformInvitation", createdAt: now }), email: normalized, status: "pending", expiresAt, invitedBy: session.user.userId, updatedAt: now });
    await this.audit("platform.invited", session.user, { invitationId: invitation.id, email: normalized });
    return { ...invitation, existing: existing?.status === "pending" };
  }

  async listPlatformInvitations(actor: AuthenticatedUser) {
    const session = await this.resolveUser(actor);
    if (!session.user.isPlatformAdmin) throw new StoreError(403, "admin_required", "Platform administrator access is required.");
    const records = await this.records();
    const invitations = records.filter((record) => record.kind === "platformInvitation" && record.revokedReason !== "superseded").sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const byEmail = new Map<string, DirectoryRecord>();
    for (const invitation of invitations) if (!byEmail.has(String(invitation.email))) byEmail.set(String(invitation.email), invitation);
    for (const user of records.filter((record) => record.kind === "platformUser" && record.status === "active")) {
      const email = String(user.email);
      const invitation = byEmail.get(email);
      byEmail.set(email, { ...(invitation ?? user), id: user.id, email, status: "accepted", acceptedAt: invitation?.acceptedAt ?? user.createdAt, isPlatformAdmin: adminEmails().has(email) || user.isPlatformAdmin === true });
    }
    return [...byEmail.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async revokePlatformInvitation(id: string, actor: AuthenticatedUser) {
    const session = await this.resolveUser(actor);
    if (!session.user.isPlatformAdmin) throw new StoreError(403, "admin_required", "Platform administrator access is required.");
    const invitation = (await this.records("platformInvitation")).find((record) => record.id === id);
    if (!invitation) throw new StoreError(404, "invitation_not_found", "Invitation not found.");
    await this.backend.put({ ...invitation, status: "revoked", updatedAt: new Date().toISOString() });
    await this.audit("platform.invitation_revoked", session.user, { invitationId: id });
  }

  async setPlatformAdmin(email: string, enabled: boolean, actor: AuthenticatedUser) {
    const session = await this.resolveUser(actor);
    if (!session.user.isPlatformAdmin) throw new StoreError(403, "admin_required", "Super administrator access is required.");
    const normalized = normalizeEmail(email);
    const target = await this.activeUserForEmail(normalized);
    if (!target) throw new StoreError(409, "platform_user_required", "Add this Microsoft account to the platform before granting super-admin access.");
    if (!enabled && adminEmails().has(normalized)) throw new StoreError(409, "bootstrap_admin", "A bootstrap super administrator must be changed in secure server configuration.");
    if (!enabled && normalized === session.user.email) throw new StoreError(409, "self_admin_removal", "A super administrator cannot remove their own access.");
    const now = new Date().toISOString();
    await this.backend.put({ ...target, isPlatformAdmin: enabled, updatedAt: now });
    await this.audit(enabled ? "platform.admin_granted" : "platform.admin_revoked", session.user, { targetUserId: target.id, email: normalized });
    return { id: target.id, email: normalized, isPlatformAdmin: enabled };
  }

  async deactivatePlatformUser(id: string, actor: AuthenticatedUser) {
    const session = await this.resolveUser(actor);
    if (!session.user.isPlatformAdmin) throw new StoreError(403, "admin_required", "Super administrator access is required.");
    const records = await this.records();
    const target = records.find((record) => record.kind === "platformUser" && record.id === id && record.status === "active");
    if (!target) throw new StoreError(404, "platform_user_not_found", "Platform user not found.");
    const email = String(target.email);
    if (adminEmails().has(email) || target.isPlatformAdmin === true) throw new StoreError(409, "admin_user", "Remove super-admin access before removing this platform user.");
    if (email === session.user.email) throw new StoreError(409, "self_removal", "You cannot remove your own platform access.");
    const targetMemberships = records.filter((record) => record.kind === "organizationMembership" && record.platformUserId === id && record.status === "active");
    for (const membership of targetMemberships.filter((record) => record.role === "owner")) {
      const ownerCount = records.filter((record) => record.kind === "organizationMembership" && record.targetOrganizationId === membership.targetOrganizationId && record.role === "owner" && record.status === "active").length;
      if (ownerCount === 1) throw new StoreError(409, "last_owner", "Transfer ownership or delete the organisation before removing its only owner from the platform.");
    }
    const now = new Date().toISOString();
    await this.backend.put({ ...target, status: "inactive", deactivatedAt: now, deactivatedBy: session.user.email, updatedAt: now });
    for (const membership of targetMemberships)
      await this.backend.put({ ...membership, status: "revoked", revokedReason: "platform_user_removed", revokedAt: now, updatedAt: now });
    await this.audit("platform.user_removed", session.user, { targetUserId: id, email });
  }

  async organizationOwnerEmails(organizationId: string) {
    const records = await this.records();
    const ownerIds = new Set(records.filter((record) => record.kind === "organizationMembership" && record.targetOrganizationId === organizationId && record.role === "owner" && record.status === "active").map((record) => String(record.platformUserId)));
    return records.filter((record) => record.kind === "platformUser" && ownerIds.has(record.id) && record.status === "active").map((record) => String(record.email));
  }

  async organizationBackupTargets(organizationId: string) {
    const records = await this.records();
    const organization = records.find((record) => record.kind === "organization" && record.id === organizationId && record.status === "active");
    if (!organization) throw new StoreError(404, "organization_not_found", "Organisation not found.");
    return { name: String(organization.name), recipients: await this.organizationOwnerEmails(organizationId) };
  }

  async listMembers(organizationId: string, actor: AuthenticatedUser) {
    await this.authorize(actor, organizationId, true);
    const records = await this.records();
    const users = records.filter((record) => record.kind === "platformUser");
    const members = records.filter((record) => record.kind === "organizationMembership" && record.targetOrganizationId === organizationId && record.status === "active").map((membership) => {
      const user = users.find((candidate) => candidate.id === membership.platformUserId);
      return { id: membership.id, email: String(user?.email ?? "Unknown user"), role: membership.role as OrganizationRole, status: "accepted" as const, acceptedAt: membership.createdAt };
    });
    const memberEmails = new Set(members.map((member) => member.email));
    const invitationRecords = records.filter((record) => record.kind === "organizationInvitation" && record.targetOrganizationId === organizationId && record.revokedReason !== "superseded").sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const latestByEmail = new Map<string, DirectoryRecord>();
    for (const invitation of invitationRecords) if (!latestByEmail.has(String(invitation.email))) latestByEmail.set(String(invitation.email), invitation);
    const invitations = [...latestByEmail.values()].filter((record) => !memberEmails.has(String(record.email))).map((record) => ({ id: record.id, email: record.email, role: record.role, status: record.status, expiresAt: record.expiresAt, acceptedAt: record.acceptedAt, updatedAt: record.updatedAt }));
    return { members, invitations };
  }

  async inviteMember(organizationId: string, email: string, role: OrganizationRole, actor: AuthenticatedUser) {
    const authorized = await this.authorize(actor, organizationId, true);
    const organization = (await this.records("organization")).find((record) => record.id === organizationId && record.status === "active");
    if (!organization) throw new StoreError(404, "organization_not_found", "Organisation not found.");
    const organizationName = String(organization.name);
    const normalized = normalizeEmail(email);
    const target = await this.activeUserForEmail(normalized);
    if (!target) throw new StoreError(409, "platform_user_required", "A super administrator must add this Microsoft account to the platform before it can join an organisation.");
    const now = new Date().toISOString();
    const invitationRecords = (await this.records("organizationInvitation")).filter((record) => record.targetOrganizationId === organizationId && record.email === normalized && record.revokedReason !== "superseded").sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const [invitationRecord, ...duplicates] = invitationRecords;
    for (const duplicate of duplicates) await this.backend.put({ ...duplicate, status: "revoked", revokedReason: "superseded", supersededBy: invitationRecord?.id, updatedAt: now });
    if (target) {
      const existing = (await this.records("organizationMembership")).find((record) => record.platformUserId === target.id && record.targetOrganizationId === organizationId && record.status === "active");
      if (existing) return { status: "accepted", id: existing.id, existing: true, role: existing.role, organizationName };
      const membership = await this.backend.put({ id: randomUUID(), organizationId: PLATFORM_PARTITION, kind: "organizationMembership", platformUserId: target.id, targetOrganizationId: organizationId, role, status: "active", createdAt: now, updatedAt: now });
      await this.backend.put({ ...(invitationRecord ?? { id: invitationId("organization", normalized, organizationId), organizationId: PLATFORM_PARTITION, kind: "organizationInvitation", targetOrganizationId: organizationId, email: normalized, createdAt: now }), role, status: "accepted", acceptedAt: now, acceptedUserId: target.id, invitedBy: authorized.userId, updatedAt: now });
      await this.audit("organization.member_added", authorized, { organizationId, email: normalized, role });
      return { status: "accepted", id: membership.id, existing: false, role, organizationName };
    }
    throw new StoreError(409, "platform_user_required", "Platform access is required before organisation membership can be granted.");
  }

  async deleteOrganization(
    organizationId: string,
    confirmationName: string,
    actor: AuthenticatedUser,
    cleanup: () => Promise<{ deletedRecordCount: number; deletedBlobCount: number; blobCleanupFailures: number }>,
  ) {
    const authorized = await this.authorize(actor, organizationId, true);
    const records = await this.records();
    const organization = records.find((record) => record.kind === "organization" && record.id === organizationId && record.status === "active");
    if (!organization) throw new StoreError(404, "organization_not_found", "Organisation not found.");
    const organizationName = String(organization.name);
    if (confirmationName.trim() !== organizationName)
      throw new StoreError(400, "confirmation_mismatch", "Type the exact organisation name to confirm permanent deletion.");

    const cleanupResult = await cleanup();
    const users = records.filter((record) => record.kind === "platformUser");
    const notificationRecipients = records
      .filter((record) => record.kind === "organizationMembership" && record.targetOrganizationId === organizationId && record.status === "active")
      .flatMap((membership) => {
        const user = users.find((candidate) => candidate.id === membership.platformUserId);
        return user && user.email !== authorized.email ? [String(user.email)] : [];
      });
    const now = new Date().toISOString();
    await this.backend.put({ ...organization, status: "deleted", deletedAt: now, deletedBy: authorized.email, updatedAt: now });
    for (const membership of records.filter((record) => record.kind === "organizationMembership" && record.targetOrganizationId === organizationId && record.status === "active"))
      await this.backend.put({ ...membership, status: "revoked", revokedReason: "organization_deleted", revokedAt: now, updatedAt: now });
    for (const invitation of records.filter((record) => record.kind === "organizationInvitation" && record.targetOrganizationId === organizationId && record.status !== "revoked"))
      await this.backend.put({ ...invitation, status: "revoked", revokedReason: "organization_deleted", revokedAt: now, updatedAt: now });
    await this.audit("organization.deleted", authorized, { organizationId, organizationName, ...cleanupResult });
    return { id: organizationId, name: organizationName, notificationRecipients, ...cleanupResult };
  }

  async removeMembership(organizationId: string, membershipId: string, actor: AuthenticatedUser) {
    const authorized = await this.authorize(actor, organizationId, true);
    const memberships = (await this.records("organizationMembership")).filter((record) => record.targetOrganizationId === organizationId && record.status === "active");
    const target = memberships.find((record) => record.id === membershipId);
    if (!target) throw new StoreError(404, "member_not_found", "Member not found.");
    if (target.role === "owner" && memberships.filter((record) => record.role === "owner").length === 1) throw new StoreError(409, "last_owner", "An organisation must retain at least one owner.");
    const now = new Date().toISOString();
    await this.backend.put({ ...target, status: "revoked", updatedAt: now });
    const user = (await this.records("platformUser")).find((record) => record.id === target.platformUserId);
    if (user) {
      const invitation = (await this.records("organizationInvitation")).filter((record) => record.targetOrganizationId === organizationId && record.email === user.email && record.revokedReason !== "superseded").sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      if (invitation) await this.backend.put({ ...invitation, status: "revoked", revokedAt: now, updatedAt: now });
    }
    await this.audit("organization.member_removed", authorized, { organizationId, membershipId });
  }

  async reminderTargets() {
    const records = await this.records();
    const users = records.filter((record) => record.kind === "platformUser" && record.status === "active");
    const organizations = records.filter((record) => record.kind === "organization" && record.status === "active");
    return organizations.map((organization) => ({
      id: organization.id,
      name: String(organization.name),
      recipients: records.filter((record) => record.kind === "organizationMembership" && record.targetOrganizationId === organization.id && record.status === "active").flatMap((membership) => {
        const user = users.find((candidate) => candidate.id === membership.platformUserId);
        return user ? [String(user.email)] : [];
      }),
    }));
  }

  async hasReminderDelivery(key: string) { return (await this.records("reminderDelivery")).some((record) => record.deliveryKey === key); }
  async recordReminderDelivery(key: string, details: Record<string, unknown>) {
    const now = new Date().toISOString();
    await this.backend.put({ id: randomUUID(), organizationId: PLATFORM_PARTITION, kind: "reminderDelivery", deliveryKey: key, ...details, createdAt: now, updatedAt: now });
  }
}

let service: DirectoryService | undefined;
export function getDirectory() {
  service ??= new DirectoryService(process.env.DATA_BACKEND === "memory" ? new MemoryDirectoryBackend() : new CosmosDirectoryBackend());
  return service;
}
export function resetDirectoryForTests() { service = undefined; }
