import { describe, expect, it } from "vitest";
import { calculateRentLedger, calculateRentMonth } from "../lib/finance";
import type { PortfolioRecord } from "../types";

const record = (
  kind: PortfolioRecord["kind"],
  data: Record<string, unknown>,
): PortfolioRecord => ({
  id: crypto.randomUUID(),
  organizationId: "test-organization",
  kind,
  archived: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  createdBy: "owner@example.com",
  updatedAt: "2026-07-01T00:00:00.000Z",
  updatedBy: "owner@example.com",
  version: 1,
  ...data,
});

describe("rent finance calculations", () => {
  it("reports £3,600 expected for six £600 July liabilities with multiple instalments", () => {
    const property = record("property", {
      name: "July House",
      tenancyStartDate: "2026-07-01",
      tenancyEndDate: "2027-06-30",
    });
    const tenants = Array.from({ length: 6 }, () =>
      record("tenant", { propertyId: property.id, monthlyRentPence: 60000 }),
    );
    const payment = (tenantId: string, status: string, amountPaidPence: number) =>
      record("rentPayment", {
        propertyId: property.id,
        tenantId,
        appliesToMonth: "2026-07",
        amountDuePence: 60000,
        amountPaidPence,
        status,
      });
    const payments = [
      payment(tenants[0].id, "partial", 30000),
      payment(tenants[0].id, "late", 30000),
      ...tenants.slice(1).map((tenant) => payment(tenant.id, "paid", 60000)),
    ];
    const records = [property, ...tenants, ...payments];

    expect(calculateRentMonth(records, property.id, "2026-07")).toMatchObject({
      expectedPence: 360000,
      receivedPence: 360000,
      outstandingPence: 0,
    });
    expect(calculateRentLedger(records, "2026-07")).toMatchObject({
      expectedPence: 360000,
      receivedPence: 360000,
      outstandingPence: 0,
    });
  });

  it("counts a partially paid waiver only up to the amount retained", () => {
    const property = record("property", {
      tenancyStartDate: "2026-07-01",
      tenancyEndDate: "2027-06-30",
    });
    const tenant = record("tenant", {
      propertyId: property.id,
      monthlyRentPence: 60000,
    });
    const records = [
      property,
      tenant,
      record("rentPayment", {
        propertyId: property.id,
        tenantId: tenant.id,
        appliesToMonth: "2026-07",
        amountDuePence: 60000,
        amountPaidPence: 30000,
        status: "partial",
      }),
      record("rentPayment", {
        propertyId: property.id,
        tenantId: tenant.id,
        appliesToMonth: "2026-07",
        amountDuePence: 60000,
        amountPaidPence: 0,
        status: "waived",
      }),
    ];

    expect(calculateRentMonth(records, property.id, "2026-07")).toMatchObject({
      expectedPence: 30000,
      receivedPence: 30000,
      outstandingPence: 0,
    });
  });
});
