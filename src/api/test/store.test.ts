import { describe, expect, it, vi } from "vitest";
import type { Container } from "@azure/cosmos";
import { CosmosStore, MemoryStore } from "../src/services/store";
import type { AuthenticatedUser, PortfolioRecord } from "../src/domain/types";

const user: AuthenticatedUser = {
  userId: "one",
  email: "one@example.com",
  roles: ["portfolio_user"],
};

describe("record store", () => {
  it("retains pending blob cleanup after metadata deletion and recognises a retry", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    await store.create("document", { propertyId: property.id, blobName: "org/test/evidence.pdf", size: 8 }, user);
    const archived = await store.setArchived("property", property.id, true, user, property._etag);
    const deleted = await store.permanentDelete("property", property.id, archived._etag);
    expect(deleted.blobNames).toEqual(["org/test/evidence.pdf"]);
    await expect(store.permanentDelete("property", property.id, archived._etag)).resolves.toMatchObject({ deletedCount: 0, blobNames: deleted.blobNames });
    await store.acknowledgeBlobDeletion(deleted.blobNames[0]);
    await expect(store.permanentDelete("property", property.id, archived._etag)).rejects.toMatchObject({ status: 404 });
  });
  it("does not delete a legacy blob still referenced by another document", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const document = await store.create("document", { propertyId: property.id, blobName: "org/test/shared.pdf" }, user);
    await store.create("document", { propertyId: property.id, blobName: "org/test/shared.pdf" }, user);
    const archived = await store.setArchived("document", document.id, true, user, document._etag);
    await expect(store.permanentDelete("document", document.id, archived._etag)).resolves.toMatchObject({ blobNames: [] });
  });
  it("rejects a delete when a record changes after the deletion snapshot", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const archived = await store.setArchived("property", property.id, true, user, property._etag);
    const allRecords = store.allRecords.bind(store);
    vi.spyOn(store, "allRecords").mockImplementationOnce(async () => {
      const records = await allRecords();
      await store.setArchived("property", property.id, false, user, archived._etag);
      return records;
    });
    await expect(store.permanentDelete("property", property.id, archived._etag)).rejects.toMatchObject({ code: "version_conflict" });
    expect(await store.get("property", property.id)).toMatchObject({ archived: false });
  });

  it("keeps archived closed-year records read-only", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const year = await store.create("rentalYear", { propertyId: property.id, status: "current" }, user);
    const expense = await store.create("expense", { propertyId: property.id }, user);
    const archived = await store.setArchived("expense", expense.id, true, user, expense._etag);
    await store.update("rentalYear", year.id, { status: "closed" }, user, year._etag);
    await expect(store.permanentDelete("expense", expense.id, archived._etag)).rejects.toMatchObject({ code: "historical_record" });
  });

  it("fences Cosmos cascades and sends a condition with every delete", async () => {
    const root = { id: "property", kind: "property", organizationId: "org", archived: true, _etag: "root-etag" } as PortfolioRecord;
    const child = { id: "document", kind: "document", organizationId: "org", propertyId: root.id, _etag: "child-etag" } as PortfolioRecord;
    const batch = vi.fn().mockImplementation(async (operations: unknown[]) => ({ result: operations.map(() => ({ statusCode: 200 })) }));
    const container = { item: (id: string) => ({ read: async () => ({ resource: id === root.id ? { ...root, deleting: true, _etag: "fenced-etag" } : undefined }) }), items: { batch } } as unknown as Container;
    const store = new CosmosStore("org", container);
    await store.remove([child, root], root, "");
    expect(batch.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceBody: expect.objectContaining({ deletingRoots: [root.id] }) }),
      expect.objectContaining({ id: root.id, ifMatch: "root-etag", resourceBody: expect.objectContaining({ deleting: true }) }),
    ]));
    expect(batch.mock.calls[1][0]).toEqual([
      expect.objectContaining({ operationType: "Delete", id: child.id, ifMatch: "child-etag" }),
      expect.objectContaining({ operationType: "Delete", id: root.id, ifMatch: "fenced-etag" }),
    ]);
  });

  it("blocks late writes to a deletion-fenced property", async () => {
    const batch = vi.fn();
    const guard = { id: "organization-mutation-guard", deletingRoots: ["property"], _etag: "guard-etag" };
    const store = new CosmosStore("org", { item: () => ({ read: async () => ({ resource: guard }) }), items: { batch } } as unknown as Container);
    await expect(store.put({ id: "expense", kind: "expense", propertyId: "property", organizationId: "org" } as PortfolioRecord)).rejects.toMatchObject({ code: "deletion_in_progress" });
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects cross-year links and clearing an existing rental-year link", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const oldYear = await store.create("rentalYear", { propertyId: property.id, status: "current" }, user);
    const oldTenant = await store.create("tenant", { propertyId: property.id, firstName: "Old" }, user);
    const oldDocument = await store.create("document", { propertyId: property.id }, user);
    await store.update("rentalYear", oldYear.id, { status: "closed" }, user, oldYear._etag);
    const current = await store.create("rentalYear", { propertyId: property.id, status: "current" }, user);
    await expect(store.create("rentPayment", { propertyId: property.id, tenantId: oldTenant.id, rentalYearId: current.id, appliesToMonth: "2026-09" }, user)).rejects.toMatchObject({ code: "relationship_mismatch" });
    await expect(store.create("tenancy", { propertyId: property.id, tenantIds: [oldTenant.id] }, user)).rejects.toMatchObject({ code: "relationship_mismatch" });
    await expect(store.create("expense", { propertyId: property.id, documentId: oldDocument.id }, user)).rejects.toMatchObject({ code: "relationship_mismatch" });
    const tenant = await store.create("tenant", { propertyId: property.id, firstName: "Current" }, user);
    await expect(store.update("tenant", tenant.id, { rentalYearId: "" }, user, tenant._etag)).rejects.toMatchObject({ code: "immutable_relationship" });
  });

  it("conditionally checks the current year in the same Cosmos batch as its child write", async () => {
    const year = { id: "year", kind: "rentalYear", status: "current", _etag: "year-etag" };
    const child = { id: "child", kind: "expense", organizationId: "org", rentalYearId: "year", _etag: "child-etag" } as PortfolioRecord;
    const batch = vi.fn().mockImplementation(async (operations: unknown[]) => ({ result: operations.map(() => ({ statusCode: 200 })) }));
    const container = { item: (id: string) => ({ read: async () => ({ resource: id === "year" ? year : id === "child" ? child : undefined }) }), items: { batch } } as unknown as Container;
    const store = new CosmosStore("org", container);
    await store.put(child, "child-etag");
    expect(batch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ operationType: "Replace", id: "year", ifMatch: "year-etag" }),
      expect.objectContaining({ operationType: "Replace", id: "child", ifMatch: "child-etag" }),
    ]), "org");
    batch.mockImplementation(async (operations: unknown[]) => ({ result: operations.map((_, index) => ({ statusCode: index === 1 ? 412 : 424 })) }));
    await expect(store.put(child, "child-etag")).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("creates, updates, archives and restores a record", async () => {
    const store = new MemoryStore();
    const created = await store.create(
      "property",
      { name: "Test House" },
      user,
    );
    expect((await store.list("property"))[0].name).toBe("Test House");
    const updated = await store.update(
      "property",
      created.id,
      { bedrooms: 5 },
      user,
      created._etag,
    );
    expect(updated).toMatchObject({ bedrooms: 5, version: 2 });
    const archived = await store.setArchived(
      "property",
      created.id,
      true,
      user,
      updated._etag,
    );
    expect(await store.list("property")).toHaveLength(0);
    expect(await store.list("property", { archived: true })).toHaveLength(1);
    await store.setArchived("property", created.id, false, user, archived._etag);
    expect(await store.list("property")).toHaveLength(1);
  });

  it("rejects a property picture linked to another property", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const image = await store.create(
      "document",
      {
        propertyId: property.id,
        category: "property_image",
        mimeType: "image/jpeg",
      },
      user,
    );

    await expect(
      store.create(
        "property",
        { name: "Other house", imageDocumentId: image.id },
        user,
      ),
    ).rejects.toMatchObject({ status: 409, code: "relationship_mismatch" });
  });

  it("requires archived parents to be restored before child records", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const tenant = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Alex" },
      user,
    );
    const archivedProperty = await store.setArchived(
      "property",
      property.id,
      true,
      user,
      property._etag,
    );
    const archivedTenant = await store.setArchived(
      "tenant",
      tenant.id,
      true,
      user,
      tenant._etag,
    );

    await expect(
      store.setArchived(
        "tenant",
        tenant.id,
        false,
        user,
        archivedTenant._etag,
      ),
    ).rejects.toMatchObject({ status: 409, code: "parent_archived" });

    await store.setArchived(
      "property",
      property.id,
      false,
      user,
      archivedProperty._etag,
    );
    await expect(
      store.setArchived(
        "tenant",
        tenant.id,
        false,
        user,
        archivedTenant._etag,
      ),
    ).resolves.toMatchObject({ archived: false });
  });

  it("permanently deletes archived property records and linked documents", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const tenant = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Alex" },
      user,
    );
    const guarantor = await store.create(
      "guarantor",
      { tenantId: tenant.id, name: "Pat" },
      user,
    );
    const document = await store.create(
      "document",
      {
        propertyId: property.id,
        fileName: "agreement.pdf",
        blobName: "portfolio/property/agreement.pdf",
      },
      user,
    );

    await expect(
      store.permanentDelete("property", property.id, property._etag),
    ).rejects.toMatchObject({ status: 409, code: "not_archived" });

    const archived = await store.setArchived(
      "property",
      property.id,
      true,
      user,
      property._etag,
    );
    await expect(
      store.permanentDelete("property", property.id, archived._etag),
    ).resolves.toEqual({
      deletedCount: 4,
      blobNames: ["portfolio/property/agreement.pdf"],
    });
    await expect(store.get("property", property.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(store.get("tenant", tenant.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(store.get("guarantor", guarantor.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(store.get("document", document.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("does not delete a tenant who remains on a shared tenancy", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    const first = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Alex" },
      user,
    );
    const second = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Sam" },
      user,
    );
    await store.create(
      "tenancy",
      { propertyId: property.id, tenantIds: [first.id, second.id] },
      user,
    );
    const archived = await store.setArchived(
      "tenant",
      first.id,
      true,
      user,
      first._etag,
    );
    await expect(
      store.permanentDelete("tenant", first.id, archived._etag),
    ).rejects.toMatchObject({ status: 409, code: "shared_tenancy" });
  });

  it("rejects stale optimistic concurrency tokens", async () => {
    const store = new MemoryStore();
    const created = await store.create("tenant", { firstName: "Alex" }, user);
    await store.update(
      "tenant",
      created.id,
      { course: "Law" },
      user,
      created._etag,
    );
    await expect(
      store.update(
        "tenant",
        created.id,
        { course: "History" },
        user,
        created._etag,
      ),
    ).rejects.toMatchObject({ status: 409, code: "version_conflict" });
  });

  it("moves outgoing property records into rental-year history", async () => {
    const store = new MemoryStore();
    const property = await store.create(
      "property",
      { name: "Student House", annualRentPence: 6000000 },
      user,
    );
    const legacyTenant = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Alex" },
      user,
    );
    const legacyDocument = await store.create(
      "document",
      { propertyId: property.id, fileName: "agreement.pdf" },
      user,
    );
    const liveCompliance = await store.create(
      "compliance",
      {
        propertyId: property.id,
        title: "EPC",
        expiryDate: "2027-08-20",
      },
      user,
    );

    const first = await store.startRentalYear(
      property.id,
      {
        label: "2026/27",
        startDate: "2026-09-01",
        endDate: "2027-08-31",
        annualRentPence: 6500000,
      },
      user,
    );
    expect(first.closed).toMatchObject({
      status: "closed",
      label: "Records before 2026/27",
      propertySnapshot: { name: "Student House", annualRentPence: 6000000 },
    });
    expect(first.recordsMoved).toBe(3);
    expect(first.current.annualRentPence).toBe(6500000);
    expect((await store.get("property", property.id)).annualRentPence).toBe(
      6500000,
    );
    expect(await store.get("tenant", legacyTenant.id)).toMatchObject({
      rentalYearId: first.closed?.id,
    });
    expect(await store.get("document", legacyDocument.id)).toMatchObject({
      rentalYearId: first.closed?.id,
    });
    const currentCompliance = await store.get("compliance", liveCompliance.id);
    expect(currentCompliance).not.toHaveProperty("rentalYearId");
    expect(currentCompliance).toMatchObject({ expiryDate: "2027-08-20" });
    expect(
      await store.list("compliance", {
        propertyId: property.id,
        rentalYearId: first.closed!.id,
      }),
    ).toHaveLength(1);

    const currentTenant = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Sam" },
      user,
    );
    expect(currentTenant.rentalYearId).toBe(first.current.id);
    const second = await store.startRentalYear(
      property.id,
      {
        label: "2027/28",
        startDate: "2027-09-01",
        endDate: "2028-08-31",
        annualRentPence: 6800000,
      },
      user,
    );
    expect(second.closed?.id).toBe(first.current.id);
    expect(second.recordsMoved).toBe(2);
    await expect(
      store.update("tenant", currentTenant.id, { course: "Law" }, user),
    ).rejects.toMatchObject({ status: 409, code: "historical_record" });
    await expect(
      store.setArchived("tenant", currentTenant.id, true, user),
    ).rejects.toMatchObject({ status: 409, code: "historical_record" });

    const restored = await store.restoreRentalYear(
      property.id,
      second.closed!.id,
      user,
      second.closed!._etag,
    );
    expect(restored.status).toBe("restored");
    await expect(
      store.update("tenant", currentTenant.id, { course: "Law" }, user, currentTenant._etag),
    ).resolves.toMatchObject({ course: "Law", rentalYearId: restored.id });
    const restoredTenant = await store.create("tenant", { propertyId: property.id, rentalYearId: restored.id, firstName: "Restored", monthlyRentPence: 100_000 }, user);
    expect(restoredTenant.rentalYearId).toBe(restored.id);
    const restoredAdvance = await store.createRentAdvance({ propertyId: property.id, tenantId: restoredTenant.id, rentalYearId: restored.id, paidDate: "2026-10-10", additionalMonths: 1, method: "bank_transfer", rentFrequency: "monthly", bankReference: "RESTORED", notes: "Correction" }, user);
    expect(restoredAdvance.every((payment) => payment.rentalYearId === restored.id)).toBe(true);
    const snapshotUpdated = await store.updateRestoredYearProperty(
      property.id,
      restored.id,
      { name: "Corrected Student House", imageDocumentId: "" },
      user,
      restored._etag,
    );
    expect(snapshotUpdated.propertySnapshot).toMatchObject({ name: "Corrected Student House" });
    await expect(
      store.startRentalYear(property.id, { label: "2028/29", startDate: "2028-09-01", endDate: "2029-08-31", annualRentPence: 7_000_000 }, user),
    ).rejects.toMatchObject({ status: 409, code: "rental_year_edit_in_progress" });
    const savedHistory = await store.saveRentalYearToHistory(property.id, restored.id, user, snapshotUpdated._etag);
    expect(savedHistory.status).toBe("closed");
    await expect(
      store.update("tenant", currentTenant.id, { course: "History" }, user),
    ).rejects.toMatchObject({ status: 409, code: "historical_record" });
    await expect(
      store.create("tenant", { propertyId: property.id, rentalYearId: restored.id, firstName: "Too late", monthlyRentPence: 100_000 }, user),
    ).rejects.toMatchObject({ status: 409, code: "historical_record" });
    expect((await store.list("rentalYear", { propertyId: property.id })).find((year) => year.status === "current")?.id).toBe(second.current.id);
  });

  it("allows only one concurrent restored year per property", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "Student House" }, user);
    const first = await store.create("rentalYear", { propertyId: property.id, label: "2024/25", status: "closed" }, user);
    const second = await store.create("rentalYear", { propertyId: property.id, label: "2025/26", status: "closed" }, user);

    const results = await Promise.allSettled([
      store.restoreRentalYear(property.id, first.id, user, first._etag),
      store.restoreRentalYear(property.id, second.id, user, second._etag),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps restored property pictures scoped to the same rental year", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "Student House" }, user);
    const historical = await store.create("rentalYear", {
      propertyId: property.id,
      label: "2025/26",
      status: "closed",
      propertySnapshot: { name: "Historical House" },
    }, user);
    const current = await store.create("rentalYear", { propertyId: property.id, label: "2026/27", status: "current" }, user);
    const currentImage = await store.create("document", {
      propertyId: property.id,
      rentalYearId: current.id,
      category: "property_image",
      mimeType: "image/jpeg",
    }, user);
    const restored = await store.restoreRentalYear(property.id, historical.id, user, historical._etag);

    await expect(store.updateRestoredYearProperty(
      property.id,
      restored.id,
      { imageDocumentId: currentImage.id },
      user,
      restored._etag,
    )).rejects.toMatchObject({ status: 409, code: "relationship_mismatch" });
  });

  it("rejects cross-property tenant and tenancy relationships", async () => {
    const store = new MemoryStore();
    const firstProperty = await store.create(
      "property",
      { name: "First House" },
      user,
    );
    const secondProperty = await store.create(
      "property",
      { name: "Second House" },
      user,
    );
    const tenant = await store.create(
      "tenant",
      { propertyId: firstProperty.id, firstName: "Alex" },
      user,
    );

    await expect(
      store.create(
        "tenancy",
        { propertyId: secondProperty.id, tenantIds: [tenant.id] },
        user,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "relationship_mismatch",
    });
    await expect(
      store.update(
        "tenant",
        tenant.id,
        { propertyId: secondProperty.id },
        user,
        tenant._etag,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "immutable_relationship",
    });
  });

  it("excludes active child records while their property is archived", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "House" }, user);
    await store.create(
      "compliance",
      { propertyId: property.id, title: "Gas safety" },
      user,
    );
    await store.setArchived(
      "property",
      property.id,
      true,
      user,
      property._etag,
    );

    expect(await store.allActive()).toHaveLength(0);
  });

  it("paginates record lists without dropping records", async () => {
    const store = new MemoryStore();
    for (let index = 0; index < 5; index += 1)
      await store.create("property", { name: `House ${index}` }, user);

    const first = await store.listPage("property", { limit: 2 });
    const second = await store.listPage(
      "property",
      { limit: 2 },
      first.continuationToken,
    );
    const third = await store.listPage(
      "property",
      { limit: 2 },
      second.continuationToken,
    );

    expect([...first.items, ...second.items, ...third.items]).toHaveLength(5);
    expect(third.continuationToken).toBeUndefined();
  });

  it("records a rent advance as one linked monthly entry per covered month", async () => {
    const store = new MemoryStore();
    const property = await store.create(
      "property",
      {
        name: "Advance House",
        annualRentPence: 1_200_000,
        tenancyStartDate: "2026-08-01",
        tenancyEndDate: "2027-07-31",
      },
      user,
    );
    const year = await store.startRentalYear(
      property.id,
      {
        label: "2026/27",
        startDate: "2026-08-01",
        endDate: "2027-07-31",
        annualRentPence: 1_200_000,
      },
      user,
    );
    const tenant = await store.create(
      "tenant",
      {
        propertyId: property.id,
        firstName: "Alex",
        monthlyRentPence: 100_000,
      },
      user,
    );

    const payments = await store.createRentAdvance(
      {
        propertyId: property.id,
        tenantId: tenant.id,
        paidDate: "2026-08-14",
        additionalMonths: 2,
        method: "bank_transfer",
        rentFrequency: "monthly",
        bankReference: "ADV-001",
        notes: "August plus two months paid early",
      },
      user,
    );

    expect(payments).toHaveLength(3);
    expect(payments.map((payment) => payment.appliesToMonth)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(payments.map((payment) => payment.amountPaidPence)).toEqual([
      100_000,
      100_000,
      100_000,
    ]);
    expect(payments.map((payment) => payment.dueDate)).toEqual([
      "2026-08-14",
      "2026-09-14",
      "2026-10-14",
    ]);
    expect(new Set(payments.map((payment) => payment.advancePaymentId)).size).toBe(1);
    expect(payments[2]).toMatchObject({
      status: "in_advance",
      paidDate: "2026-08-14",
      rentalYearId: year.current.id,
      advanceSequence: 2,
      advanceAdditionalMonths: 2,
      advanceCoveredFrom: "2026-08",
      advanceCoveredTo: "2026-10",
      notes: "August plus two months paid early",
    });
    await expect(
      store.create(
        "rentPayment",
        {
          propertyId: property.id,
          tenantId: tenant.id,
          dueDate: "2026-09-20",
          paidDate: "2026-09-20",
          appliesToMonth: "2026-09",
          amountDuePence: 100_000,
          amountPaidPence: 10_000,
          status: "partial",
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 409, code: "advance_month_managed" });
  });

  it("rejects duplicate or out-of-period advance rent without adding records", async () => {
    const store = new MemoryStore();
    const property = await store.create(
      "property",
      {
        name: "Short Tenancy",
        annualRentPence: 200_000,
        tenancyStartDate: "2026-08-01",
        tenancyEndDate: "2026-09-30",
      },
      user,
    );
    await store.startRentalYear(
      property.id,
      {
        label: "Aug-Sep 2026",
        startDate: "2026-08-01",
        endDate: "2026-09-30",
        annualRentPence: 200_000,
      },
      user,
    );
    const tenant = await store.create(
      "tenant",
      {
        propertyId: property.id,
        firstName: "Sam",
        monthlyRentPence: 100_000,
      },
      user,
    );
    const input = {
      propertyId: property.id,
      tenantId: tenant.id,
      paidDate: "2026-08-01",
      additionalMonths: 1,
      method: "cash" as const,
      rentFrequency: "monthly" as const,
      bankReference: "",
      notes: "Two months",
    };

    await expect(store.createRentAdvance(input, user)).resolves.toHaveLength(2);
    await expect(store.createRentAdvance(input, user)).rejects.toMatchObject({
      status: 409,
      code: "rent_month_already_recorded",
    });
    await expect(
      store.createRentAdvance(
        { ...input, paidDate: "2026-09-01", additionalMonths: 1 },
        user,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "advance_outside_tenancy",
    });
    expect(await store.list("rentPayment", { propertyId: property.id })).toHaveLength(2);
  });

  it("requires advance-rent tenants and tenancies to belong to the current rental year", async () => {
    const store = new MemoryStore();
    const property = await store.create(
      "property",
      {
        name: "Year Check House",
        annualRentPence: 1_200_000,
        tenancyStartDate: "2026-08-01",
        tenancyEndDate: "2027-07-31",
      },
      user,
    );
    const previousYear = await store.create(
      "rentalYear",
      {
        propertyId: property.id,
        label: "2025/26",
        startDate: "2025-08-01",
        endDate: "2026-07-31",
        annualRentPence: 1_200_000,
        status: "restored",
      },
      user,
    );
    const currentYear = await store.create(
      "rentalYear",
      {
        propertyId: property.id,
        label: "2026/27",
        startDate: "2026-08-01",
        endDate: "2027-07-31",
        annualRentPence: 1_200_000,
        status: "current",
      },
      user,
    );
    const historicalTenant = await store.create(
      "tenant",
      {
        propertyId: property.id,
        rentalYearId: previousYear.id,
        firstName: "Alex",
        monthlyRentPence: 100_000,
      },
      user,
    );
    const historicalTenancy = await store.create(
      "tenancy",
      {
        propertyId: property.id,
        rentalYearId: previousYear.id,
        tenantIds: [historicalTenant.id],
        startDate: "2025-08-01",
        endDate: "2026-07-31",
        status: "active",
      },
      user,
    );
    await store.saveRentalYearToHistory(
      property.id,
      previousYear.id,
      user,
      previousYear._etag,
    );
    const currentTenant = await store.create(
      "tenant",
      {
        propertyId: property.id,
        rentalYearId: currentYear.id,
        firstName: "Blair",
        monthlyRentPence: 100_000,
      },
      user,
    );

    await expect(
      store.createRentAdvance(
        {
          propertyId: property.id,
          tenantId: historicalTenant.id,
          tenancyId: historicalTenancy.id,
          paidDate: "2026-08-14",
          additionalMonths: 1,
          method: "bank_transfer",
          rentFrequency: "monthly",
          bankReference: "ADV-OLD",
          notes: "Historical tenant",
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 409, code: "relationship_mismatch" });
    await expect(
      store.createRentAdvance(
        {
          propertyId: property.id,
          tenantId: currentTenant.id,
          tenancyId: historicalTenancy.id,
          paidDate: "2026-08-14",
          additionalMonths: 1,
          method: "bank_transfer",
          rentFrequency: "monthly",
          bankReference: "ADV-MIXED",
          notes: "Historical tenancy",
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 409, code: "relationship_mismatch" });
  });

  it("edits and archives linked advance payments only through group-safe workflows", async () => {
    const store = new MemoryStore();
    const property = await store.create(
      "property",
      {
        name: "Managed Advance House",
        annualRentPence: 1_200_000,
        tenancyStartDate: "2026-08-01",
        tenancyEndDate: "2027-07-31",
      },
      user,
    );
    const currentYear = await store.create(
      "rentalYear",
      {
        propertyId: property.id,
        label: "2026/27",
        startDate: "2026-08-01",
        endDate: "2027-07-31",
        annualRentPence: 1_200_000,
        status: "current",
      },
      user,
    );
    const tenant = await store.create(
      "tenant",
      {
        propertyId: property.id,
        rentalYearId: currentYear.id,
        firstName: "Alex",
        monthlyRentPence: 100_000,
      },
      user,
    );
    const [advance] = await store.createRentAdvance(
      {
        propertyId: property.id,
        tenantId: tenant.id,
        paidDate: "2026-08-14",
        additionalMonths: 1,
        method: "bank_transfer",
        rentFrequency: "monthly",
        bankReference: "ADV-001",
        notes: "August plus September",
      },
      user,
    );

    await expect(
      store.update(
        "rentPayment",
        advance.id,
        { amountPaidPence: 1 },
        user,
        advance._etag,
      ),
    ).rejects.toMatchObject({ status: 405, code: "managed_record" });
    await expect(
      store.updateRentAdvance(
        advance.id,
        {
          paidDate: "2026-09-01",
          method: "cash",
          rentFrequency: "monthly",
          bankReference: "WRONG-MONTH",
          notes: "Wrong receipt month",
        },
        user,
        advance._etag,
      ),
    ).rejects.toMatchObject({ status: 400, code: "advance_receipt_month_changed" });
    const updated = await store.updateRentAdvance(
      advance.id,
      {
        paidDate: "2026-08-16",
        method: "cash",
        rentFrequency: "monthly",
        bankReference: "ADV-CORRECTED",
        notes: "Corrected receipt details",
      },
      user,
      advance._etag,
    );
    expect(updated).toHaveLength(2);
    expect(updated.every((payment) => payment.paidDate === "2026-08-16" && payment.method === "cash")).toBe(true);
    expect(updated.map((payment) => payment.dueDate)).toEqual(["2026-08-16", "2026-09-16"]);

    const archivedAdvance = await store.setArchived(
      "rentPayment",
      advance.id,
      true,
      user,
      updated.find((payment) => payment.id === advance.id)!._etag,
    );
    expect(await store.list("rentPayment", { propertyId: property.id })).toHaveLength(0);
    expect(await store.list("rentPayment", { propertyId: property.id, archived: true })).toHaveLength(2);
    await expect(
      store.permanentDelete("rentPayment", advance.id, archivedAdvance._etag),
    ).rejects.toMatchObject({ status: 405, code: "managed_record" });
    await store.setArchived("rentPayment", advance.id, false, user, archivedAdvance._etag);
    expect(await store.list("rentPayment", { propertyId: property.id })).toHaveLength(2);
  });

  it("accepts up to 48 additional natural-number months when the tenancy permits it", async () => {
    const store = new MemoryStore();
    const property = await store.create(
      "property",
      {
        name: "Long Tenancy",
        annualRentPence: 1_200_000,
        tenancyStartDate: "2026-01-01",
        tenancyEndDate: "2035-12-31",
      },
      user,
    );
    const tenant = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Long", monthlyRentPence: 100_000 },
      user,
    );

    const payments = await store.createRentAdvance(
      {
        propertyId: property.id,
        tenantId: tenant.id,
        paidDate: "2026-01-15",
        additionalMonths: 48,
        method: "bank_transfer",
        rentFrequency: "monthly",
        bankReference: "ADV-49-MONTHS",
        notes: "Upper-bound validation",
      },
      user,
    );

    expect(payments).toHaveLength(49);
    expect(payments.at(-1)?.appliesToMonth).toBe("2030-01");
  });

  it("replaces an existing Paid month before allowing additive instalments", async () => {
    const store = new MemoryStore();
    const property = await store.create("property", { name: "Payment House" }, user);
    const tenant = await store.create(
      "tenant",
      { propertyId: property.id, firstName: "Alex", monthlyRentPence: 100_000 },
      user,
    );
    const payment = (status: string, paidDate: string, amountPaidPence: number) => ({
      propertyId: property.id,
      tenantId: tenant.id,
      tenancyId: "",
      dueDate: "2026-08-01",
      paidDate,
      appliesToMonth: "2026-08",
      amountDuePence: 100_000,
      amountPaidPence,
      method: "bank_transfer",
      rentFrequency: "monthly",
      bankReference: "",
      status,
      notes: "",
    });
    const paid = await store.create(
      "rentPayment",
      payment("paid", "2026-08-01", 100_000),
      user,
    );

    await expect(
      store.create(
        "rentPayment",
        payment("partial", "2026-08-16", 40_000),
        user,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "rent_payment_requires_override",
    });

    const firstPartial = await store.update(
      "rentPayment",
      paid.id,
      {
        status: "partial",
        paidDate: "2026-08-01",
        amountPaidPence: 40_000,
        notes: "First instalment",
      },
      user,
      paid._etag,
    );
    await expect(
      store.create(
        "rentPayment",
        payment("partial", "2026-08-16", 30_000),
        user,
      ),
    ).resolves.toMatchObject({ status: "partial", amountPaidPence: 30_000 });
    const finalPaid = await store.create(
      "rentPayment",
      payment("paid", "2026-08-20", 30_000),
      user,
    );
    await expect(
      store.create(
        "rentPayment",
        payment("late", "2026-08-21", 10_000),
        user,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "rent_payment_requires_override",
    });
    await expect(
      store.update(
        "rentPayment",
        firstPartial.id,
        { status: "paid" },
        user,
        firstPartial._etag,
      ),
    ).rejects.toMatchObject({ status: 409, code: "duplicate_paid_rent" });
    const septemberPartial = await store.create(
      "rentPayment",
      {
        ...payment("partial", "2026-09-10", 20_000),
        dueDate: "2026-09-01",
        appliesToMonth: "2026-09",
      },
      user,
    );
    await expect(
      store.update(
        "rentPayment",
        septemberPartial.id,
        { paidDate: "2026-08-22", dueDate: "2026-08-01", appliesToMonth: "2026-08" },
        user,
        septemberPartial._etag,
      ),
    ).rejects.toMatchObject({ status: 409, code: "rent_payment_requires_override" });
    expect(finalPaid.status).toBe("paid");
  });
});
