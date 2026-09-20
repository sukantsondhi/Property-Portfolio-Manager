import { afterEach, describe, expect, it } from "vitest";
import type { PortfolioRecord } from "../src/domain/types";
import { organizationDeletedEmail, rentalYearBackupEmail } from "../src/services/portfolioEmails";

const base = (kind: PortfolioRecord["kind"], values: Record<string, unknown>): PortfolioRecord => ({
  id: `${kind}-id`,
  organizationId: "private-organization-id",
  kind,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "owner@example.com",
  updatedAt: "2026-12-31T00:00:00.000Z",
  updatedBy: "owner@example.com",
  version: 1,
  ...values,
});

describe("portfolio lifecycle email payloads", () => {
  afterEach(() => delete process.env.WEB_URL);

  it("builds a complete escaped rental-year backup without exposing Blob keys", () => {
    process.env.WEB_URL = "https://property.example.com";
    const property = base("property", { name: "House <One>", addressLine1: "1 Test Road", annualRentPence: 1440000 });
    const year = base("rentalYear", { propertyId: property.id, label: "2026/27", startDate: "2026-01-01", endDate: "2026-12-31", annualRentPence: 1440000, status: "closed" });
    const kinds: PortfolioRecord["kind"][] = ["tenant", "guarantor", "reference", "tenancy", "rentPayment", "expense", "compliance", "document"];
    const records = kinds.map((kind, index) => base(kind, {
      propertyId: property.id,
      rentalYearId: year.id,
      name: `${kind} <dummy>`,
      amountPaidPence: kind === "rentPayment" ? 120000 : undefined,
      amountPence: kind === "expense" ? 25000 : undefined,
      fileName: kind === "document" ? "backup.pdf" : undefined,
      blobName: kind === "document" ? "org/private/never-email-this-key" : undefined,
      notes: `detail ${index}`,
    }));
    const attachment = { name: "backup.pdf", contentType: "application/pdf", contentInBase64: "ZHVtbXk=" };
    const message = rentalYearBackupEmail({ organizationId: "org-id", organizationName: "Test Org", property, year, records, recipients: ["owner@example.com"], attachments: [attachment] });

    for (const heading of ["PROPERTY", "RENTALYEAR", "TENANT", "GUARANTOR", "REFERENCE", "TENANCY", "RENTPAYMENT", "EXPENSE", "COMPLIANCE", "DOCUMENT"])
      expect(message.plainText).toContain(heading);
    expect(message.plainText).toContain("This backup is organised by record type");
    expect(message.plainText).toContain("Rent received: £1,200.00");
    expect(message.plainText).toContain("Expenses: £250.00");
    expect(message.html).toContain("House &lt;One&gt;");
    expect(message.html).not.toContain("<dummy>");
    expect(message.plainText).not.toContain("never-email-this-key");
    expect(message.html).not.toContain("never-email-this-key");
    expect(message.plainText).toContain("https://property.example.com/select-organization?");
    expect(message.attachments).toEqual([attachment]);
  });

  it("tells a former member that a deleted organisation no longer exists", () => {
    const message = organizationDeletedEmail("editor@example.com", "Deleted Portfolio");
    expect(message.recipients).toEqual(["editor@example.com"]);
    expect(message.plainText).toContain("no longer exists");
    expect(message.plainText).toContain("Contact the organisation owner");
  });
});
