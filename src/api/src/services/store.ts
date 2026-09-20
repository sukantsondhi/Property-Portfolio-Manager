import { BulkOperationType, CosmosClient, type Container, type OperationInput } from "@azure/cosmos";
import { randomUUID } from "node:crypto";
import type {
  AuthenticatedUser,
  AdvanceRentPaymentInput,
  AdvanceRentPaymentUpdateInput,
  ListPage,
  ListOptions,
  PortfolioRecord,
  RecordKind,
  StartRentalYearInput,
} from "../domain/types";
import { getCredential } from "./credential";
import { StoreError } from "./responses";

export interface RecordStore {
  list(kind: RecordKind, options?: ListOptions): Promise<PortfolioRecord[]>;
  listPage(
    kind: RecordKind,
    options?: ListOptions,
    continuationToken?: string,
  ): Promise<ListPage>;
  allActive(): Promise<PortfolioRecord[]>;
  get(kind: RecordKind, id: string): Promise<PortfolioRecord>;
  create(
    kind: RecordKind,
    data: Record<string, unknown>,
    user: AuthenticatedUser,
  ): Promise<PortfolioRecord>;
  createRentAdvance(
    input: AdvanceRentPaymentInput,
    user: AuthenticatedUser,
  ): Promise<PortfolioRecord[]>;
  updateRentAdvance(
    id: string,
    input: AdvanceRentPaymentUpdateInput,
    user: AuthenticatedUser,
    etag?: string,
  ): Promise<PortfolioRecord[]>;
  update(
    kind: RecordKind,
    id: string,
    data: Record<string, unknown>,
    user: AuthenticatedUser,
    etag?: string,
  ): Promise<PortfolioRecord>;
  setArchived(
    kind: RecordKind,
    id: string,
    archived: boolean,
    user: AuthenticatedUser,
    etag?: string,
  ): Promise<PortfolioRecord>;
  permanentDelete(
    kind: RecordKind,
    id: string,
    etag?: string,
  ): Promise<{ deletedCount: number; blobNames: string[] }>;
  purgeAll(): Promise<{ deletedCount: number; blobNames: string[] }>;
  startRentalYear(
    propertyId: string,
    input: StartRentalYearInput,
    user: AuthenticatedUser,
  ): Promise<{
    current: PortfolioRecord;
    closed?: PortfolioRecord;
    recordsMoved: number;
  }>;
  restoreRentalYear(
    propertyId: string,
    yearId: string,
    user: AuthenticatedUser,
    etag?: string,
  ): Promise<PortfolioRecord>;
  saveRentalYearToHistory(
    propertyId: string,
    yearId: string,
    user: AuthenticatedUser,
    etag?: string,
  ): Promise<PortfolioRecord>;
  updateRestoredYearProperty(
    propertyId: string,
    yearId: string,
    data: Record<string, unknown>,
    user: AuthenticatedUser,
    etag?: string,
  ): Promise<PortfolioRecord>;
}

const yearScopedKinds = new Set<RecordKind>([
  "tenant",
  "guarantor",
  "reference",
  "tenancy",
  "rentPayment",
  "expense",
  "document",
]);

function previousDay(isoDate: string) {
  const value = new Date(`${isoDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function addMonths(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const value = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dateInMonth(sourceDate: string, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const sourceDay = Number(sourceDate.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(sourceDay, lastDay)).padStart(2, "0")}`;
}

function recordedMonth(record: Record<string, unknown>) {
  return String(record.appliesToMonth || record.paidDate || record.dueDate || "").slice(0, 7);
}

const advanceManagedFields = [
  "advancePaymentId",
  "advanceSequence",
  "advanceAdditionalMonths",
  "advanceCoveredFrom",
  "advanceCoveredTo",
] as const;

type RentPaymentMonthGuard = {
  id: string;
  organizationId: string;
  kind: "rentPaymentMonthGuard";
  archived: true;
  propertyId: string;
  tenantId: string;
  rentalYearId?: string;
  appliesToMonth: string;
  paymentId: string;
  paymentStatus: "paid" | "in_advance";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  _etag?: string;
  [key: string]: unknown;
};

type RentalYearLifecycleGuard = {
  id: string;
  organizationId: string;
  kind: "rentalYearLifecycleGuard";
  archived: true;
  propertyId: string;
  rentalYearId: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  _etag?: string;
};

function rentalYearLifecycleGuardId(propertyId: string) {
  return `rental-year-lifecycle-guard-${propertyId}`;
}

function isAdvanceManaged(record: Record<string, unknown>) {
  return (
    String(record.status || "") === "in_advance" ||
    advanceManagedFields.some((field) => record[field] !== undefined)
  );
}

function hasExclusiveRentStatus(record: Record<string, unknown>) {
  const status = String(record.status || "");
  return status === "paid" || status === "in_advance";
}

function rentPaymentGuardId(record: Record<string, unknown>) {
  return `rent-payment-guard-${String(record.tenantId || "")}-${String(record.rentalYearId || "current")}-${recordedMonth(record)}`;
}

abstract class BaseStore implements RecordStore {
  constructor(protected readonly organizationId = "test-organization") {}
  abstract list(
    kind: RecordKind,
    options?: ListOptions,
  ): Promise<PortfolioRecord[]>;
  abstract listPage(
    kind: RecordKind,
    options?: ListOptions,
    continuationToken?: string,
  ): Promise<ListPage>;
  abstract allActive(): Promise<PortfolioRecord[]>;
  abstract allRecords(): Promise<PortfolioRecord[]>;
  abstract get(kind: RecordKind, id: string): Promise<PortfolioRecord>;
  abstract put(
    record: PortfolioRecord,
    etag?: string,
  ): Promise<PortfolioRecord>;
  protected async putHistoricalSnapshot(record: PortfolioRecord) {
    return this.put(record);
  }
  protected abstract putMany(records: PortfolioRecord[]): Promise<PortfolioRecord[]>;
  protected async createRentPaymentRecord(record: PortfolioRecord) {
    return this.put(record);
  }
  protected async createRentAdvanceRecords(records: PortfolioRecord[]) {
    return this.putMany(records);
  }
  protected async saveRentAdvanceRecords(
    _current: PortfolioRecord[],
    candidates: PortfolioRecord[],
  ) {
    return this.putMany(candidates);
  }
  protected async saveRentAdvanceArchiveRecords(
    _current: PortfolioRecord[],
    candidates: PortfolioRecord[],
    _archived: boolean,
  ) {
    return this.putMany(candidates);
  }
  protected async saveRentalYearRestoration(
    _current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    return this.put(candidate, etag);
  }
  protected async saveRentalYearClosure(
    _current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    return this.put(candidate, etag);
  }
  protected async saveRestoredYearSnapshot(
    _current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    return this.put(candidate, etag);
  }
  protected async saveRentPaymentRecord(
    current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    return this.put(candidate, etag);
  }
  abstract remove(records: PortfolioRecord[]): Promise<void>;
  private async requireActive(kind: RecordKind, id: string, label: string) {
    const record = await this.get(kind, id);
    if (record.archived)
      throw new StoreError(
        409,
        "parent_archived",
        `Restore the linked ${label} before saving this record.`,
      );
    return record;
  }
  private async assertRelationships(
    kind: RecordKind,
    data: Record<string, unknown>,
  ) {
    const propertyId = String(data.propertyId ?? "");
    if (kind !== "property" && propertyId)
      await this.requireActive("property", propertyId, "property");

    const tenantId = String(data.tenantId ?? "");
    let tenant: PortfolioRecord | undefined;
    if (tenantId) {
      tenant = await this.requireActive("tenant", tenantId, "tenant");
      if (propertyId && tenant.propertyId !== propertyId)
        throw new StoreError(
          409,
          "relationship_mismatch",
          "The selected tenant belongs to a different property.",
        );
    }

    if (Array.isArray(data.tenantIds)) {
      for (const linkedTenantId of data.tenantIds) {
        const linkedTenant = await this.requireActive(
          "tenant",
          String(linkedTenantId),
          "tenant",
        );
        if (propertyId && linkedTenant.propertyId !== propertyId)
          throw new StoreError(
            409,
            "relationship_mismatch",
            "Every selected tenant must belong to the tenancy property.",
          );
      }
    }

    const tenancyId = String(data.tenancyId ?? "");
    if (tenancyId) {
      const tenancy = await this.requireActive(
        "tenancy",
        tenancyId,
        "tenancy",
      );
      if (propertyId && tenancy.propertyId !== propertyId)
        throw new StoreError(
          409,
          "relationship_mismatch",
          "The selected tenancy belongs to a different property.",
        );
      if (
        tenantId &&
        Array.isArray(tenancy.tenantIds) &&
        !tenancy.tenantIds.includes(tenantId)
      )
        throw new StoreError(
          409,
          "relationship_mismatch",
          "The selected tenant is not part of this tenancy.",
        );
    }

    const rentalYearId = String(data.rentalYearId ?? "");
    if (rentalYearId) {
      const rentalYear = await this.requireActive(
        "rentalYear",
        rentalYearId,
        "rental year",
      );
      const owningPropertyId = propertyId || String(tenant?.propertyId ?? "");
      if (
        owningPropertyId &&
        rentalYear.propertyId !== owningPropertyId
      )
        throw new StoreError(
          409,
          "relationship_mismatch",
          "The rental year belongs to a different property.",
        );
    }

    const documentId = String(data.documentId ?? data.imageDocumentId ?? "");
    if (documentId) {
      const document = await this.requireActive(
        "document",
        documentId,
        "document",
      );
      const documentPropertyId = kind === "property" ? String(data.id ?? "") : propertyId;
      if (documentPropertyId && document.propertyId !== documentPropertyId)
        throw new StoreError(
          409,
          "relationship_mismatch",
          "The linked document belongs to a different property.",
        );
      if (
        data.imageDocumentId &&
        (!String(document.mimeType).startsWith("image/") ||
          document.category !== "property_image")
      )
        throw new StoreError(
          409,
          "invalid_property_image",
          "The selected property picture is not a valid image upload.",
        );
    }
  }
  private async assertWritableRentalYear(data: Record<string, unknown>) {
    const rentalYearId = String(data.rentalYearId ?? "");
    if (!rentalYearId) return;
    const year = await this.get("rentalYear", rentalYearId);
    if (year.status === "closed")
      throw new StoreError(
        409,
        "historical_record",
        "Closed rental-year records are read-only. Restore the year before making changes.",
      );
  }
  private async createHistoricalRecord(
    kind: RecordKind,
    data: Record<string, unknown>,
    user: AuthenticatedUser,
  ) {
    const id = randomUUID();
    await this.assertRelationships(kind, { ...data, id });
    const now = new Date().toISOString();
    return this.putHistoricalSnapshot({
      id,
      organizationId: this.organizationId,
      kind,
      archived: false,
      ...data,
      createdAt: now,
      createdBy: user.email,
      updatedAt: now,
      updatedBy: user.email,
      version: 1,
    } as PortfolioRecord);
  }
  async create(
    kind: RecordKind,
    data: Record<string, unknown>,
    user: AuthenticatedUser,
  ) {
    const prepared = { ...data };
    if (yearScopedKinds.has(kind) && !prepared.rentalYearId) {
      let propertyId =
        typeof prepared.propertyId === "string" ? prepared.propertyId : "";
      if (!propertyId && typeof prepared.tenantId === "string") {
        const tenant = await this.get("tenant", prepared.tenantId);
        propertyId = String(tenant.propertyId ?? "");
      }
      if (propertyId) {
        const current = (
          await this.list("rentalYear", { propertyId, limit: 200 })
        ).find((record) => record.status === "current");
        if (current) prepared.rentalYearId = current.id;
      }
    }
    const id = randomUUID();
    if (kind !== "rentalYear") await this.assertWritableRentalYear(prepared);
    await this.assertRelationships(kind, { ...prepared, id });
    if (kind === "rentPayment") {
      if (isAdvanceManaged(prepared))
        throw new StoreError(
          405,
          "managed_record",
          "Rent paid in advance must be recorded through the protected advance-payment workflow.",
        );
      const propertyId = String(prepared.propertyId ?? "");
      const tenantId = String(prepared.tenantId ?? "");
      const month = recordedMonth(prepared);
      const existing = propertyId && tenantId && month
        ? (await this.list("rentPayment", {
            propertyId,
            tenantId,
            ...(prepared.rentalYearId
              ? { rentalYearId: String(prepared.rentalYearId) }
              : {}),
            limit: 200,
          })).filter((payment) => recordedMonth(payment) === month)
        : [];
      if (existing.some((payment) => payment.status === "in_advance"))
        throw new StoreError(
          409,
          "advance_month_managed",
          "This month is covered by a linked advance payment and cannot receive a separate rent entry.",
        );
      if (existing.some((payment) => payment.status === "paid"))
        throw new StoreError(
          409,
          "rent_payment_requires_override",
          "A Paid rent entry already exists for this tenant and month. Replace that entry instead of creating another one.",
        );
    }
    const now = new Date().toISOString();
    const record = {
      id,
      organizationId: this.organizationId,
      kind,
      archived: false,
      ...prepared,
      createdAt: now,
      createdBy: user.email,
      updatedAt: now,
      updatedBy: user.email,
      version: 1,
    } as PortfolioRecord;
    return kind === "rentPayment"
      ? this.createRentPaymentRecord(record)
      : this.put(record);
  }
  async createRentAdvance(
    input: AdvanceRentPaymentInput,
    user: AuthenticatedUser,
  ) {
    if (!Number.isInteger(input.additionalMonths) || input.additionalMonths < 1 || input.additionalMonths > 48)
      throw new StoreError(400, "invalid_advance_months", "Additional months must be a whole number from 1 to 48.");
    const property = await this.requireActive("property", input.propertyId, "property");
    const tenant = await this.requireActive("tenant", input.tenantId, "tenant");
    const tenancy = input.tenancyId
      ? await this.requireActive("tenancy", input.tenancyId, "tenancy")
      : undefined;
    await this.assertRelationships("rentPayment", input as unknown as Record<string, unknown>);
    const monthlyRentPence = Number(tenant.monthlyRentPence || 0);
    if (!Number.isInteger(monthlyRentPence) || monthlyRentPence <= 0)
      throw new StoreError(
        409,
        "tenant_rent_required",
        "Set a positive monthly rent for this tenant before recording rent in advance.",
      );

    const rentalYears = await this.list("rentalYear", { propertyId: input.propertyId, limit: 200 });
    const targetYear = input.rentalYearId
      ? rentalYears.find((record) => record.id === input.rentalYearId)
      : rentalYears.find((record) => record.status === "current");
    if (input.rentalYearId && !targetYear)
      throw new StoreError(404, "rental_year_not_found", "The selected rental year was not found for this property.");
    if (targetYear?.status === "closed")
      throw new StoreError(409, "historical_record", "Closed rental-year records are read-only. Restore the year before recording rent.");
    if (targetYear) {
      if (tenant.rentalYearId !== targetYear.id)
        throw new StoreError(
          409,
          "relationship_mismatch",
          "Choose a tenant from the selected rental year before recording rent in advance.",
        );
      if (tenancy && tenancy.rentalYearId !== targetYear.id)
        throw new StoreError(
          409,
          "relationship_mismatch",
          "Choose a tenancy from the selected rental year before recording rent in advance.",
        );
    }
    const rentProperty = targetYear?.status === "restored" && targetYear.propertySnapshot && typeof targetYear.propertySnapshot === "object"
      ? targetYear.propertySnapshot as Record<string, unknown>
      : property;
    const firstMonth = input.paidDate.slice(0, 7);
    const months = Array.from(
      { length: input.additionalMonths + 1 },
      (_, index) => addMonths(firstMonth, index),
    );
    const lastMonth = months.at(-1)!;
    const validStarts = [rentProperty.tenancyStartDate, targetYear?.startDate]
      .map((value) => String(value || "").slice(0, 7))
      .filter(Boolean);
    const validEnds = [rentProperty.tenancyEndDate, targetYear?.endDate]
      .map((value) => String(value || "").slice(0, 7))
      .filter(Boolean);
    if (
      validStarts.some((start) => firstMonth < start) ||
      validEnds.some((end) => lastMonth > end)
    )
      throw new StoreError(
        409,
        "advance_outside_tenancy",
        "The selected advance period must stay inside the current tenancy and rental year.",
      );

    const paymentOptions = {
      propertyId: input.propertyId,
      tenantId: input.tenantId,
      ...(targetYear ? { rentalYearId: targetYear.id } : {}),
      limit: 200,
    };
    const existing = [
      ...(await this.list("rentPayment", paymentOptions)),
      ...(await this.list("rentPayment", { ...paymentOptions, archived: true })),
    ];
    if (existing.some((payment) => months.includes(recordedMonth(payment))))
      throw new StoreError(
        409,
        "rent_month_already_recorded",
        "One or more covered months already has a rent record for this tenant. Review those entries before recording the advance payment.",
      );

    const advancePaymentId = randomUUID();
    const now = new Date().toISOString();
    const records = months.map((month, advanceSequence): PortfolioRecord => ({
      id: `advance-rent-${input.tenantId}-${targetYear?.id ?? "current"}-${month}`,
      organizationId: this.organizationId,
      kind: "rentPayment",
      archived: false,
      propertyId: input.propertyId,
      tenantId: input.tenantId,
      tenancyId: input.tenancyId ?? "",
      ...(targetYear ? { rentalYearId: targetYear.id } : {}),
      dueDate: dateInMonth(input.paidDate, month),
      paidDate: input.paidDate,
      appliesToMonth: month,
      amountDuePence: monthlyRentPence,
      amountPaidPence: monthlyRentPence,
      method: input.method,
      rentFrequency: input.rentFrequency,
      bankReference: input.bankReference,
      status: "in_advance",
      notes: input.notes,
      advancePaymentId,
      advanceSequence,
      advanceAdditionalMonths: input.additionalMonths,
      advanceCoveredFrom: firstMonth,
      advanceCoveredTo: lastMonth,
      createdAt: now,
      createdBy: user.email,
      updatedAt: now,
      updatedBy: user.email,
      version: 1,
    }));
    for (const record of records)
      await this.assertRelationships("rentPayment", record);
    return this.createRentAdvanceRecords(records);
  }
  async updateRentAdvance(
    id: string,
    input: AdvanceRentPaymentUpdateInput,
    user: AuthenticatedUser,
    etag?: string,
  ) {
    const selected = await this.get("rentPayment", id);
    if (!isAdvanceManaged(selected) || !selected.advancePaymentId)
      throw new StoreError(
        405,
        "managed_record_required",
        "This entry is not part of a linked advance payment.",
      );
    if (selected.archived)
      throw new StoreError(409, "record_archived", "Restore this advance payment before editing it.");
    if (selected.rentalYearId) {
      const year = await this.get("rentalYear", String(selected.rentalYearId));
      if (year.status === "closed")
        throw new StoreError(409, "historical_record", "Closed rental-year records are read-only.");
    }
    if (etag && selected._etag && etag !== selected._etag)
      throw new StoreError(409, "version_conflict", "This rent entry changed since it was opened. Refresh and try again.");
    const coveredFrom = String(selected.advanceCoveredFrom || recordedMonth(selected));
    if (input.paidDate.slice(0, 7) !== coveredFrom)
      throw new StoreError(
        400,
        "advance_receipt_month_changed",
        `The receipt date must remain within ${coveredFrom}. Delete and re-record the advance payment to change its covered months.`,
      );
    const current = (await this.allRecords())
      .filter((record) => record.kind === "rentPayment" && record.advancePaymentId === selected.advancePaymentId && !record.archived)
      .sort((a, b) => Number(a.advanceSequence || 0) - Number(b.advanceSequence || 0));
    if (!current.length)
      throw new StoreError(404, "advance_payment_not_found", "The linked advance payment was not found.");
    const timestamp = new Date().toISOString();
    const candidates = current.map((record): PortfolioRecord => ({
      ...record,
      paidDate: input.paidDate,
      dueDate: dateInMonth(input.paidDate, recordedMonth(record)),
      method: input.method,
      rentFrequency: input.rentFrequency,
      bankReference: input.bankReference,
      notes: input.notes,
      updatedAt: timestamp,
      updatedBy: user.email,
      version: record.version + 1,
    }));
    return this.saveRentAdvanceRecords(current, candidates);
  }
  async update(
    kind: RecordKind,
    id: string,
    data: Record<string, unknown>,
    user: AuthenticatedUser,
    etag?: string,
  ) {
    const current = await this.get(kind, id);
    if (current.archived)
      throw new StoreError(
        409,
        "record_archived",
        "Restore this record before editing it.",
      );
    if (kind !== "rentalYear" && current.rentalYearId) {
      const year = await this.get("rentalYear", String(current.rentalYearId));
      if (year.status === "closed")
        throw new StoreError(
          409,
          "historical_record",
          "Closed rental-year records are read-only.",
        );
    }
    if (
      kind === "tenant" &&
      data.propertyId !== undefined &&
      data.propertyId !== current.propertyId
    )
      throw new StoreError(
        409,
        "immutable_relationship",
        "A tenant cannot be moved between properties. Archive this tenant and add a new property record instead.",
      );
    if (etag && current._etag && etag !== current._etag)
      throw new StoreError(
        409,
        "version_conflict",
        "This record changed since it was opened. Refresh and try again.",
      );
    const candidate: PortfolioRecord = {
      ...current,
      ...data,
      id,
      organizationId: this.organizationId,
      kind,
      updatedAt: new Date().toISOString(),
      updatedBy: user.email,
      version: current.version + 1,
    };
    if (kind !== "rentalYear") await this.assertWritableRentalYear(candidate);
    await this.assertRelationships(kind, candidate);
    if (kind === "rentPayment") {
      if (isAdvanceManaged(current) || isAdvanceManaged(candidate))
        throw new StoreError(
          405,
          "managed_record",
          "Rent paid in advance must be updated through the protected advance-payment workflow.",
        );
      const month = recordedMonth(candidate);
      const linked = (
        await this.list("rentPayment", {
          propertyId: String(candidate.propertyId ?? ""),
          tenantId: String(candidate.tenantId ?? ""),
          ...(candidate.rentalYearId
            ? { rentalYearId: String(candidate.rentalYearId) }
            : {}),
          limit: 200,
        })
      ).filter(
        (payment) =>
          payment.id !== current.id && recordedMonth(payment) === month,
      );
      if (linked.some((payment) => payment.status === "in_advance"))
        throw new StoreError(
          409,
          "advance_month_managed",
          "This month is covered by a linked advance payment and cannot receive a separate rent entry.",
        );
      if (
        month !== recordedMonth(current) &&
        linked.some((payment) => payment.status === "paid")
      )
        throw new StoreError(
          409,
          "rent_payment_requires_override",
          "A Paid rent entry already exists for this tenant and month. Replace that entry instead of moving another entry into the month.",
        );
      if (
        candidate.status === "paid" &&
        linked.some((payment) => payment.status === "paid")
      )
        throw new StoreError(
          409,
          "duplicate_paid_rent",
          "Only one Paid rent entry is allowed for each tenant and month.",
        );
    }
    return kind === "rentPayment"
      ? this.saveRentPaymentRecord(current, candidate, etag)
      : this.put(candidate, etag);
  }
  async setArchived(
    kind: RecordKind,
    id: string,
    archived: boolean,
    user: AuthenticatedUser,
    etag?: string,
  ) {
    const current = await this.get(kind, id);
    if (kind !== "rentalYear" && current.rentalYearId) {
      const year = await this.get("rentalYear", String(current.rentalYearId));
      if (year.status === "closed")
        throw new StoreError(
          409,
          "historical_record",
          "Closed rental-year records are read-only.",
        );
    }
    if (etag && current._etag && etag !== current._etag)
      throw new StoreError(
        409,
        "version_conflict",
        "This record changed since it was opened. Refresh and try again.",
      );
    if (kind === "rentPayment" && isAdvanceManaged(current)) {
      if (!current.advancePaymentId)
        throw new StoreError(409, "advance_group_missing", "This legacy advance entry cannot be changed safely.");
      const group = (await this.allRecords())
        .filter((record) => record.kind === "rentPayment" && record.advancePaymentId === current.advancePaymentId)
        .sort((a, b) => Number(a.advanceSequence || 0) - Number(b.advanceSequence || 0));
      if (!group.length)
        throw new StoreError(404, "advance_payment_not_found", "The linked advance payment was not found.");
      if (!archived) {
        const active = (await this.list("rentPayment", {
          propertyId: String(current.propertyId || ""),
          tenantId: String(current.tenantId || ""),
          ...(current.rentalYearId ? { rentalYearId: String(current.rentalYearId) } : {}),
          limit: 200,
        })).filter((payment) => payment.advancePaymentId !== current.advancePaymentId);
        if (active.some((payment) => group.some((item) => recordedMonth(item) === recordedMonth(payment))))
          throw new StoreError(409, "rent_month_already_recorded", "One or more months now has another rent entry. Remove that entry before restoring this advance payment.");
      }
      const timestamp = new Date().toISOString();
      const candidates = group.map((record): PortfolioRecord => ({
        ...record,
        archived,
        updatedAt: timestamp,
        updatedBy: user.email,
        version: record.version + 1,
      }));
      const saved = await this.saveRentAdvanceArchiveRecords(group, candidates, archived);
      return saved.find((record) => record.id === id) ?? saved[0];
    }
    if (!archived) await this.assertRestoreParents(current);
    const candidate = {
      ...current,
      archived,
      updatedAt: new Date().toISOString(),
      updatedBy: user.email,
      version: current.version + 1,
    };
    return kind === "rentPayment"
      ? this.saveRentPaymentRecord(current, candidate, etag)
      : this.put(candidate, etag);
  }
  private async assertRestoreParents(record: PortfolioRecord) {
    if (record.kind === "property") return;
    let propertyId = String(record.propertyId ?? "");
    const tenantId = String(record.tenantId ?? "");
    if (tenantId) {
      const tenant = await this.get("tenant", tenantId);
      if (tenant.archived)
        throw new StoreError(
          409,
          "parent_archived",
          "Restore the linked tenant before restoring this record.",
        );
      propertyId ||= String(tenant.propertyId ?? "");
    }
    if (!propertyId) return;
    const property = await this.get("property", propertyId);
    if (property.archived)
      throw new StoreError(
        409,
        "parent_archived",
        "Restore the owning property before restoring this record.",
      );
  }
  async permanentDelete(kind: RecordKind, id: string, etag?: string) {
    const current = await this.get(kind, id);
    if (kind === "rentPayment" && isAdvanceManaged(current))
      throw new StoreError(
        405,
        "managed_record",
        "Rent paid in advance cannot be permanently deleted outside the protected advance-payment workflow.",
      );
    if (!current.archived)
      throw new StoreError(
        409,
        "not_archived",
        "Archive this record before permanently deleting it.",
      );
    if (etag && current._etag && etag !== current._etag)
      throw new StoreError(
        409,
        "version_conflict",
        "This record changed since it was opened. Refresh and try again.",
      );

    const records = await this.allRecords();
    if (
      kind === "tenant" &&
      records.some(
        (record) =>
          record.kind === "tenancy" &&
          Array.isArray(record.tenantIds) &&
          record.tenantIds.includes(current.id) &&
          record.tenantIds.length > 1,
      )
    )
      throw new StoreError(
        409,
        "shared_tenancy",
        "Remove this tenant from shared tenancy agreements before permanently deleting them.",
      );
    const ids = new Set([current.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of records) {
        if (ids.has(record.id)) continue;
        const dependsOnDeleted =
          (kind === "property" && record.propertyId === current.id) ||
          ids.has(String(record.tenantId ?? "")) ||
          ids.has(String(record.tenancyId ?? "")) ||
          ids.has(String(record.rentalYearId ?? "")) ||
          (Array.isArray(record.tenantIds) &&
            record.tenantIds.some((tenantId) => ids.has(String(tenantId))));
        if (dependsOnDeleted) {
          ids.add(record.id);
          changed = true;
        }
      }
    }
    const selected = records.filter((record) => ids.has(record.id));
    await this.remove([
      ...selected.filter((record) => record.id !== current.id),
      current,
    ]);
    return {
      deletedCount: selected.length,
      blobNames: selected
        .filter((record) => record.kind === "document" && record.blobName)
        .map((record) => String(record.blobName)),
    };
  }
  async purgeAll() {
    const records = await this.allRecords();
    await this.remove(records);
    return {
      deletedCount: records.length,
      blobNames: records
        .filter((record) => record.kind === "document" && record.blobName)
        .map((record) => String(record.blobName)),
    };
  }
  async startRentalYear(
    propertyId: string,
    input: StartRentalYearInput,
    user: AuthenticatedUser,
  ) {
    const property = await this.get("property", propertyId);
    const {
      organizationId: _propertyOrganizationId,
      kind: _propertyKind,
      archived: _propertyArchived,
      createdAt: _propertyCreatedAt,
      createdBy: _propertyCreatedBy,
      updatedAt: _propertyUpdatedAt,
      updatedBy: _propertyUpdatedBy,
      version: _propertyVersion,
      _etag: _propertyEtag,
      ...propertySnapshot
    } = property;
    const years = await this.list("rentalYear", { propertyId, limit: 200 });
    if (years.some((year) => year.status === "restored"))
      throw new StoreError(
        409,
        "rental_year_edit_in_progress",
        "Save the restored rental-year edits back to History before starting another rental year.",
      );
    if (
      years.some(
        (year) =>
          String(year.label).toLowerCase() === input.label.toLowerCase(),
      )
    )
      throw new StoreError(
        409,
        "rental_year_exists",
        "A rental year with this label already exists for the property.",
      );
    const current = years.find((year) => year.status === "current");
    let closed: PortfolioRecord | undefined;
    let recordsMoved = 0;

    await this.update(
      "property",
      propertyId,
      {
        annualRentPence: input.annualRentPence,
        monthlyRentPence: Math.round(
          input.annualRentPence /
            Math.max(
              1,
              (Number(input.endDate.slice(0, 4)) - Number(input.startDate.slice(0, 4))) * 12 +
                Number(input.endDate.slice(5, 7)) -
                Number(input.startDate.slice(5, 7)) +
                1,
            ),
        ),
        rentInputFrequency: "yearly",
        tenancyStartDate: input.startDate,
        tenancyEndDate: input.endDate,
      },
      user,
      property._etag,
    );

    if (current) {
      const active = await this.allActive();
      const outgoing = active.filter(
        (record) => record.rentalYearId === current.id,
      );
      for (const record of outgoing.filter(
        (record) => record.kind === "tenancy" && record.status === "active",
      )) {
        await this.update(
          "tenancy",
          record.id,
          {
            status: "ended",
            endDate: record.endDate || previousDay(input.startDate),
          },
          user,
          record._etag,
        );
      }
      recordsMoved = outgoing.length;
      closed = await this.update(
        "rentalYear",
        current.id,
        {
          status: "closed",
          endDate: current.endDate || previousDay(input.startDate),
          propertySnapshot,
        },
        user,
        current._etag,
      );
    } else {
      const active = await this.allActive();
      const propertyTenants = active.filter(
        (record) =>
          record.kind === "tenant" && record.propertyId === propertyId,
      );
      const tenantIds = new Set(propertyTenants.map((record) => record.id));
      const unassigned = active.filter(
        (record) =>
          yearScopedKinds.has(record.kind) &&
          !record.rentalYearId &&
          (record.propertyId === propertyId ||
            tenantIds.has(String(record.tenantId))),
      );
      if (unassigned.length) {
        const legacyYear = await this.create(
          "rentalYear",
          {
            propertyId,
            label: `Records before ${input.label}`,
            startDate: "",
            endDate: previousDay(input.startDate),
            annualRentPence: Number(property.annualRentPence || 0),
            status: "restored",
            propertySnapshot,
            notes:
              "Automatically created when rental-year history was enabled.",
          },
          user,
        );
        for (const record of unassigned) {
          await this.update(
            record.kind,
            record.id,
            {
              rentalYearId: legacyYear.id,
              ...(record.kind === "tenancy" && record.status === "active"
                ? {
                    status: "ended",
                    endDate: record.endDate || previousDay(input.startDate),
                  }
                : {}),
            },
            user,
            record._etag,
          );
          recordsMoved += 1;
        }
        closed = await this.update(
          "rentalYear",
          legacyYear.id,
          { status: "closed" },
          user,
          legacyYear._etag,
        );
      }
    }

    if (closed) {
      const currentCompliance = (await this.allActive()).filter(
        (record) =>
          record.kind === "compliance" &&
          record.propertyId === propertyId &&
          !record.rentalYearId,
      );
      for (const record of currentCompliance) {
        const {
          id: _id,
          organizationId: _organizationId,
          kind: _kind,
          archived: _archived,
          createdAt: _createdAt,
          createdBy: _createdBy,
          updatedAt: _updatedAt,
          updatedBy: _updatedBy,
          version: _version,
          _etag: _recordEtag,
          ...snapshot
        } = record;
        await this.createHistoricalRecord(
          "compliance",
          { ...snapshot, propertyId, rentalYearId: closed.id },
          user,
        );
        recordsMoved += 1;
      }
    }

    const next = await this.create(
      "rentalYear",
      { propertyId, ...input, status: "current", notes: "" },
      user,
    );
    return { current: next, closed, recordsMoved };
  }
  async restoreRentalYear(
    propertyId: string,
    yearId: string,
    user: AuthenticatedUser,
    etag?: string,
  ) {
    await this.requireActive("property", propertyId, "property");
    const year = await this.get("rentalYear", yearId);
    if (year.propertyId !== propertyId)
      throw new StoreError(409, "relationship_mismatch", "The rental year belongs to a different property.");
    if (year.status !== "closed")
      throw new StoreError(409, "rental_year_not_closed", "Only a closed rental year can be restored for editing.");
    if (etag && year._etag && etag !== year._etag)
      throw new StoreError(409, "version_conflict", "This rental year changed since it was opened. Refresh and try again.");
    const years = await this.list("rentalYear", { propertyId, limit: 200 });
    if (years.some((candidate) => candidate.status === "restored" && candidate.id !== yearId))
      throw new StoreError(409, "rental_year_edit_in_progress", "Save the other restored rental year back to History first.");
    const now = new Date().toISOString();
    return this.saveRentalYearRestoration(year, {
      ...year,
      status: "restored",
      restoredAt: now,
      restoredBy: user.email,
      updatedAt: now,
      updatedBy: user.email,
      version: year.version + 1,
    }, etag);
  }
  async saveRentalYearToHistory(
    propertyId: string,
    yearId: string,
    user: AuthenticatedUser,
    etag?: string,
  ) {
    const year = await this.get("rentalYear", yearId);
    if (year.propertyId !== propertyId)
      throw new StoreError(409, "relationship_mismatch", "The rental year belongs to a different property.");
    if (year.status !== "restored")
      throw new StoreError(409, "rental_year_not_restored", "Restore the rental year before saving its edits to History.");
    if (etag && year._etag && etag !== year._etag)
      throw new StoreError(409, "version_conflict", "This rental year changed since it was opened. Refresh and try again.");
    const now = new Date().toISOString();
    return this.saveRentalYearClosure(year, {
      ...year,
      status: "closed",
      historySavedAt: now,
      historySavedBy: user.email,
      updatedAt: now,
      updatedBy: user.email,
      version: year.version + 1,
    }, etag);
  }
  async updateRestoredYearProperty(
    propertyId: string,
    yearId: string,
    data: Record<string, unknown>,
    user: AuthenticatedUser,
    etag?: string,
  ) {
    await this.requireActive("property", propertyId, "property");
    const year = await this.get("rentalYear", yearId);
    if (year.propertyId !== propertyId)
      throw new StoreError(409, "relationship_mismatch", "The rental year belongs to a different property.");
    if (year.status !== "restored")
      throw new StoreError(409, "historical_record", "Restore the rental year before editing its property snapshot.");
    if (etag && year._etag && etag !== year._etag)
      throw new StoreError(409, "version_conflict", "This rental year changed since it was opened. Refresh and try again.");
    await this.assertRelationships("property", { ...data, id: propertyId });
    const imageDocumentId = String(data.imageDocumentId || "");
    if (imageDocumentId) {
      const image = await this.get("document", imageDocumentId);
      const existingImageDocumentId = String(
        year.propertySnapshot && typeof year.propertySnapshot === "object"
          ? (year.propertySnapshot as Record<string, unknown>).imageDocumentId || ""
          : "",
      );
      const isLegacySnapshotImage = !image.rentalYearId && image.id === existingImageDocumentId;
      if (image.rentalYearId !== yearId && !isLegacySnapshotImage)
        throw new StoreError(
          409,
          "relationship_mismatch",
          "The selected property picture belongs to a different rental year.",
        );
    }
    const now = new Date().toISOString();
    return this.saveRestoredYearSnapshot(year, {
      ...year,
      propertySnapshot: {
        ...(year.propertySnapshot && typeof year.propertySnapshot === "object" ? year.propertySnapshot : {}),
        ...data,
      },
      updatedAt: now,
      updatedBy: user.email,
      version: year.version + 1,
    }, etag);
  }
}

function withoutOrphans(records: PortfolioRecord[]) {
  const propertyIds = new Set(
    records
      .filter((record) => record.kind === "property")
      .map((record) => record.id),
  );
  const tenantIds = new Set(
    records
      .filter(
        (record) =>
          record.kind === "tenant" &&
          propertyIds.has(String(record.propertyId ?? "")),
      )
      .map((record) => record.id),
  );
  return records.filter(
    (record) =>
      record.kind === "property" ||
      (!record.propertyId && !record.tenantId) ||
      (!!record.propertyId && propertyIds.has(String(record.propertyId))) ||
      (!!record.tenantId && tenantIds.has(String(record.tenantId))),
  );
}

export class MemoryStore extends BaseStore {
  private records = new Map<string, PortfolioRecord>();
  private restoredYears = new Map<string, string>();
  async list(kind: RecordKind, options: ListOptions = {}) {
    const search = options.search?.toLowerCase();
    return [...this.records.values()]
      .filter((r) => r.kind === kind && r.archived === !!options.archived)
      .filter((r) => !options.propertyId || r.propertyId === options.propertyId)
      .filter((r) => !options.tenantId || r.tenantId === options.tenantId)
      .filter(
        (r) => !options.rentalYearId || r.rentalYearId === options.rentalYearId,
      )
      .filter(
        (r) => !search || JSON.stringify(r).toLowerCase().includes(search),
      )
      .slice(0, options.limit ?? 100);
  }
  async listPage(
    kind: RecordKind,
    options: ListOptions = {},
    continuationToken?: string,
  ) {
    const offset = continuationToken ? Number(continuationToken) : 0;
    if (!Number.isInteger(offset) || offset < 0)
      throw new StoreError(
        400,
        "invalid_continuation",
        "The continuation token is invalid.",
      );
    const limit = options.limit ?? 100;
    const items = await this.list(kind, {
      ...options,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const page = items.slice(offset, offset + limit);
    const next = offset + page.length;
    return {
      items: page,
      ...(next < items.length ? { continuationToken: String(next) } : {}),
    };
  }
  async allActive() {
    return withoutOrphans(
      [...this.records.values()].filter((r) => !r.archived),
    );
  }
  async allRecords() {
    return [...this.records.values()];
  }
  async get(kind: RecordKind, id: string) {
    const found = this.records.get(id);
    if (!found || found.kind !== kind)
      throw new StoreError(404, "not_found", "Record not found.");
    return found;
  }
  async put(record: PortfolioRecord, etag?: string) {
    const current = this.records.get(record.id);
    if (etag && current?._etag !== etag)
      throw new StoreError(
        409,
        "version_conflict",
        "This record changed since it was opened.",
      );
    if (record.rentalYearId) {
      const year = this.records.get(String(record.rentalYearId));
      if (year?.status === "closed")
        throw new StoreError(409, "historical_record", "Closed rental-year records are read-only.");
    }
    const saved = { ...record, _etag: `W/\"${record.version}\"` };
    this.records.set(saved.id, saved);
    return saved;
  }
  protected override async putHistoricalSnapshot(record: PortfolioRecord) {
    const saved = { ...record, _etag: `W/\"${record.version}\"` };
    this.records.set(saved.id, saved);
    return saved;
  }
  protected async putMany(records: PortfolioRecord[]) {
    for (const record of records) {
      if (!record.rentalYearId) continue;
      const year = this.records.get(String(record.rentalYearId));
      if (year?.status === "closed")
        throw new StoreError(409, "historical_record", "Closed rental-year records are read-only.");
    }
    const saved = records.map((record) => ({ ...record, _etag: `W/\"${record.version}\"` }));
    for (const record of saved) this.records.set(record.id, record);
    return saved;
  }
  protected override async saveRentalYearRestoration(
    current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    const propertyId = String(current.propertyId);
    const restoredYearId = this.restoredYears.get(propertyId);
    if (restoredYearId && restoredYearId !== current.id)
      throw new StoreError(409, "rental_year_edit_in_progress", "Save the other restored rental year back to History first.");
    this.restoredYears.set(propertyId, current.id);
    try {
      return await this.put(candidate, etag);
    } catch (error) {
      this.restoredYears.delete(propertyId);
      throw error;
    }
  }
  protected override async saveRentalYearClosure(
    current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    const propertyId = String(current.propertyId);
    if (this.restoredYears.get(propertyId) !== current.id)
      this.restoredYears.set(propertyId, current.id);
    const saved = await this.put(candidate, etag);
    this.restoredYears.delete(propertyId);
    return saved;
  }
  protected override async saveRestoredYearSnapshot(
    current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    const propertyId = String(current.propertyId);
    const restoredYearId = this.restoredYears.get(propertyId);
    if (restoredYearId && restoredYearId !== current.id)
      throw new StoreError(409, "rental_year_edit_in_progress", "Save the other restored rental year back to History first.");
    this.restoredYears.set(propertyId, current.id);
    return this.put(candidate, etag);
  }
  async remove(records: PortfolioRecord[]) {
    for (const record of records) this.records.delete(record.id);
  }
}

class CosmosStore extends BaseStore {
  private container: Container;
  constructor(organizationId: string) {
    super(organizationId);
    const endpoint = process.env.COSMOS_ENDPOINT;
    if (!endpoint) throw new Error("COSMOS_ENDPOINT is required.");
    const key = process.env.COSMOS_KEY;
    const client = new CosmosClient(
      key ? { endpoint, key } : { endpoint, aadCredentials: getCredential() },
    );
    this.container = client
      .database(process.env.COSMOS_DATABASE ?? "portfolio")
      .container(process.env.COSMOS_CONTAINER ?? "records");
  }
  private buildRentPaymentGuard(record: PortfolioRecord): RentPaymentMonthGuard {
    const timestamp = String(record.updatedAt || record.createdAt || new Date().toISOString());
    return {
      id: rentPaymentGuardId(record),
      organizationId: this.organizationId,
      kind: "rentPaymentMonthGuard",
      archived: true,
      propertyId: String(record.propertyId ?? ""),
      tenantId: String(record.tenantId ?? ""),
      ...(record.rentalYearId ? { rentalYearId: String(record.rentalYearId) } : {}),
      appliesToMonth: recordedMonth(record),
      paymentId: record.id,
      paymentStatus: String(record.status) === "in_advance" ? "in_advance" : "paid",
      createdAt: timestamp,
      createdBy: String(record.createdBy ?? record.updatedBy ?? ""),
      updatedAt: timestamp,
      updatedBy: String(record.updatedBy ?? record.createdBy ?? ""),
      version: 1,
    };
  }
  private async getRentPaymentGuard(record: Record<string, unknown>) {
    try {
      const { resource } = await this.container
        .item(rentPaymentGuardId(record), this.organizationId)
        .read<RentPaymentMonthGuard>();
      return resource?.kind === "rentPaymentMonthGuard" ? resource : undefined;
    } catch (error: any) {
      if (error.code === 404) return undefined;
      throw error;
    }
  }
    private buildRentalYearLifecycleGuard(year: PortfolioRecord): RentalYearLifecycleGuard {
      return {
        id: rentalYearLifecycleGuardId(String(year.propertyId)),
        organizationId: this.organizationId,
        kind: "rentalYearLifecycleGuard",
        archived: true,
        propertyId: String(year.propertyId),
        rentalYearId: year.id,
        updatedAt: new Date().toISOString(),
        updatedBy: String(year.updatedBy || year.createdBy || ""),
        version: 1,
      };
    }
    private async getRentalYearLifecycleGuard(propertyId: string) {
      try {
        const { resource } = await this.container
          .item(rentalYearLifecycleGuardId(propertyId), this.organizationId)
          .read<RentalYearLifecycleGuard>();
        return resource?.kind === "rentalYearLifecycleGuard" ? resource : undefined;
      } catch (error: any) {
        if (error.code === 404) return undefined;
        throw error;
      }
    }
    private async ensureRentalYearLifecycleGuard(year: PortfolioRecord) {
      const propertyId = String(year.propertyId);
      const existing = await this.getRentalYearLifecycleGuard(propertyId);
      if (existing) {
        if (existing.rentalYearId !== year.id)
          throw new StoreError(409, "rental_year_edit_in_progress", "Save the other restored rental year back to History first.");
        return { year, guard: existing };
      }
      await this.runTransactionalBatch(
        [
          {
            operationType: BulkOperationType.Create,
            resourceBody: this.buildRentalYearLifecycleGuard(year) as any,
          },
          {
            operationType: BulkOperationType.Replace,
            id: year.id,
            resourceBody: year as any,
            ...(year._etag ? { ifMatch: year._etag } : {}),
          },
        ],
        async () => {
          throw new StoreError(409, "rental_year_edit_in_progress", "Save the other restored rental year back to History first.");
        },
      );
      return {
        year: await this.get("rentalYear", year.id),
        guard: (await this.getRentalYearLifecycleGuard(propertyId))!,
      };
    }
    private async lifecycleGuardOperations(records: PortfolioRecord[]) {
      const yearIds = [...new Set(records.map((record) => String(record.rentalYearId || "")).filter(Boolean))];
      if (!yearIds.length) return [];
      if (yearIds.length !== 1)
        throw new StoreError(409, "relationship_mismatch", "A single operation cannot change records from different rental years.");
      const year = await this.get("rentalYear", yearIds[0]!);
      if (year.status === "closed")
        throw new StoreError(409, "historical_record", "Closed rental-year records are read-only.");
      if (year.status !== "restored") return [];
      const { guard } = await this.ensureRentalYearLifecycleGuard(year);
      return [{
        operationType: BulkOperationType.Replace,
        id: guard.id,
        resourceBody: {
          ...guard,
          updatedAt: new Date().toISOString(),
          version: guard.version + 1,
        } as any,
        ...(guard._etag ? { ifMatch: guard._etag } : {}),
      } satisfies OperationInput];
    }
    private async runLifecycleGuardedBatch(
      records: PortfolioRecord[],
      operations: OperationInput[],
      onConflict: () => Promise<never>,
    ) {
      const lifecycleOperations = await this.lifecycleGuardOperations(records);
      await this.runTransactionalBatch([...lifecycleOperations, ...operations], onConflict);
    }
  private async runTransactionalBatch(
    operations: OperationInput[],
    onConflict: () => Promise<never>,
  ) {
    try {
      const response = await this.container.items.batch(operations, this.organizationId);
      const failed = response.result?.find(
        (result: any) => result.statusCode < 200 || result.statusCode >= 300,
      );
      if (!failed) return;
      if (failed.statusCode === 412)
        throw new StoreError(
          409,
          "version_conflict",
          "This record changed since it was opened.",
        );
      if (failed.statusCode === 409) await onConflict();
      throw new StoreError(
        500,
        "rent_payment_batch_failed",
        "The rent payment could not be saved.",
      );
    } catch (error: any) {
      if (error instanceof StoreError) throw error;
      if (error?.code === 412 || error?.statusCode === 412)
        throw new StoreError(
          409,
          "version_conflict",
          "This record changed since it was opened.",
        );
      if (error?.code === 409 || error?.statusCode === 409)
        await onConflict();
      throw error;
    }
  }
  private async throwRentPaymentConflict(
    record: PortfolioRecord,
    mode: "create" | "update",
  ): Promise<never> {
    const linked = (
      await this.list("rentPayment", {
        propertyId: String(record.propertyId ?? ""),
        tenantId: String(record.tenantId ?? ""),
        ...(record.rentalYearId
          ? { rentalYearId: String(record.rentalYearId) }
          : {}),
        limit: 200,
      })
    ).filter(
      (payment) =>
        payment.id !== record.id && recordedMonth(payment) === recordedMonth(record),
    );
    if (linked.some((payment) => payment.status === "in_advance"))
      throw new StoreError(
        409,
        "advance_month_managed",
        "This month is covered by a linked advance payment and cannot receive a separate rent entry.",
      );
    throw new StoreError(
      409,
      mode === "create" ? "rent_payment_requires_override" : "duplicate_paid_rent",
      mode === "create"
        ? "A Paid rent entry already exists for this tenant and month. Replace that entry instead of creating another one."
        : "Only one Paid rent entry is allowed for each tenant and month.",
    );
  }
  protected override async createRentPaymentRecord(record: PortfolioRecord) {
    if (!hasExclusiveRentStatus(record)) return this.put(record);
    await this.runLifecycleGuardedBatch(
      [record],
      [
        {
          operationType: BulkOperationType.Create,
          resourceBody: this.buildRentPaymentGuard(record) as any,
        },
        {
          operationType: BulkOperationType.Create,
          resourceBody: record as any,
        },
      ],
      () => this.throwRentPaymentConflict(record, "create"),
    );
    return this.get("rentPayment", record.id);
  }
  protected override async createRentAdvanceRecords(records: PortfolioRecord[]) {
    await this.runLifecycleGuardedBatch(
      records,
      records.flatMap((record) => ([
        {
          operationType: BulkOperationType.Create,
          resourceBody: this.buildRentPaymentGuard(record) as any,
        },
        {
          operationType: BulkOperationType.Create,
          resourceBody: record as any,
        },
      ])),
      async () => {
        throw new StoreError(
          409,
          "rent_month_already_recorded",
          "One or more covered months already has a rent record for this tenant. Review those entries before recording the advance payment.",
        );
      },
    );
    return Promise.all(records.map((record) => this.get("rentPayment", record.id)));
  }
  protected override async saveRentAdvanceRecords(
    current: PortfolioRecord[],
    candidates: PortfolioRecord[],
  ) {
    await this.runLifecycleGuardedBatch(
      candidates,
      candidates.map((candidate, index) => ({
        operationType: BulkOperationType.Replace,
        id: candidate.id,
        resourceBody: candidate as any,
        ...(current[index]._etag ? { ifMatch: current[index]._etag } : {}),
      } satisfies OperationInput)),
      async () => {
        throw new StoreError(409, "version_conflict", "This advance payment changed since it was opened. Refresh and try again.");
      },
    );
    return Promise.all(candidates.map((record) => this.get("rentPayment", record.id)));
  }
  protected override async saveRentAdvanceArchiveRecords(
    current: PortfolioRecord[],
    candidates: PortfolioRecord[],
    archived: boolean,
  ) {
    const guards = (await Promise.all(current.map((record) => this.getRentPaymentGuard(record))))
      .flatMap((guard) => guard ? [guard] : []);
    if (!archived) {
      for (let index = 0; index < current.length; index += 1) {
        const currentRecord = current[index]!;
        const guard = guards.find((candidate) => candidate.id === rentPaymentGuardId(currentRecord));
        if (guard && guard.paymentId !== currentRecord.id)
          throw new StoreError(409, "rent_month_already_recorded", "One or more months now has another rent entry. Remove that entry before restoring this advance payment.");
      }
      const missingGuards = candidates
        .filter((candidate) => !guards.some((guard) => guard.id === rentPaymentGuardId(candidate)))
        .map((candidate) => ({
          operationType: BulkOperationType.Create,
          resourceBody: this.buildRentPaymentGuard(candidate) as any,
        } satisfies OperationInput));
      await this.runLifecycleGuardedBatch(
        candidates,
        [
          ...missingGuards,
          ...candidates.map((candidate, index) => ({
            operationType: BulkOperationType.Replace,
            id: candidate.id,
            resourceBody: candidate as any,
            ...(current[index]!._etag ? { ifMatch: current[index]!._etag } : {}),
          } satisfies OperationInput)),
        ],
        async () => {
          throw new StoreError(409, "rent_month_already_recorded", "One or more months now has another rent entry. Remove that entry before restoring this advance payment.");
        },
      );
    } else {
      await this.runLifecycleGuardedBatch(
        candidates,
        [
          ...candidates.map((candidate, index) => ({
            operationType: BulkOperationType.Replace,
            id: candidate.id,
            resourceBody: candidate as any,
            ...(current[index]!._etag ? { ifMatch: current[index]!._etag } : {}),
          } satisfies OperationInput)),
          ...guards.map((guard) => ({ operationType: BulkOperationType.Delete, id: guard.id } satisfies OperationInput)),
        ],
        async () => {
          throw new StoreError(409, "version_conflict", "This advance payment changed since it was opened. Refresh and try again.");
        },
      );
    }
    return Promise.all(candidates.map((record) => this.get("rentPayment", record.id)));
  }
  protected override async saveRentPaymentRecord(
    current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    const currentExclusive = hasExclusiveRentStatus(current) && !current.archived;
    const candidateExclusive = hasExclusiveRentStatus(candidate) && !candidate.archived;
    const currentGuard = currentExclusive ? await this.getRentPaymentGuard(current) : undefined;
    const currentGuardId = currentGuard?.id ?? rentPaymentGuardId(current);
    const candidateGuardId = candidateExclusive ? rentPaymentGuardId(candidate) : undefined;
    if (
      !currentExclusive &&
      !candidateExclusive
    )
      return this.put(candidate, etag);
    if (
      currentExclusive &&
      candidateExclusive &&
      currentGuard &&
      currentGuardId === candidateGuardId &&
      !current.archived &&
      !candidate.archived
    )
      return this.put(candidate, etag);
    await this.runLifecycleGuardedBatch(
      [candidate],
      [
        ...(candidateExclusive && (!currentGuard || candidateGuardId !== currentGuardId)
          ? [{
              operationType: BulkOperationType.Create,
              resourceBody: this.buildRentPaymentGuard(candidate) as any,
            } satisfies OperationInput]
          : []),
        {
          operationType: BulkOperationType.Replace,
          id: candidate.id,
          resourceBody: candidate as any,
          ...(etag ? { ifMatch: etag } : {}),
        } satisfies OperationInput,
        ...(currentExclusive && currentGuard && currentGuardId !== candidateGuardId
          ? [{
              operationType: BulkOperationType.Delete,
              id: currentGuard.id,
            } satisfies OperationInput]
          : []),
      ],
      () => this.throwRentPaymentConflict(candidate, "update"),
    );
    return this.get("rentPayment", candidate.id);
  }
  protected override async saveRentalYearRestoration(
    current: PortfolioRecord,
    candidate: PortfolioRecord,
    etag?: string,
  ) {
    await this.runTransactionalBatch(
      [
        {
          operationType: BulkOperationType.Create,
          resourceBody: this.buildRentalYearLifecycleGuard(candidate) as any,
        },
        {
          operationType: BulkOperationType.Replace,
          id: candidate.id,
          resourceBody: candidate as any,
          ...(etag ? { ifMatch: etag } : {}),
        },
      ],
      async () => {
        const guard = await this.getRentalYearLifecycleGuard(String(current.propertyId));
        if (guard && guard.rentalYearId !== current.id)
          throw new StoreError(409, "rental_year_edit_in_progress", "Save the other restored rental year back to History first.");
        throw new StoreError(409, "version_conflict", "This rental year changed since it was opened. Refresh and try again.");
      },
    );
    return this.get("rentalYear", candidate.id);
  }
  protected override async saveRentalYearClosure(
    current: PortfolioRecord,
    candidate: PortfolioRecord,
    _etag?: string,
  ) {
    const { year, guard } = await this.ensureRentalYearLifecycleGuard(current);
    await this.runTransactionalBatch(
      [
        {
          operationType: BulkOperationType.Replace,
          id: candidate.id,
          resourceBody: { ...candidate, _etag: year._etag } as any,
          ...(year._etag ? { ifMatch: year._etag } : {}),
        },
        {
          operationType: BulkOperationType.Delete,
          id: guard.id,
          ...(guard._etag ? { ifMatch: guard._etag } : {}),
        },
      ],
      async () => {
        throw new StoreError(409, "version_conflict", "This rental year changed while its edits were being saved. Refresh and try again.");
      },
    );
    return this.get("rentalYear", candidate.id);
  }
  protected override async saveRestoredYearSnapshot(
    current: PortfolioRecord,
    candidate: PortfolioRecord,
    _etag?: string,
  ) {
    const { year, guard } = await this.ensureRentalYearLifecycleGuard(current);
    await this.runTransactionalBatch(
      [
        {
          operationType: BulkOperationType.Replace,
          id: guard.id,
          resourceBody: {
            ...guard,
            updatedAt: new Date().toISOString(),
            version: guard.version + 1,
          } as any,
          ...(guard._etag ? { ifMatch: guard._etag } : {}),
        },
        {
          operationType: BulkOperationType.Replace,
          id: candidate.id,
          resourceBody: { ...candidate, _etag: year._etag } as any,
          ...(year._etag ? { ifMatch: year._etag } : {}),
        },
      ],
      async () => {
        throw new StoreError(409, "version_conflict", "This rental year changed since it was opened. Refresh and try again.");
      },
    );
    return this.get("rentalYear", candidate.id);
  }
  async list(kind: RecordKind, options: ListOptions = {}) {
    const clauses = [
      "c.organizationId = @organizationId",
      "c.kind = @kind",
      "c.archived = @archived",
    ];
    const parameters: { name: string; value: any }[] = [
      { name: "@organizationId", value: this.organizationId },
      { name: "@kind", value: kind },
      { name: "@archived", value: !!options.archived },
    ];
    if (options.propertyId) {
      clauses.push("c.propertyId = @propertyId");
      parameters.push({ name: "@propertyId", value: options.propertyId });
    }
    if (options.tenantId) {
      clauses.push("c.tenantId = @tenantId");
      parameters.push({ name: "@tenantId", value: options.tenantId });
    }
    if (options.rentalYearId) {
      clauses.push("c.rentalYearId = @rentalYearId");
      parameters.push({ name: "@rentalYearId", value: options.rentalYearId });
    }
    const { resources } = await this.container.items
      .query<PortfolioRecord>(
        {
          query: `SELECT TOP ${Math.min(options.limit ?? 100, 200)} * FROM c WHERE ${clauses.join(" AND ")} ORDER BY c.updatedAt DESC`,
          parameters,
        },
        { partitionKey: this.organizationId },
      )
      .fetchAll();
    const search = options.search?.toLowerCase();
    return search
      ? resources.filter((r) =>
          JSON.stringify(r).toLowerCase().includes(search),
        )
      : resources;
  }
  async listPage(
    kind: RecordKind,
    options: ListOptions = {},
    continuationToken?: string,
  ) {
    const clauses = [
      "c.organizationId = @organizationId",
      "c.kind = @kind",
      "c.archived = @archived",
    ];
    const parameters: { name: string; value: any }[] = [
      { name: "@organizationId", value: this.organizationId },
      { name: "@kind", value: kind },
      { name: "@archived", value: !!options.archived },
    ];
    if (options.propertyId) {
      clauses.push("c.propertyId = @propertyId");
      parameters.push({ name: "@propertyId", value: options.propertyId });
    }
    if (options.tenantId) {
      clauses.push("c.tenantId = @tenantId");
      parameters.push({ name: "@tenantId", value: options.tenantId });
    }
    if (options.rentalYearId) {
      clauses.push("c.rentalYearId = @rentalYearId");
      parameters.push({
        name: "@rentalYearId",
        value: options.rentalYearId,
      });
    }
    const response = await this.container.items
      .query<PortfolioRecord>(
        {
          query: `SELECT * FROM c WHERE ${clauses.join(" AND ")} ORDER BY c.updatedAt DESC`,
          parameters,
        },
        {
          partitionKey: this.organizationId,
          maxItemCount: options.limit ?? 100,
          continuationToken,
        },
      )
      .fetchNext();
    const search = options.search?.toLowerCase();
    const items = search
      ? response.resources.filter((record) =>
          JSON.stringify(record).toLowerCase().includes(search),
        )
      : response.resources;
    return {
      items,
      ...(response.continuationToken
        ? { continuationToken: response.continuationToken }
        : {}),
    };
  }
  async allActive() {
    const { resources } = await this.container.items
      .query<PortfolioRecord>(
        {
          query:
            "SELECT * FROM c WHERE c.organizationId = @organizationId AND c.archived = false",
          parameters: [{ name: "@organizationId", value: this.organizationId }],
        },
        { partitionKey: this.organizationId },
      )
      .fetchAll();
    return withoutOrphans(resources);
  }
  async allRecords() {
    const { resources } = await this.container.items
      .query<PortfolioRecord>(
        {
          query: "SELECT * FROM c WHERE c.organizationId = @organizationId",
          parameters: [{ name: "@organizationId", value: this.organizationId }],
        },
        { partitionKey: this.organizationId },
      )
      .fetchAll();
    return resources;
  }
  async get(kind: RecordKind, id: string) {
    try {
      const { resource } = await this.container
        .item(id, this.organizationId)
        .read<PortfolioRecord>();
      if (!resource || resource.kind !== kind)
        throw new StoreError(404, "not_found", "Record not found.");
      return resource;
    } catch (error: any) {
      if (error.code === 404)
        throw new StoreError(404, "not_found", "Record not found.");
      throw error;
    }
  }
  async put(record: PortfolioRecord, etag?: string) {
    try {
      if (!this.container) throw new Error("Container unavailable");
      if (record.rentalYearId) {
        await this.runLifecycleGuardedBatch(
          [record],
          [{
            operationType: etag ? BulkOperationType.Replace : BulkOperationType.Upsert,
            id: record.id,
            resourceBody: record as any,
            ...(etag ? { ifMatch: etag } : {}),
          } satisfies OperationInput],
          async () => {
            throw new StoreError(409, "version_conflict", "This record changed since it was opened.");
          },
        );
        return this.get(record.kind, record.id);
      }
      const response = etag
        ? await this.container.item(record.id, this.organizationId).replace(record, {
            accessCondition: { type: "IfMatch", condition: etag },
          })
        : await this.container.items.upsert(record);
      return response.resource as PortfolioRecord;
    } catch (error: any) {
      if (error.code === 412)
        throw new StoreError(
          409,
          "version_conflict",
          "This record changed since it was opened.",
        );
      throw error;
    }
  }
  protected override async putHistoricalSnapshot(record: PortfolioRecord) {
    if (!this.container) throw new Error("Container unavailable");
    const response = await this.container.items.create(record);
    return response.resource as PortfolioRecord;
  }
  protected async putMany(records: PortfolioRecord[]) {
    const operations: OperationInput[] = records.map((record) => ({
      operationType: BulkOperationType.Create,
      resourceBody: record as any,
    }));
    try {
      const response = await this.container.items.batch(operations, this.organizationId);
      const results = response.result;
      const failed = results?.find((result: any) => result.statusCode < 200 || result.statusCode >= 300);
      if (!results || results.length !== records.length || failed) {
        if (failed?.statusCode === 409)
          throw new StoreError(409, "rent_month_already_recorded", "This advance payment was already recorded. Refresh the property and review its rent months.");
        throw new StoreError(500, "advance_payment_failed", "The advance payment could not be saved. No monthly rent records were created.");
      }
      return records.map((record, index) =>
        results[index].resourceBody
          ? results[index].resourceBody as unknown as PortfolioRecord
          : { ...record, _etag: results[index].eTag },
      );
    } catch (error: any) {
      if (error instanceof StoreError) throw error;
      if (error?.code === 409 || error?.statusCode === 409)
        throw new StoreError(409, "rent_month_already_recorded", "This advance payment was already recorded. Refresh the property and review its rent months.");
      throw error;
    }
  }
  async remove(records: PortfolioRecord[]) {
    for (let index = 0; index < records.length; index += 25) {
      await Promise.all(records.slice(index, index + 25).map(async (record) => {
        try {
          await this.container.item(record.id, this.organizationId).delete();
        } catch (error: any) {
          if (error.code !== 404) throw error;
        }
      }));
    }
  }
}

const stores = new Map<string, RecordStore>();
export function getStore(organizationId = "test-organization"): RecordStore {
  let store = stores.get(organizationId);
  if (!store) {
    store = process.env.DATA_BACKEND === "memory"
      ? new MemoryStore(organizationId)
      : new CosmosStore(organizationId);
    stores.set(organizationId, store);
  }
  return store;
}
export function setStoreForTests(value?: RecordStore) {
  stores.clear();
  if (value) stores.set("test-organization", value);
}
