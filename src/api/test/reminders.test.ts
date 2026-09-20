import { describe, expect, it } from "vitest";
import type { PortfolioRecord } from "../src/domain/types";
import { findDueReminders, findDueRentCollectionReminders, rentCollectionEmail } from "../src/services/reminders";

const record = (value: Partial<PortfolioRecord>): PortfolioRecord => ({ id: crypto.randomUUID(), organizationId: "test-organization", kind: "compliance", archived: false, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", version: 1, ...value });

describe("email reminder selection", () => {
  it("selects an exact configured offset and includes the property name", () => {
    const property = record({ kind: "property", name: "Oak House" });
    const compliance = record({ propertyId: property.id, title: "Boiler service", expiryDate: "2026-08-01", reminderEnabled: true, reminderOffsetsDays: [30, 11, 1] });
    expect(findDueReminders([property, compliance], new Date("2026-07-21T12:00:00Z"))).toMatchObject([{ propertyName: "Oak House", daysUntilExpiry: 11, offsetDays: 11 }]);
  });
  it("does not select dates between configured offsets", () => {
    const compliance = record({ title: "EPC", expiryDate: "2026-08-01", reminderOffsetsDays: [30, 7, 1] });
    expect(findDueReminders([compliance], new Date("2026-07-21T12:00:00Z"))).toEqual([]);
  });
  it("uses the 30, 7 and 1 day defaults for older records", () => {
    const compliance = record({ title: "EICR", expiryDate: "2026-07-22" });
    expect(findDueReminders([compliance], new Date("2026-07-21T12:00:00Z"))).toHaveLength(1);
  });
  it("keeps the live compliance renewal active after rollover and ignores the closed snapshot", () => {
    const property = record({ kind: "property", name: "Oak House" });
    const year = record({ kind: "rentalYear", propertyId: property.id, status: "closed" });
    const live = record({ propertyId: property.id, title: "EPC", issueDate: "2025-08-20", expiryDate: "2026-08-20", reminderOffsetsDays: [30, 7, 1] });
    const snapshot = record({ propertyId: property.id, rentalYearId: year.id, title: "EPC snapshot", issueDate: "2025-08-20", expiryDate: "2026-08-20", reminderOffsetsDays: [30, 7, 1] });
    expect(findDueReminders([property, year, live, snapshot], new Date("2026-08-20T12:00:00Z"))).toMatchObject([
      { record: { id: live.id }, propertyName: "Oak House", daysUntilExpiry: 0, offsetDays: 0 },
    ]);
  });
});

describe("rent collection reminder selection", () => {
  const rentRecords = () => {
    const property = record({ kind: "property", name: "Five Tenant House", rentCollectionDay: 9, tenancyStartDate: "2026-08-01", tenancyEndDate: "2026-12-31" });
    const year = record({ kind: "rentalYear", propertyId: property.id, status: "current", startDate: "2026-08-01", endDate: "2026-12-31" });
    const tenant = (firstName: string) => record({ kind: "tenant", propertyId: property.id, rentalYearId: year.id, firstName, lastName: "Student", monthlyRentPence: 100_000 });
    const tenants = ["Alex", "Blair", "Casey", "Dev", "Eden"].map(tenant);
    const payment = (tenantId: string, status: string, notes = "") => record({ kind: "rentPayment", propertyId: property.id, rentalYearId: year.id, tenantId, appliesToMonth: "2026-08", paidDate: "2026-08-09", amountPaidPence: status === "due" ? 0 : 100_000, status, notes });
    const payments = [
      payment(tenants[0].id, "paid"),
      payment(tenants[1].id, "in_advance"),
      payment(tenants[2].id, "adjusted", "Reduced after plumbing disruption"),
      payment(tenants[3].id, "due"),
      payment(tenants[4].id, "late"),
    ];
    return { property, year, tenants, payments, records: [property, year, ...tenants, ...payments] };
  };

  it("sends the collection-day status and includes adjusted notes under the tenant", () => {
    const { records } = rentRecords();
    const [reminder] = findDueRentCollectionReminders(records, new Date("2026-08-09T12:00:00Z"));
    expect(reminder).toMatchObject({ stage: "initial", deliveryStage: "initial", month: "2026-08", collectionDate: "2026-08-09", allSettled: false });
    expect(reminder.tenants.map((tenant) => tenant.status)).toEqual(["paid", "in_advance", "adjusted", "due", "late"]);
    expect(reminder.tenants[2].notes).toEqual(["Reduced after plumbing disruption"]);
  });

  it("waits seven days between follow-ups", () => {
    const { records } = rentRecords();
    expect(findDueRentCollectionReminders(records, new Date("2026-08-10T12:00:00Z"))).toEqual([]);
    expect(findDueRentCollectionReminders(records, new Date("2026-08-16T12:00:00Z"))).toMatchObject([{ stage: "weekly", deliveryStage: "week-1", weekNumber: 1 }]);
  });

  it("continues an unsettled month's weekly sequence across a calendar boundary", () => {
    const fixture = rentRecords();
    fixture.property.rentCollectionDay = 31;
    expect(findDueRentCollectionReminders(
      fixture.records,
      new Date("2026-09-07T12:00:00Z"),
    )).toMatchObject([{ month: "2026-08", collectionDate: "2026-08-31", stage: "weekly", deliveryStage: "week-1" }]);
  });

  it("uses the final calendar day when a 29th to 31st collection day is unavailable", () => {
    const fixture = rentRecords();
    fixture.property.rentCollectionDay = 31;
    fixture.year.startDate = "2027-01-01";
    fixture.year.endDate = "2027-12-31";
    for (const tenant of fixture.tenants) tenant.rentalYearId = fixture.year.id;
    expect(findDueRentCollectionReminders(
      [fixture.property, fixture.year, ...fixture.tenants],
      new Date("2027-02-27T12:00:00Z"),
    )).toEqual([]);
    expect(findDueRentCollectionReminders(
      [fixture.property, fixture.year, ...fixture.tenants],
      new Date("2027-02-28T12:00:00Z"),
    )).toEqual(expect.arrayContaining([expect.objectContaining({ collectionDate: "2027-02-28", stage: "initial" })]));
  });

  it("does not send outside the property's saved rental-year period", () => {
    const fixture = rentRecords();
    fixture.year.startDate = "2026-09-01";
    expect(findDueRentCollectionReminders(
      [fixture.property, fixture.year, ...fixture.tenants],
      new Date("2026-08-09T12:00:00Z"),
    )).toEqual([]);
  });

  it("sends one completion state as soon as every tenant is paid", () => {
    const fixture = rentRecords();
    const paid = fixture.tenants.map((tenant, index) => record({ kind: "rentPayment", propertyId: fixture.property.id, rentalYearId: fixture.year.id, tenantId: tenant.id, appliesToMonth: "2026-08", paidDate: `2026-08-${String(10 + index).padStart(2, "0")}`, amountPaidPence: 100_000, status: "paid", notes: index === 0 ? "Thank you <Alex>" : "" }));
    const [reminder] = findDueRentCollectionReminders([fixture.property, fixture.year, ...fixture.tenants, ...paid], new Date("2026-08-13T12:00:00Z"));
    expect(reminder).toMatchObject({ stage: "complete", deliveryStage: "complete", allSettled: true });
    const email = rentCollectionEmail("Test Org", reminder);
    expect(email.subject).toContain("Rent at Five Tenant House is settled for August 2026");
    expect(email.plainText).toContain("Every tenant is recorded as Paid, In advance, Waived or Adjusted");
    expect(email.html).toContain("Thank you &lt;Alex&gt;");
    expect(email.html).not.toContain("Thank you <Alex>");
  });

  it("treats waived and adjusted rent as settled and stops weekly follow-ups", () => {
    const fixture = rentRecords();
    const settled = fixture.tenants.map((tenant, index) => record({
      kind: "rentPayment",
      propertyId: fixture.property.id,
      rentalYearId: fixture.year.id,
      tenantId: tenant.id,
      appliesToMonth: "2026-08",
      paidDate: "2026-08-09",
      amountPaidPence: index % 2 === 0 ? 0 : 75_000,
      status: index % 2 === 0 ? "waived" : "adjusted",
      notes: index % 2 === 0 ? "Rent waived" : "Rent adjusted by agreement",
    }));

    const [reminder] = findDueRentCollectionReminders(
      [fixture.property, fixture.year, ...fixture.tenants, ...settled],
      new Date("2026-08-16T12:00:00Z"),
    );

    expect(reminder).toMatchObject({ stage: "complete", deliveryStage: "complete", allSettled: true });
    expect(reminder.tenants.map((tenant) => tenant.status)).toEqual(["waived", "adjusted", "waived", "adjusted", "waived"]);
  });
});
