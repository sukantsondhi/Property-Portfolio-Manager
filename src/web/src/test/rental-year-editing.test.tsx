import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyDetailPage } from "../pages/PropertyDetailPage";

const refresh = vi.fn().mockResolvedValue(undefined);
const apiMocks = vi.hoisted(() => ({
  saveRentalYearToHistory: vi.fn().mockResolvedValue({ status: "closed" }),
}));
const property = { id: "property-1", organizationId: "org-1", kind: "property", archived: false, name: "Live Oak House", addressLine1: "1 New Road", city: "Egham", postcode: "TW20", status: "active", bedrooms: 5, bathrooms: 2, annualRentPence: 1_500_000, monthlyRentPence: 125_000, tenancyStartDate: "2027-09-01", tenancyEndDate: "2028-08-31", rentCollectionDay: 9, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", version: 1 };
const restoredYear = { id: "year-2026", organizationId: "org-1", kind: "rentalYear", archived: false, propertyId: property.id, label: "2026/27", startDate: "2026-09-01", endDate: "2027-08-31", annualRentPence: 1_200_000, status: "restored", propertySnapshot: { ...property, name: "Historical Oak House", addressLine1: "1 Old Road", tenancyStartDate: "2026-09-01", tenancyEndDate: "2027-08-31", annualRentPence: 1_200_000, monthlyRentPence: 100_000 }, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", version: 3, _etag: 'W/"3"' };
const currentYear = { ...restoredYear, id: "year-2027", label: "2027/28", startDate: "2027-09-01", endDate: "2028-08-31", status: "current", propertySnapshot: undefined, version: 1, _etag: 'W/"1"' };

vi.mock("../context/PortfolioContext", () => ({ usePortfolio: () => ({ records: [property, restoredYear, currentYear], refresh, setArchived: vi.fn(), save: vi.fn(), saveRentAdvance: vi.fn(), updateRentAdvance: vi.fn() }) }));
vi.mock("../lib/api", () => ({ api: apiMocks }));

describe("restored rental-year workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockResolvedValue(undefined);
    apiMocks.saveRentalYearToHistory.mockResolvedValue({ ...restoredYear, status: "closed" });
  });

  it("shows the restored snapshot as editable and saves it back to History", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MemoryRouter initialEntries={["/app/properties/property-1?year=year-2026"]}><Routes><Route path="/app/properties/:id" element={<PropertyDetailPage />} /><Route path="/app/history/:propertyId/:yearId" element={<div>Read-only history restored</div>} /></Routes></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Historical Oak House" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rental year")).toHaveValue("year-2026");
    expect(screen.getByRole("button", { name: "Start rental year" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save edits to History" }));
    await waitFor(() => expect(apiMocks.saveRentalYearToHistory).toHaveBeenCalledWith("property-1", restoredYear));
    expect(await screen.findByText("Read-only history restored")).toBeInTheDocument();
    confirm.mockRestore();
  });
});
