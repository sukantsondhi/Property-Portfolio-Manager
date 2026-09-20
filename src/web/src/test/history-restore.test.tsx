import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryDetailPage } from "../pages/HistoryDetailPage";

const refresh = vi.fn().mockResolvedValue(undefined);
const apiMocks = vi.hoisted(() => ({
  restoreRentalYear: vi.fn().mockResolvedValue({ status: "restored" }),
}));
const property = { id: "property-1", organizationId: "org-1", kind: "property", archived: false, name: "Oak House", createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", version: 1 };
const closedYear = { id: "year-2026", organizationId: "org-1", kind: "rentalYear", archived: false, propertyId: property.id, label: "2026/27", startDate: "2026-09-01", endDate: "2027-08-31", annualRentPence: 1_200_000, status: "closed", propertySnapshot: { name: "Oak House" }, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", version: 2, _etag: 'W/"2"' };
const currentYear = { ...closedYear, id: "year-2027", label: "2027/28", startDate: "2027-09-01", endDate: "2028-08-31", status: "current", version: 1, _etag: 'W/"1"' };

vi.mock("../context/PortfolioContext", () => ({ usePortfolio: () => ({ records: [property, closedYear, currentYear], refresh }) }));
vi.mock("../lib/api", () => ({ api: apiMocks }));

describe("historical rental-year restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockResolvedValue(undefined);
    apiMocks.restoreRentalYear.mockResolvedValue({ ...closedYear, status: "restored" });
  });

  it("shows only saved rental years and requires confirmation before restoring", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MemoryRouter initialEntries={["/app/history/property-1/year-2026"]}><Routes><Route path="/app/history/:propertyId/:yearId" element={<HistoryDetailPage />} /><Route path="/app/properties/:propertyId" element={<div>Restored property workspace</div>} /></Routes></MemoryRouter>);
    const selector = screen.getByLabelText("Rental year");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(selector).toHaveValue("year-2026");
    fireEvent.click(screen.getByRole("button", { name: "Restore for editing" }));
    await waitFor(() => expect(apiMocks.restoreRentalYear).toHaveBeenCalledWith("property-1", closedYear));
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByText("Restored property workspace")).toBeInTheDocument();
    confirm.mockRestore();
  });
});
