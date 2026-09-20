import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RentPaymentForm } from "../components/RentPaymentForm";

const save = vi.fn();
const refresh = vi.fn().mockResolvedValue(undefined);
const saveRentAdvance = vi.fn().mockResolvedValue({
  payments: [],
  coveredFrom: "2026-08",
  coveredTo: "2026-10",
  totalPaidPence: 300_000,
});
const updateRentAdvance = vi.fn().mockResolvedValue([]);

vi.mock("../context/PortfolioContext", () => ({
  usePortfolio: () => ({ refresh, save, saveRentAdvance, updateRentAdvance }),
}));

describe("record rent form", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockResolvedValue(undefined);
    save.mockResolvedValue(undefined);
    saveRentAdvance.mockResolvedValue({
      payments: [],
      coveredFrom: "2026-08",
      coveredTo: "2026-10",
      totalPaidPence: 300_000,
    });
    updateRentAdvance.mockResolvedValue([]);
  });

  it("calculates and submits the payment month plus additional advance months", async () => {
    const onClose = vi.fn();
    render(
      <RentPaymentForm
        propertyId="11111111-1111-4111-8111-111111111111"
        tenants={[{
          id: "22222222-2222-4222-8222-222222222222",
          organizationId: "org-1",
          kind: "tenant",
          archived: false,
          firstName: "Alex",
          lastName: "Student",
          monthlyRentPence: 100_000,
          rentFrequency: "monthly",
          createdAt: "2026-01-01",
          createdBy: "owner@example.com",
          updatedAt: "2026-01-01",
          updatedBy: "owner@example.com",
          version: 1,
        }]}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Status/), {
      target: { value: "in_advance" },
    });
    fireEvent.change(screen.getByLabelText("Date *"), {
      target: { value: "2026-08-14" },
    });
    const additionalMonths = screen.getByLabelText("Additional months paid in advance");
    expect(additionalMonths).toHaveAttribute("type", "text");
    expect(additionalMonths).toHaveAttribute("inputmode", "numeric");
    expect(additionalMonths).toHaveAttribute("maxlength", "2");
    fireEvent.change(additionalMonths, { target: { value: "48" } });
    expect(additionalMonths).toHaveValue("48");
    fireEvent.change(additionalMonths, { target: { value: "2.5" } });
    expect(additionalMonths).toHaveValue("48");
    fireEvent.change(additionalMonths, {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Rent bank reference"), {
      target: { value: "ADV-001" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "August plus two months" },
    });

    expect(screen.getByLabelText("Calculated rent received")).toHaveValue("£3,000");
    expect(screen.getByText(/August 2026 to October 2026 · 3 months · £3,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record rent" }));

    await waitFor(() => expect(saveRentAdvance).toHaveBeenCalledWith({
      propertyId: "11111111-1111-4111-8111-111111111111",
      tenantId: "22222222-2222-4222-8222-222222222222",
      tenancyId: "",
      paidDate: "2026-08-14",
      additionalMonths: 2,
      method: "bank_transfer",
      rentFrequency: "monthly",
      bankReference: "ADV-001",
      notes: "August plus two months",
    }));
    expect(save).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("warns and explicitly replaces an existing Paid entry", async () => {
    const onClose = vi.fn();
    const tenant = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "org-1",
      kind: "tenant" as const,
      archived: false,
      firstName: "Alex",
      lastName: "Student",
      monthlyRentPence: 100_000,
      createdAt: "2026-01-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-01-01",
      updatedBy: "owner@example.com",
      version: 1,
    };
    const existingPaid = {
      id: "33333333-3333-4333-8333-333333333333",
      organizationId: "org-1",
      kind: "rentPayment" as const,
      archived: false,
      propertyId: "11111111-1111-4111-8111-111111111111",
      tenantId: tenant.id,
      tenancyId: "tenancy-1",
      appliesToMonth: "2026-08",
      paidDate: "2026-08-01",
      amountPaidPence: 100_000,
      status: "paid",
      createdAt: "2026-08-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-08-01",
      updatedBy: "owner@example.com",
      version: 1,
      _etag: 'W/"1"',
    };
    render(
      <RentPaymentForm
        propertyId="11111111-1111-4111-8111-111111111111"
        tenants={[tenant]}
        payments={[existingPaid]}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByLabelText("Date *"), {
      target: { value: "2026-08-16" },
    });
    expect(screen.getByText(/Paid rent is already recorded for Alex Student in August 2026/)).toBeInTheDocument();
    expect(screen.getByText(/first replace it with Partial, Late or Adjusted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace rent entry" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/I understand and want to replace/));
    fireEvent.click(screen.getByRole("button", { name: "Replace rent entry" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(
      "rentPayment",
      expect.objectContaining({
        tenantId: tenant.id,
        tenancyId: "tenancy-1",
        paidDate: "2026-08-16",
        appliesToMonth: "2026-08",
        status: "paid",
      }),
      existingPaid,
    ));
    expect(onClose).toHaveBeenCalled();
  });

  it("adds multiple Partial entries when no Paid entry exists", async () => {
    const onClose = vi.fn();
    const tenant = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "org-1",
      kind: "tenant" as const,
      archived: false,
      firstName: "Alex",
      lastName: "Student",
      monthlyRentPence: 100_000,
      createdAt: "2026-01-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-01-01",
      updatedBy: "owner@example.com",
      version: 1,
    };
    const partial = {
      id: "44444444-4444-4444-8444-444444444444",
      organizationId: "org-1",
      kind: "rentPayment" as const,
      archived: false,
      propertyId: "11111111-1111-4111-8111-111111111111",
      tenantId: tenant.id,
      appliesToMonth: "2026-08",
      paidDate: "2026-08-01",
      amountPaidPence: 40_000,
      status: "partial",
      createdAt: "2026-08-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-08-01",
      updatedBy: "owner@example.com",
      version: 1,
    };
    render(
      <RentPaymentForm
        propertyId="11111111-1111-4111-8111-111111111111"
        tenants={[tenant]}
        payments={[partial]}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByLabelText("Date *"), {
      target: { value: "2026-08-16" },
    });
    fireEvent.change(screen.getByLabelText(/Status/), {
      target: { value: "partial" },
    });
    fireEvent.change(screen.getByLabelText("Rent received *"), {
      target: { value: "300" },
    });
    expect(screen.getByText(/This will add another Partial entry/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/I understand and want to replace/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record rent" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(
      "rentPayment",
      expect.objectContaining({
        tenantId: tenant.id,
        amountPaidPence: 30_000,
        appliesToMonth: "2026-08",
        status: "partial",
      }),
      undefined,
    ));
  });

  it("defaults a final Paid entry to the outstanding balance after instalments", () => {
    const tenant = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "org-1",
      kind: "tenant" as const,
      archived: false,
      firstName: "Alex",
      lastName: "Student",
      monthlyRentPence: 100_000,
      createdAt: "2026-01-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-01-01",
      updatedBy: "owner@example.com",
      version: 1,
    };
    const partial = {
      id: "44444444-4444-4444-8444-444444444444",
      organizationId: "org-1",
      kind: "rentPayment" as const,
      archived: false,
      propertyId: "11111111-1111-4111-8111-111111111111",
      tenantId: tenant.id,
      appliesToMonth: "2026-08",
      paidDate: "2026-08-01",
      amountPaidPence: 40_000,
      status: "partial",
      createdAt: "2026-08-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-08-01",
      updatedBy: "owner@example.com",
      version: 1,
    };
    render(
      <RentPaymentForm
        propertyId="11111111-1111-4111-8111-111111111111"
        tenants={[tenant]}
        payments={[partial]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Date *"), {
      target: { value: "2026-08-16" },
    });
    expect(screen.getByLabelText("Rent received *")).toHaveValue(600);
  });

  it("resets the paid-override confirmation when the existing record version changes", () => {
    const tenant = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "org-1",
      kind: "tenant" as const,
      archived: false,
      firstName: "Alex",
      lastName: "Student",
      monthlyRentPence: 100_000,
      createdAt: "2026-01-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-01-01",
      updatedBy: "owner@example.com",
      version: 1,
    };
    const existingPaid = {
      id: "33333333-3333-4333-8333-333333333333",
      organizationId: "org-1",
      kind: "rentPayment" as const,
      archived: false,
      propertyId: "11111111-1111-4111-8111-111111111111",
      tenantId: tenant.id,
      appliesToMonth: "2026-08",
      paidDate: "2026-08-01",
      amountPaidPence: 100_000,
      status: "paid",
      createdAt: "2026-08-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-08-01",
      updatedBy: "owner@example.com",
      version: 1,
      _etag: 'W/"1"',
    };
    const { rerender } = render(
      <RentPaymentForm
        propertyId="11111111-1111-4111-8111-111111111111"
        tenants={[tenant]}
        payments={[existingPaid]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Date *"), {
      target: { value: "2026-08-16" },
    });
    fireEvent.click(screen.getByLabelText(/I understand and want to replace/));
    expect(screen.getByLabelText(/I understand and want to replace/)).toBeChecked();

    rerender(
      <RentPaymentForm
        propertyId="11111111-1111-4111-8111-111111111111"
        tenants={[tenant]}
        payments={[{ ...existingPaid, amountPaidPence: 80_000, _etag: 'W/"2"' }]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/I understand and want to replace/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Replace rent entry" })).toBeDisabled();
  });

  it("edits one ordinary rent entry without creating another record", async () => {
    const tenant = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "org-1",
      kind: "tenant" as const,
      archived: false,
      firstName: "Alex",
      lastName: "Student",
      monthlyRentPence: 100_000,
      createdAt: "2026-01-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-01-01",
      updatedBy: "owner@example.com",
      version: 1,
    };
    const entry = {
      id: "55555555-5555-4555-8555-555555555555",
      organizationId: "org-1",
      kind: "rentPayment" as const,
      archived: false,
      propertyId: "11111111-1111-4111-8111-111111111111",
      tenantId: tenant.id,
      appliesToMonth: "2026-08",
      dueDate: "2026-08-10",
      paidDate: "2026-08-10",
      amountDuePence: 75_000,
      amountPaidPence: 50_000,
      status: "partial",
      method: "bank_transfer",
      rentFrequency: "monthly",
      bankReference: "OLD-REF",
      notes: "Original note",
      createdAt: "2026-08-10",
      createdBy: "owner@example.com",
      updatedAt: "2026-08-10",
      updatedBy: "owner@example.com",
      version: 1,
      _etag: 'W/"1"',
    };
    const finalPaid = {
      ...entry,
      id: "66666666-6666-4666-8666-666666666666",
      amountDuePence: 100_000,
      amountPaidPence: 50_000,
      status: "paid",
      notes: "Final instalment",
    };
    render(<RentPaymentForm propertyId={entry.propertyId} tenants={[tenant]} payments={[entry, finalPaid]} record={entry} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Edit rent entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tenant *")).toBeDisabled();
    expect(screen.getByLabelText("Rent received *")).toHaveValue(500);
    expect(screen.getByLabelText("Notes")).toHaveValue("Original note");
    fireEvent.change(screen.getByLabelText("Rent received *"), { target: { value: "650" } });
    fireEvent.change(screen.getByLabelText("Status *"), { target: { value: "late" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Corrected late payment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(
      "rentPayment",
      expect.objectContaining({ dueDate: "2026-08-10", amountDuePence: 75_000, amountPaidPence: 65_000, status: "late", notes: "Corrected late payment" }),
      entry,
    ));
  });

  it("edits shared receipt details for a linked advance payment", async () => {
    const tenant = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "org-1",
      kind: "tenant" as const,
      archived: false,
      firstName: "Alex",
      lastName: "Student",
      monthlyRentPence: 100_000,
      createdAt: "2026-01-01",
      createdBy: "owner@example.com",
      updatedAt: "2026-01-01",
      updatedBy: "owner@example.com",
      version: 1,
    };
    const entry = {
      id: "advance-entry-1",
      organizationId: "org-1",
      kind: "rentPayment" as const,
      archived: false,
      propertyId: "11111111-1111-4111-8111-111111111111",
      tenantId: tenant.id,
      appliesToMonth: "2026-08",
      dueDate: "2026-08-14",
      paidDate: "2026-08-14",
      amountPaidPence: 100_000,
      status: "in_advance",
      method: "bank_transfer",
      rentFrequency: "monthly",
      bankReference: "ADV-OLD",
      notes: "Original advance note",
      advancePaymentId: "advance-group-1",
      advanceAdditionalMonths: 2,
      advanceCoveredFrom: "2026-08",
      advanceCoveredTo: "2026-10",
      createdAt: "2026-08-14",
      createdBy: "owner@example.com",
      updatedAt: "2026-08-14",
      updatedBy: "owner@example.com",
      version: 1,
      _etag: 'W/"1"',
    };
    render(<RentPaymentForm propertyId={entry.propertyId} tenants={[tenant]} payments={[entry]} record={entry} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Edit advance payment" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Additional months paid in advance")).not.toBeInTheDocument();
    expect(screen.getByText(/August 2026 to October 2026 · 3 months · £3,000/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Date *"), { target: { value: "2026-08-16" } });
    fireEvent.change(screen.getByLabelText("Rent bank reference"), { target: { value: "ADV-CORRECTED" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Corrected group note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateRentAdvance).toHaveBeenCalledWith(entry, expect.objectContaining({
      paidDate: "2026-08-16",
      bankReference: "ADV-CORRECTED",
      notes: "Corrected group note",
    })));
    expect(save).not.toHaveBeenCalled();
  });
});
