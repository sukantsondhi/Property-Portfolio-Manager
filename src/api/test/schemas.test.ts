import { describe, expect, it } from "vitest";
import { advanceRentPaymentInput, validateRecord } from "../src/domain/schemas";

describe("record validation", () => {
  it("normalizes a valid property payload", () => {
    expect(
      validateRecord("property", {
        name: "  Oak House ",
        addressLine1: "1 High Street",
        city: "Leeds",
        postcode: "LS1 1AA",
        bedrooms: 4,
        bathrooms: 2,
        monthlyRentPence: 500000,
        annualRentPence: 6000000,
        tenancyStartDate: "2026-09-01",
        tenancyEndDate: "2027-08-31",
        rentCollectionDay: 9,
      }),
    ).toMatchObject({
      name: "Oak House",
      propertyType: "house",
      purchasePricePence: 0,
      rentCollectionDay: 9,
    });
  });

  it("rejects negative financial amounts", () => {
    expect(() =>
      validateRecord("expense", {
        propertyId: crypto.randomUUID(),
        category: "maintenance",
        amountPence: -1,
        expenseDate: "2026-01-01",
        description: "Repair",
      }),
    ).toThrow();
  });

  it("requires a valid monthly rent collection day", () => {
    expect(() => validateRecord("property", { rentCollectionDay: 0 }, true)).toThrow();
    expect(() => validateRecord("property", { rentCollectionDay: 32 }, true)).toThrow();
    expect(validateRecord("property", { rentCollectionDay: 31 }, true)).toEqual({ rentCollectionDay: 31 });
  });

  it("allows tenants who are not university students", () => {
    expect(validateRecord("tenant", { propertyId: crypto.randomUUID(), firstName: "Alex", lastName: "Example", email: "alex@example.com", monthlyRentPence: 120000 })).toMatchObject({ university: "" });
  });

  it("supports safe partial updates for refined property and rent schemas", () => {
    expect(validateRecord("property", { notes: "Updated" }, true)).toEqual({ notes: "Updated" });
    expect(() => validateRecord("property", { tenancyStartDate: "2027-09-01", tenancyEndDate: "2027-08-31" }, true)).toThrow();
    expect(() => validateRecord("rentPayment", { status: "adjusted", notes: "" }, true)).toThrow();
    expect(validateRecord("rentPayment", { status: "adjusted", notes: "Correction" }, true)).toEqual({ status: "adjusted", notes: "Correction" });
  });

  it("validates a closed rental-year record", () => {
    expect(
      validateRecord("rentalYear", {
        propertyId: crypto.randomUUID(),
        label: "2025/26",
        startDate: "2025-09-01",
        endDate: "2026-08-31",
        annualRentPence: 6000000,
        status: "closed",
      }),
    ).toMatchObject({ label: "2025/26", status: "closed" });
  });

  it("validates bounded advance-rent input and the monthly ledger status", () => {
    const propertyId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    expect(
      advanceRentPaymentInput.parse({
        propertyId,
        tenantId,
        paidDate: "2026-08-14",
        additionalMonths: 2,
        method: "bank_transfer",
        rentFrequency: "monthly",
        bankReference: "ADV-001",
        notes: "August through October",
      }),
    ).toMatchObject({ additionalMonths: 2 });
    expect(
      advanceRentPaymentInput.parse({
        propertyId,
        tenantId,
        paidDate: "2026-08-14",
        additionalMonths: 48,
      }),
    ).toMatchObject({ additionalMonths: 48 });
    expect(() =>
      advanceRentPaymentInput.parse({
        propertyId,
        tenantId,
        paidDate: "2026-08-14",
        additionalMonths: 49,
      }),
    ).toThrow();
    expect(
      validateRecord("rentPayment", {
        propertyId,
        tenantId,
        dueDate: "2026-08-14",
        paidDate: "2026-08-14",
        appliesToMonth: "2026-08",
        amountDuePence: 100_000,
        amountPaidPence: 100_000,
        status: "in_advance",
      }),
    ).toMatchObject({ status: "in_advance" });
  });
});
