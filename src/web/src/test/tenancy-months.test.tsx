import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PropertyDetailPage } from "../pages/PropertyDetailPage";

const setArchived = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const monthOffset = (offset: number) => {
  const value = new Date();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + offset);
  return value.toISOString().slice(0, 7);
};
const currentMonth = monthOffset(0);
const historicalMonth = monthOffset(-1);
const unrelatedPropertyMonth = monthOffset(-2);
const legacyPaymentMonth = monthOffset(-3);
const records = [
  { id: "property-1", organizationId: "org-1", kind: "property", archived: false, name: "Student House", addressLine1: "1 Test Road", city: "London", postcode: "SW1 1AA", status: "active", annualRentPence: 2280000, tenancyStartDate: "2026-01-01", tenancyEndDate: "2027-12-31", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
  { id: "tenant-1", organizationId: "org-1", kind: "tenant", archived: false, propertyId: "property-1", firstName: "Alex", lastName: "Student", monthlyRentPence: 100000, notes: "Alex prefers email receipts", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
  { id: "tenant-2", organizationId: "org-1", kind: "tenant", archived: false, propertyId: "property-1", firstName: "Blair", lastName: "Student", monthlyRentPence: 90000, notes: "Blair pays by standing order", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
  { id: "payment-current", organizationId: "org-1", kind: "rentPayment", archived: false, propertyId: "property-1", tenantId: "tenant-1", appliesToMonth: currentMonth, paidDate: `${currentMonth}-14`, amountPaidPence: 50000, status: "partial", notes: "Half paid after bank delay", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
  { id: "payment-historical", organizationId: "org-1", kind: "rentPayment", archived: false, propertyId: "property-1", tenantId: "tenant-1", appliesToMonth: historicalMonth, paidDate: `${historicalMonth}-14`, amountPaidPence: 100000, status: "paid", notes: "Settled in full", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
  { id: "payment-other-property", organizationId: "org-1", kind: "rentPayment", archived: false, propertyId: "property-2", tenantId: "tenant-other", appliesToMonth: unrelatedPropertyMonth, paidDate: `${unrelatedPropertyMonth}-14`, amountPaidPence: 100000, status: "paid", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
  { id: "payment-legacy", organizationId: "org-1", kind: "rentPayment", archived: false, propertyId: "property-1", tenantId: "tenant-2", paidDate: `${legacyPaymentMonth}-14`, amountPaidPence: 90000, status: "paid", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
];

vi.mock("../context/PortfolioContext", () => ({
  usePortfolio: () => ({ records, refresh: vi.fn(), setArchived, save: vi.fn(), saveRentAdvance: vi.fn(), updateRentAdvance: vi.fn() }),
}));

describe("tenancy rent status months", () => {
  it("shows expected-rent progress and keeps rent notes and actions with the correct tenant", async () => {
    render(<MemoryRouter initialEntries={["/app/properties/property-1"]}><Routes><Route path="/app/properties/:id" element={<PropertyDetailPage />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Tenancy/ }));

    const monthSelect = screen.getByLabelText("Rent status month");
    expect(monthSelect).toHaveValue(currentMonth);
    expect(within(monthSelect).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual([currentMonth, historicalMonth, legacyPaymentMonth]);
    expect(screen.getAllByText("Partial")).toHaveLength(2);
    expect(screen.getByText("Half paid after bank delay")).toBeInTheDocument();
    const totalReceived = screen.getByText("Total rent received so far").closest("article");
    expect(totalReceived).toHaveTextContent("£2,400 / £22,800");
    const currentReceived = screen.getByText(`Rent received in ${new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${currentMonth}-01T00:00:00Z`))}`).closest("article");
    expect(currentReceived).toHaveTextContent("£500 / £1,900");
    const alex = screen.getByText("Alex Student").closest<HTMLElement>(".tenant-rent-record");
    const blair = screen.getByText("Blair Student").closest<HTMLElement>(".tenant-rent-record");
    expect(within(alex!).getByText("Alex prefers email receipts")).toBeInTheDocument();
    expect(within(alex!).getByText("Half paid after bank delay")).toBeInTheDocument();
    expect(within(alex!).queryByText("Blair pays by standing order")).not.toBeInTheDocument();
    expect(within(blair!).getByText("Blair pays by standing order")).toBeInTheDocument();

    fireEvent.click(within(alex!).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit rent entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("Half paid after bank delay");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(within(alex!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(setArchived).toHaveBeenCalledWith(records[3], true));
    confirm.mockRestore();

    fireEvent.change(monthSelect, { target: { value: historicalMonth } });
    expect(monthSelect).toHaveValue(historicalMonth);
    expect(screen.getAllByText("Paid")).toHaveLength(2);
    expect(screen.getByText("Settled in full")).toBeInTheDocument();
    expect(screen.queryByText("Half paid after bank delay")).not.toBeInTheDocument();
    expect(screen.getByText("Total rent received so far").closest("article")).toHaveTextContent("£2,400 / £22,800");
    const historicalReceived = screen.getByText(/Rent received in/).closest("article");
    expect(historicalReceived).toHaveTextContent("£1,000 / £1,900");
    expect(screen.getByText(/No rent recorded for/)).toBeInTheDocument();
  });
});
