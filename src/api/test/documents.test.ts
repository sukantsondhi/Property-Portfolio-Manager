import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { readUploadBody, resolveDocumentTarget, retiredDocumentUpload, uploadDocument } from "../src/functions/documents";
import * as blobs from "../src/services/blobs";
import { assertFileSignature, buildBlobName, downloadSas } from "../src/services/blobs";
import { getStore, maxOrganizationDocumentBytes, MemoryStore, setStoreForTests } from "../src/services/store";
import { getDirectory, resetDirectoryForTests } from "../src/services/directory";
import type { AuthenticatedUser } from "../src/domain/types";

const user: AuthenticatedUser = {
  userId: "one",
  email: "one@example.com",
  roles: ["portfolio_user"],
};

function uploadRequestFor(organizationId: string, metadata: Record<string, unknown>, content: Buffer, actor = user) {
  return new HttpRequest({
    method: "POST", url: "http://localhost/api/documents/upload",
    headers: {
      "content-type": String(metadata.mimeType),
      "x-document-metadata": encodeURIComponent(JSON.stringify(metadata)),
      "x-organization-id": organizationId,
      "x-ms-client-principal": Buffer.from(JSON.stringify({ identityProvider: "aad", userId: actor.userId, userDetails: actor.email, userRoles: ["authenticated"] })).toString("base64"),
    },
    body: { bytes: content },
  });
}

async function uploadFixture() {
  process.env.DATA_BACKEND = "memory";
  process.env.PLATFORM_ADMIN_EMAILS = user.email;
  process.env.DOCUMENT_UPLOADS_ENABLED = "true";
  const organization = await getDirectory().createOrganization("Upload Portfolio", user);
  const store = getStore(organization.id);
  const property = await store.create("property", { name: "House" }, user);
  const metadata = { propertyId: property.id, fileName: "audit.pdf", mimeType: "application/pdf", size: 8, category: "evidence" };
  return { organization, store, property, metadata };
}

describe("document security", () => {
  it("uploads through the authorised API without issuing browser write credentials", async () => {
    const { organization, store, metadata } = await uploadFixture();
    const writer = vi.spyOn(blobs, "uploadBlob").mockResolvedValue(undefined);
    const deleter = vi.spyOn(blobs, "deleteBlob").mockResolvedValue({ succeeded: true } as Awaited<ReturnType<typeof blobs.deleteBlob>>);
    const result = await uploadDocument(uploadRequestFor(organization.id, { ...metadata, blobName: "arbitrary/old.pdf", documentId: "old" }, Buffer.from("%PDF-1.7")));
    expect(result).toMatchObject({ status: 201, jsonBody: { kind: "document", archived: false, size: 8 } });
    expect(result.jsonBody).not.toHaveProperty("url");
    expect(writer).toHaveBeenCalledOnce();
    expect(writer.mock.calls[0][0]).toMatch(new RegExp(`^org/${organization.id}/${metadata.propertyId}/evidence/`));
    expect(deleter).not.toHaveBeenCalled();
    expect(await store.list("document")).toHaveLength(1);
    const retired = await retiredDocumentUpload(uploadRequestFor(organization.id, metadata, Buffer.from("%PDF-1.7")));
    expect(retired).toMatchObject({ status: 410, jsonBody: { error: { code: "upload_workflow_changed" } } });
    expect(deleter).not.toHaveBeenCalled();
  });
  it("rejects spoofed bytes before writing storage and releases the reservation", async () => {
    const { organization, store, metadata } = await uploadFixture();
    const writer = vi.spyOn(blobs, "uploadBlob").mockResolvedValue(undefined);
    vi.spyOn(blobs, "deleteBlob").mockResolvedValue({ succeeded: true } as Awaited<ReturnType<typeof blobs.deleteBlob>>);
    const result = await uploadDocument(uploadRequestFor(organization.id, metadata, Buffer.from("invalid!")));
    expect(result).toMatchObject({ status: 400, jsonBody: { error: { code: "invalid_file_signature" } } });
    expect(writer).not.toHaveBeenCalled();
    expect(await store.list("document", { archived: true })).toHaveLength(0);
  });
  it("does not finalise an upload after the member is revoked", async () => {
    const { organization, store, metadata } = await uploadFixture();
    const editor = { ...user, userId: "editor", email: "editor@example.com" };
    await getDirectory().createPlatformInvitation(editor.email, user);
    await getDirectory().resolveUser(editor);
    const membership = await getDirectory().inviteMember(organization.id, editor.email, "editor", user);
    vi.spyOn(blobs, "uploadBlob").mockImplementation(async () => { await getDirectory().removeMembership(organization.id, membership.id, user); });
    const deleter = vi.spyOn(blobs, "deleteBlob").mockResolvedValue({ succeeded: true } as Awaited<ReturnType<typeof blobs.deleteBlob>>);
    const result = await uploadDocument(uploadRequestFor(organization.id, metadata, Buffer.from("%PDF-1.7"), editor));
    expect(result).toMatchObject({ status: 404, jsonBody: { error: { code: "organization_not_found" } } });
    expect(deleter).toHaveBeenCalledOnce();
    expect(await store.list("document")).toHaveLength(0);
  });
  it("writes blobs create-only and refuses downloads larger than their byte budget", async () => {
    process.env.STORAGE_ACCOUNT_NAME = "testaccount";
    process.env.STORAGE_ACCOUNT_KEY = Buffer.alloc(32, 7).toString("base64");
    const uploadData = vi.fn().mockResolvedValue(undefined);
    const downloadToBuffer = vi.fn();
    vi.spyOn(BlobServiceClient.prototype, "getContainerClient").mockReturnValue({
      getBlockBlobClient: () => ({ uploadData }),
      getBlobClient: () => ({ getProperties: async () => ({ contentLength: 9, etag: "version" }), downloadToBuffer }),
    } as unknown as ReturnType<BlobServiceClient["getContainerClient"]>);
    await blobs.uploadBlob("org/test/new.pdf", "application/pdf", Buffer.from("%PDF-1.7"));
    expect(uploadData).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ conditions: { ifNoneMatch: "*" } }));
    await expect(blobs.downloadBlobBuffer("org/test/old.pdf", 8)).rejects.toMatchObject({ code: "download_too_large" });
    expect(downloadToBuffer).not.toHaveBeenCalled();
  });
  it("reserves document capacity atomically under concurrent requests", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    await store.create("document", { propertyId: property.id, size: maxOrganizationDocumentBytes - 8 }, user);
    const data = { propertyId: property.id, size: 8, blobName: "org/test/new.pdf" };
    const results = await Promise.allSettled([store.reserveDocumentUpload("one", data, user), store.reserveDocumentUpload("two", data, user)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(store.reserveDocumentUpload("three", data, user)).rejects.toMatchObject({ code: "document_quota" });
  });
  it("bounds streamed upload bytes independently of the declared file size", async () => {
    const body = () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from("%PDF-1.7")); controller.close(); } });
    await expect(readUploadBody(body(), 8)).resolves.toEqual(Buffer.from("%PDF-1.7"));
    await expect(readUploadBody(body(), 7)).rejects.toMatchObject({ status: 413 });
    await expect(readUploadBody(body(), 9)).rejects.toMatchObject({ code: "invalid_upload" });
    await expect(readUploadBody(body(), 25 * 1024 * 1024 + 1)).rejects.toMatchObject({ code: "invalid_upload" });
  });
  it("binds pending uploads to their actor and never cleans up a completed document", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const pending = await store.reserveDocumentUpload("upload-one", { propertyId: property.id, size: 8, blobName: "org/test/upload-one.pdf" }, user);
    expect(await store.list("document")).toHaveLength(0);
    await expect(store.completeDocumentUpload(pending, { ...user, userId: "other" })).rejects.toMatchObject({ code: "upload_conflict" });
    const completed = await store.completeDocumentUpload(pending, user);
    expect(completed).toMatchObject({ archived: false });
    expect(completed).not.toHaveProperty("uploadState");
    const deleter = vi.fn();
    await store.abandonDocumentUpload(pending, user, deleter);
    expect(deleter).not.toHaveBeenCalled();
    await expect(store.completeDocumentUpload(pending, user)).rejects.toMatchObject({ code: "upload_conflict" });
  });
  it("limits pending uploads and keeps failed cleanup accounted for", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const data = { propertyId: property.id, size: 8, blobName: "org/test/pending.pdf" };
    const first = await store.reserveDocumentUpload("one", data, user);
    await store.reserveDocumentUpload("two", data, user);
    await store.reserveDocumentUpload("three", data, user);
    await expect(store.reserveDocumentUpload("four", data, user)).rejects.toMatchObject({ code: "upload_limit" });
    await expect(store.abandonDocumentUpload(first, user, vi.fn().mockRejectedValue(new Error("synthetic storage failure")))).rejects.toThrow("synthetic storage failure");
    expect(await store.get("document", first.id)).toMatchObject({ uploadState: "failed", archived: true });
    await store.abandonDocumentUpload(first, user, vi.fn().mockResolvedValue(undefined));
    await expect(store.reserveDocumentUpload("four", data, user)).resolves.toMatchObject({ uploadState: "pending" });
  });
  it("does not finalise an upload after its rental year closes", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const year = await store.create("rentalYear", { propertyId: property.id, status: "current" }, user);
    const pending = await store.reserveDocumentUpload("upload-one", { propertyId: property.id, size: 8, blobName: "org/test/upload-one.pdf" }, user);
    await store.update("rentalYear", year.id, { status: "closed" }, user, year._etag);
    await expect(store.completeDocumentUpload(pending, user)).rejects.toMatchObject({ code: "historical_record" });
    await store.abandonDocumentUpload(pending, user, vi.fn().mockResolvedValue(undefined));
    await expect(store.get("document", pending.id)).rejects.toMatchObject({ status: 404 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetDirectoryForTests();
    setStoreForTests();
    delete process.env.DATA_BACKEND;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.DOCUMENT_UPLOADS_ENABLED;
    delete process.env.STORAGE_ACCOUNT_NAME;
    delete process.env.STORAGE_ACCOUNT_KEY;
    delete process.env.STORAGE_CONTAINER;
    delete process.env.STORAGE_BLOB_ENDPOINT;
  });

  it.each([
    ["lease.pdf", "application/pdf", Buffer.from("%PDF-1.7\n%dummy")],
    ["house.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    ["photo.jpeg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
    ["cover.webp", "image/webp", Buffer.from("RIFF0000WEBPdummy")],
    ["tenancy.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("dummy word/document.xml")])],
    ["finances.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("dummy xl/workbook.xml")])],
  ])("accepts a matching %s signature", (fileName, mimeType, content) => {
    expect(() => assertFileSignature(fileName, mimeType, content)).not.toThrow();
  });

  it("rejects spoofed content and extension mismatches", () => {
    expect(() => assertFileSignature("malware.pdf", "application/pdf", Buffer.from("MZ executable"))).toThrowError(expect.objectContaining({ code: "invalid_file_signature" }));
    expect(() => assertFileSignature("photo.pdf", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toThrowError(expect.objectContaining({ code: "file_extension_mismatch" }));
  });

  it("forces authenticated download grants to use attachment headers", async () => {
    process.env.STORAGE_ACCOUNT_NAME = "testaccount";
    process.env.STORAGE_ACCOUNT_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.STORAGE_CONTAINER = "documents";

    const grant = await downloadSas(
      "portfolio/property/finance/document/report.pdf",
      "Annual Report.pdf",
      "application/pdf",
    );
    const url = new URL(grant.url);
    expect(url.searchParams.get("sp")).toBe("r");
    expect(url.searchParams.get("rscd")).toBe(
      'attachment; filename="Annual-Report.pdf"',
    );
    expect(url.searchParams.get("rsct")).toBe("application/pdf");
    expect(url.searchParams.get("rscc")).toBe("private, no-store");
  });

  it("requires the selected tenant to belong to the document property", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const otherProperty = await store.create(
      "property",
      { name: "Other House" },
      user,
    );
    const tenant = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Alex" },
      user,
    );

    await expect(
      resolveDocumentTarget(store, {
        propertyId: otherProperty.id,
        tenantId: tenant.id,
        category: "tenancy",
        fileName: "agreement.pdf",
        mimeType: "application/pdf",
        size: 100,
      }),
    ).rejects.toMatchObject({ status: 400, code: "target_mismatch" });
  });

  it("derives and validates a tenant's owning property", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const tenant = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Alex" },
      user,
    );
    await expect(
      resolveDocumentTarget(store, {
        tenantId: tenant.id,
        category: "identity",
        fileName: "id.pdf",
        mimeType: "application/pdf",
        size: 100,
      }),
    ).resolves.toEqual({ propertyId: property.id, tenantId: tenant.id });
    expect(
      buildBlobName(
        "11111111-1111-4111-8111-111111111111",
        property.id,
        "identity",
        "My ID.pdf",
      ),
    ).toContain("/identity/11111111-1111-4111-8111-111111111111/My-ID.pdf");
  });

  it("allows uploads only while a historical rental year is explicitly restored", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "History House" }, user);
    const year = await store.create("rentalYear", { propertyId: property.id, label: "2025/26", annualRentPence: 1_200_000, status: "current" }, user);
    const closed = await store.update("rentalYear", year.id, { status: "closed" }, user, year._etag);
    const input = { propertyId: property.id, rentalYearId: year.id, category: "tenancy", fileName: "agreement.pdf", mimeType: "application/pdf", size: 100 };
    await expect(resolveDocumentTarget(store, input)).rejects.toMatchObject({ status: 409, code: "historical_target" });
    await store.restoreRentalYear(property.id, year.id, user, closed._etag);
    await expect(resolveDocumentTarget(store, input)).resolves.toEqual({ propertyId: property.id, tenantId: "", rentalYearId: year.id });
  });
});
