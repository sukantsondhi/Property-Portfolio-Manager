import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyForm } from "../components/PropertyForm";

const save = vi.fn();
const apiMocks = vi.hoisted(() => ({
  updateRestoredYearProperty: vi.fn(),
  uploadDocument: vi.fn(),
}));

vi.mock("../context/PortfolioContext", () => ({
  usePortfolio: () => ({ save, records: [], setArchived: vi.fn() }),
}));
vi.mock("../lib/api", () => ({ api: apiMocks }));

describe("property form", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue({ id: "property-1", kind: "property" });
    apiMocks.uploadDocument.mockRejectedValue(new Error("Upload failed."));
  });

  it("requires and saves a monthly rent collection day", async () => {
    render(<PropertyForm onClose={vi.fn()} />);
    const collectionDay = screen.getByRole("combobox", {
      name: /Monthly rent collection date/,
    });
    expect(collectionDay).toBeRequired();
    expect(collectionDay).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Property name *"), { target: { value: "Oak House" } });
    fireEvent.change(screen.getByLabelText("Address line 1 *"), { target: { value: "1 High Street" } });
    fireEvent.change(screen.getByLabelText("City *"), { target: { value: "Egham" } });
    fireEvent.change(screen.getByLabelText("Postcode *"), { target: { value: "TW20 0EX" } });
    fireEvent.change(screen.getByLabelText("Tenancy start *"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Tenancy end *"), { target: { value: "2027-08-31" } });
    fireEvent.change(collectionDay, { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Rent amount *"), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("property", expect.objectContaining({ rentCollectionDay: 9 }), undefined));
  });

  it("uses the latest restored-year ETag when a later save step is retried", async () => {
    const property = {
      id: "property-1",
      kind: "property" as const,
      organizationId: "org-1",
      archived: false,
      name: "Oak House",
      propertyType: "house",
      addressLine1: "1 High Street",
      city: "Egham",
      postcode: "TW20 0EX",
      status: "active",
      bedrooms: 2,
      bathrooms: 1,
      tenancyStartDate: "2026-09-01",
      tenancyEndDate: "2027-08-31",
      rentCollectionDay: 9,
      monthlyRentPence: 100_000,
      rentInputFrequency: "monthly",
      createdAt: "",
      createdBy: "",
      updatedAt: "",
      updatedBy: "",
      version: 1,
    };
    const rentalYear = {
      id: "year-1",
      kind: "rentalYear" as const,
      organizationId: "org-1",
      archived: false,
      propertyId: property.id,
      status: "restored",
      createdAt: "",
      createdBy: "",
      updatedAt: "",
      updatedBy: "",
      version: 1,
      _etag: 'W/"1"',
    };
    const latestYear = { ...rentalYear, version: 2, _etag: 'W/"2"' };
    const onDone = vi.fn().mockRejectedValue(new Error("Refresh failed."));
    apiMocks.updateRestoredYearProperty.mockResolvedValue(latestYear);
    const { container } = render(<PropertyForm record={property} rentalYear={rentalYear} onClose={vi.fn()} onDone={onDone} />);

    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByText("Refresh failed.")).toBeInTheDocument();
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(apiMocks.updateRestoredYearProperty).toHaveBeenCalledTimes(2));
    expect(apiMocks.updateRestoredYearProperty.mock.calls[1]?.[1]).toMatchObject({ _etag: 'W/"2"' });
  });
});
