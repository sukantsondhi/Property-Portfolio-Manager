import { afterEach, describe, expect, it } from "vitest";
import { resolveDocumentTarget } from "../src/functions/documents";
import { assertFileSignature, buildBlobName, downloadSas } from "../src/services/blobs";
import { MemoryStore } from "../src/services/store";
import type { AuthenticatedUser } from "../src/domain/types";

const user: AuthenticatedUser = {
  userId: "one",
  email: "one@example.com",
  roles: ["portfolio_user"],
};

describe("document security", () => {
  afterEach(() => {
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
