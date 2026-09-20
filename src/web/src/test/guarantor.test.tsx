import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PropertyDetailPage } from "../pages/PropertyDetailPage";

const records = [
  { id: "property-1", organizationId: "org-1", kind: "property", archived: false, name: "Student House", addressLine1: "1 Test Road", city: "London", postcode: "SW1 1AA", status: "active", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
  { id: "tenant-1", organizationId: "org-1", kind: "tenant", archived: false, propertyId: "property-1", firstName: "Alex", lastName: "Student", email: "alex@example.com", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
  { id: "guarantor-1", organizationId: "org-1", kind: "guarantor", archived: false, tenantId: "tenant-1", name: "Jamie Student", relationship: "Parent", email: "jamie@example.com", phone: "07123 456789", address: "2 Family Road, London", status: "approved", createdAt: "2026-01-01", createdBy: "owner@example.com", updatedAt: "2026-01-01", updatedBy: "owner@example.com", version: 1 },
];

vi.mock("../context/PortfolioContext", () => ({
  usePortfolio: () => ({ records, refresh: vi.fn(), setArchived: vi.fn() }),
}));

describe("property guarantors", () => {
  it("shows guarantors in a dedicated tab with their linked tenant", () => {
    render(<MemoryRouter initialEntries={["/app/properties/property-1"]}><Routes><Route path="/app/properties/:id" element={<PropertyDetailPage />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Guarantors/ }));

    expect(screen.getByRole("heading", { name: "Guarantors" })).toBeInTheDocument();
    expect(screen.getByText("Jamie Student")).toBeInTheDocument();
    expect(screen.getByText("Linked tenant")).toBeInTheDocument();
    expect(screen.getByText("Alex Student")).toBeInTheDocument();
    expect(screen.getByText("Parent")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText(/jamie@example.com/)).toBeInTheDocument();
    expect(screen.getByText("2 Family Road, London")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add guarantor" }));
    expect(screen.getByLabelText(/Linked tenant/)).toHaveValue("tenant-1");
  });
});
