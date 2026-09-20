import type { PortfolioRecord } from "../domain/types";

const pence = (value: unknown) => (typeof value === "number" ? value : 0);
const rentMonth = (record: PortfolioRecord) =>
  String(record.appliesToMonth || record.paidDate || record.dueDate || "").slice(0, 7);
const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
const monthAt = (index: number) => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;

export interface TenantRentMonth {
  tenantId: string;
  expectedPence: number;
  receivedPence: number;
  outstandingPence: number;
  hasPayments: boolean;
}

export interface RentMonthSummary {
  expectedPence: number;
  receivedPence: number;
  outstandingPence: number;
  tenants: TenantRentMonth[];
}

function rentalYearFor(records: PortfolioRecord[], propertyId: string) {
  const years = records.filter(
    (record) => record.kind === "rentalYear" && record.propertyId === propertyId,
  );
  return years.find((record) => record.status === "current") ?? years[0];
}

function tenantAppliesToMonth(
  tenant: PortfolioRecord,
  tenancies: PortfolioRecord[],
  month: string,
) {
  const agreements = tenancies.filter(
    (agreement) =>
      agreement.status !== "draft" &&
      Array.isArray(agreement.tenantIds) &&
      agreement.tenantIds.includes(tenant.id),
  );
  if (!agreements.length) return true;
  return agreements.some((agreement) => {
    const start = String(agreement.startDate || "").slice(0, 7);
    const end = String(agreement.endDate || "").slice(0, 7);
    return (!start || start <= month) && (!end || month <= end);
  });
}

export function calculateRentMonth(
  records: PortfolioRecord[],
  propertyId: string,
  month: string,
): RentMonthSummary {
  const property = records.find(
    (record) => record.kind === "property" && record.id === propertyId,
  );
  const year = rentalYearFor(records, propertyId);
  const rangeStart = String(year?.startDate || property?.tenancyStartDate || "").slice(0, 7);
  const rangeEnd = String(year?.endDate || property?.tenancyEndDate || "").slice(0, 7);
  const inPropertyPeriod =
    (!rangeStart || month >= rangeStart) && (!rangeEnd || month <= rangeEnd);
  const tenants = records.filter(
    (record) => record.kind === "tenant" && record.propertyId === propertyId,
  );
  const tenancies = records.filter(
    (record) => record.kind === "tenancy" && record.propertyId === propertyId,
  );
  const payments = records.filter(
    (record) =>
      record.kind === "rentPayment" &&
      record.propertyId === propertyId &&
      rentMonth(record) === month,
  );
  const paymentsByTenant = new Map<string, PortfolioRecord[]>();
  for (const payment of payments) {
    const tenantId = String(payment.tenantId || "");
    const group = paymentsByTenant.get(tenantId) ?? [];
    group.push(payment);
    paymentsByTenant.set(tenantId, group);
  }

  const tenantRows: TenantRentMonth[] = tenants.map((tenant) => {
    const tenantPayments = paymentsByTenant.get(tenant.id) ?? [];
    paymentsByTenant.delete(tenant.id);
    const receivedPence = tenantPayments.reduce(
      (sum, payment) => sum + pence(payment.amountPaidPence),
      0,
    );
    const recordedDue = tenantPayments.reduce(
      (largest, payment) => Math.max(largest, pence(payment.amountDuePence)),
      0,
    );
    const scheduled = inPropertyPeriod && tenantAppliesToMonth(tenant, tenancies, month);
    const baseExpected = scheduled
      ? pence(tenant.monthlyRentPence) || recordedDue
      : 0;
    const expectedPence = tenantPayments.some((payment) => payment.status === "waived")
      ? Math.min(baseExpected, receivedPence)
      : baseExpected;
    return {
      tenantId: tenant.id,
      expectedPence,
      receivedPence,
      outstandingPence: Math.max(0, expectedPence - receivedPence),
      hasPayments: tenantPayments.length > 0,
    };
  });

  for (const [tenantId, tenantPayments] of paymentsByTenant) {
    const receivedPence = tenantPayments.reduce(
      (sum, payment) => sum + pence(payment.amountPaidPence),
      0,
    );
    const baseExpected = inPropertyPeriod
      ? tenantPayments.reduce(
          (largest, payment) => Math.max(largest, pence(payment.amountDuePence)),
          0,
        )
      : 0;
    const expectedPence = tenantPayments.some((payment) => payment.status === "waived")
      ? Math.min(baseExpected, receivedPence)
      : baseExpected;
    tenantRows.push({
      tenantId,
      expectedPence,
      receivedPence,
      outstandingPence: Math.max(0, expectedPence - receivedPence),
      hasPayments: true,
    });
  }

  return {
    expectedPence: tenantRows.reduce((sum, row) => sum + row.expectedPence, 0),
    receivedPence: tenantRows.reduce((sum, row) => sum + row.receivedPence, 0),
    outstandingPence: tenantRows.reduce((sum, row) => sum + row.outstandingPence, 0),
    tenants: tenantRows,
  };
}

export function calculateRentLedger(records: PortfolioRecord[], throughMonth: string) {
  const propertyIds = new Set(
    records
      .filter((record) =>
        ["property", "tenant", "tenancy", "rentPayment", "rentalYear"].includes(record.kind),
      )
      .map((record) => String(record.kind === "property" ? record.id : record.propertyId || ""))
      .filter(Boolean),
  );
  const byProperty = [...propertyIds].map((propertyId) => {
    const property = records.find(
      (record) => record.kind === "property" && record.id === propertyId,
    );
    const year = rentalYearFor(records, propertyId);
    const configuredStart = String(year?.startDate || property?.tenancyStartDate || "").slice(0, 7);
    const configuredEnd = String(year?.endDate || property?.tenancyEndDate || "").slice(0, 7);
    const end = configuredEnd && configuredEnd < throughMonth ? configuredEnd : throughMonth;
    const months = new Set<string>();
    if (validMonth(configuredStart) && validMonth(end)) {
      const startIndex = monthIndex(configuredStart);
      const endIndex = monthIndex(end);
      const count = Math.min(240, Math.max(0, endIndex - startIndex + 1));
      for (let offset = 0; offset < count; offset += 1) months.add(monthAt(startIndex + offset));
    }
    const propertyPayments = records.filter(
      (record) => record.kind === "rentPayment" && record.propertyId === propertyId,
    );
    for (const payment of propertyPayments) {
      const month = rentMonth(payment);
      if (validMonth(month) && month <= throughMonth) months.add(month);
    }
    const summaries = [...months].map((month) => calculateRentMonth(records, propertyId, month));
    const invalidMonthPayments = propertyPayments.filter((payment) => !validMonth(rentMonth(payment)));
    const invalidGroups = new Map<string, PortfolioRecord[]>();
    for (const payment of invalidMonthPayments) {
      const key = String(payment.tenantId || payment.id);
      const group = invalidGroups.get(key) ?? [];
      group.push(payment);
      invalidGroups.set(key, group);
    }
    const legacyRows = [...invalidGroups.values()].map((group) => {
      const due = group.reduce(
        (largest, payment) => Math.max(largest, pence(payment.amountDuePence)),
        0,
      );
      const received = group.reduce(
        (total, payment) => total + pence(payment.amountPaidPence),
        0,
      );
      const expected = group.some((payment) => payment.status === "waived")
        ? Math.min(due, received)
        : due;
      return { expected, outstanding: Math.max(0, expected - received) };
    });
    return {
      propertyId,
      expectedPence:
        summaries.reduce((sum, summary) => sum + summary.expectedPence, 0) +
        legacyRows.reduce((sum, row) => sum + row.expected, 0),
      receivedPence: propertyPayments.reduce(
        (sum, payment) => sum + pence(payment.amountPaidPence),
        0,
      ),
      outstandingPence:
        summaries.reduce((sum, summary) => sum + summary.outstandingPence, 0) +
        legacyRows.reduce((sum, row) => sum + row.outstanding, 0),
    };
  });
  return {
    expectedPence: byProperty.reduce((sum, property) => sum + property.expectedPence, 0),
    receivedPence: byProperty.reduce((sum, property) => sum + property.receivedPence, 0),
    outstandingPence: byProperty.reduce((sum, property) => sum + property.outstandingPence, 0),
    byProperty,
  };
}

export function calculateDashboard(records: PortfolioRecord[]) {
  const historicalYearIds = new Set(
    records
      .filter((r) => r.kind === "rentalYear" && (r.status === "closed" || r.status === "restored"))
      .map((r) => r.id),
  );
  const currentRecords = records.filter(
    (r) => !r.rentalYearId || !historicalYearIds.has(String(r.rentalYearId)),
  );
  const properties = currentRecords.filter((r) => r.kind === "property");
  const tenancies = currentRecords.filter(
    (r) => r.kind === "tenancy" && r.status === "active",
  );
  const tenants = currentRecords.filter((r) => r.kind === "tenant");
  const payments = currentRecords.filter((r) => r.kind === "rentPayment");
  const expenses = currentRecords.filter((r) => r.kind === "expense");
  const compliance = currentRecords.filter((r) => r.kind === "compliance");
  const incomePence = payments.reduce(
    (sum, r) => sum + pence(r.amountPaidPence),
    0,
  );
  const today = new Date().toISOString().slice(0, 10);
  const rentLedger = calculateRentLedger(currentRecords, today.slice(0, 7));
  const expensePence = expenses.reduce(
    (sum, r) => sum + pence(r.amountPence),
    0,
  );
  const occupiedProperties = new Set([
    ...tenancies.map((r) => r.propertyId),
    ...tenants.map((r) => r.propertyId),
  ]).size;
  const now = Date.now();
  const soon = now + 60 * 86400000;
  const upcoming = compliance
    .filter(
      (r) =>
        typeof r.expiryDate === "string" &&
        r.expiryDate &&
        new Date(`${r.expiryDate}T00:00:00Z`).getTime() <= soon,
    )
    .sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)))
    .slice(0, 8);
  const byProperty = properties.map((property) => {
    const id = property.id;
    const income = payments
      .filter((r) => r.propertyId === id)
      .reduce((sum, r) => sum + pence(r.amountPaidPence), 0);
    const costs = expenses
      .filter((r) => r.propertyId === id)
      .reduce((sum, r) => sum + pence(r.amountPence), 0);
    return {
      propertyId: id,
      name: property.name,
      incomePence: income,
      expensePence: costs,
      balancePence: income - costs,
    };
  });
  return {
    propertyCount: properties.length,
    activeTenancies: tenants.length || tenancies.length,
    occupiedProperties,
    occupancyPercent: properties.length
      ? Math.round((occupiedProperties / properties.length) * 100)
      : 0,
    incomePence,
    expensePence,
    balancePence: incomePence - expensePence,
    arrearsPence: rentLedger.outstandingPence,
    upcoming,
    byProperty,
  };
}
