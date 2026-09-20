import { describe, expect, it } from 'vitest';
import { calculateDashboard, calculateRentLedger, calculateRentMonth } from '../src/services/finance';
import type { PortfolioRecord } from '../src/domain/types';

const record = (kind: PortfolioRecord['kind'], data: Record<string, unknown>): PortfolioRecord => ({ id: crypto.randomUUID(), organizationId: 'test-organization', kind, archived: false, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1, ...data });
describe('dashboard calculations', () => {
  it('calculates income, costs, balance, arrears and occupancy', () => {
    const result = calculateDashboard([record('property', { name: 'Alpha' }), record('property', { name: 'Beta' }), record('tenancy', { propertyId: 'a', status: 'active' }), record('rentPayment', { propertyId: 'a', amountDuePence: 100000, amountPaidPence: 75000 }), record('expense', { propertyId: 'a', amountPence: 25000 })]);
    expect(result).toMatchObject({ propertyCount: 2, occupiedProperties: 1, occupancyPercent: 50, incomePence: 75000, expensePence: 25000, balancePence: 50000, arrearsPence: 25000 });
  });
  it('keeps a restored historical year out of live totals', () => {
    const property = record('property', { name: 'Alpha' });
    const year = record('rentalYear', { propertyId: property.id, status: 'restored' });
    const result = calculateDashboard([
      property,
      year,
      record('tenant', { propertyId: property.id, rentalYearId: year.id, monthlyRentPence: 100000 }),
      record('rentPayment', { propertyId: property.id, rentalYearId: year.id, amountPaidPence: 75000 }),
      record('expense', { propertyId: property.id, rentalYearId: year.id, amountPence: 25000 }),
    ]);
    expect(result).toMatchObject({ activeTenancies: 0, occupiedProperties: 0, incomePence: 0, expensePence: 0 });
  });
  it('counts one July liability per tenant instead of one per instalment row', () => {
    const property = record('property', { name: 'July House', tenancyStartDate: '2026-07-01', tenancyEndDate: '2027-06-30' });
    const year = record('rentalYear', { propertyId: property.id, status: 'current', startDate: '2026-07-01', endDate: '2027-06-30' });
    const tenants = Array.from({ length: 7 }, (_, index) => record('tenant', {
      propertyId: property.id,
      rentalYearId: year.id,
      firstName: `Tenant ${index + 1}`,
      monthlyRentPence: 60000,
    }));
    const futureAgreement = record('tenancy', {
      propertyId: property.id,
      rentalYearId: year.id,
      tenantIds: [tenants[6].id],
      startDate: '2026-08-01',
      endDate: '2027-06-30',
      status: 'active',
    });
    const payment = (tenantId: string, status: string, amountPaidPence: number) => record('rentPayment', {
      propertyId: property.id,
      rentalYearId: year.id,
      tenantId,
      appliesToMonth: '2026-07',
      paidDate: '2026-07-09',
      amountDuePence: 60000,
      amountPaidPence,
      status,
    });
    const payments = [
      payment(tenants[0].id, 'partial', 30000),
      payment(tenants[0].id, 'late', 30000),
      ...tenants.slice(1, 6).map((tenant) => payment(tenant.id, 'paid', 60000)),
    ];
    const records = [property, year, ...tenants, futureAgreement, ...payments];

    expect(calculateRentMonth(records, property.id, '2026-07')).toMatchObject({
      expectedPence: 360000,
      receivedPence: 360000,
      outstandingPence: 0,
    });
    expect(calculateRentLedger(records, '2026-07')).toMatchObject({
      expectedPence: 360000,
      receivedPence: 360000,
      outstandingPence: 0,
    });
  });
  it('does not let waivers, overpayments or future advances distort arrears', () => {
    const property = record('property', { name: 'Arrears House', tenancyStartDate: '2026-07-01', tenancyEndDate: '2027-06-30' });
    const tenants = [
      record('tenant', { propertyId: property.id, monthlyRentPence: 60000 }),
      record('tenant', { propertyId: property.id, monthlyRentPence: 60000 }),
      record('tenant', { propertyId: property.id, monthlyRentPence: 60000 }),
    ];
    const payments = [
      record('rentPayment', { propertyId: property.id, tenantId: tenants[0].id, appliesToMonth: '2026-07', amountDuePence: 60000, amountPaidPence: 90000, status: 'paid' }),
      record('rentPayment', { propertyId: property.id, tenantId: tenants[1].id, appliesToMonth: '2026-07', amountDuePence: 60000, amountPaidPence: 0, status: 'due' }),
      record('rentPayment', { propertyId: property.id, tenantId: tenants[2].id, appliesToMonth: '2026-07', amountDuePence: 60000, amountPaidPence: 0, status: 'waived' }),
      record('rentPayment', { propertyId: property.id, tenantId: tenants[1].id, appliesToMonth: '2026-08', amountDuePence: 60000, amountPaidPence: 60000, status: 'in_advance' }),
    ];
    const july = calculateRentMonth([property, ...tenants, ...payments], property.id, '2026-07');
    const ledger = calculateRentLedger([property, ...tenants, ...payments], '2026-07');

    expect(july).toMatchObject({ expectedPence: 120000, receivedPence: 90000, outstandingPence: 60000 });
    expect(ledger).toMatchObject({ expectedPence: 120000, receivedPence: 150000, outstandingPence: 60000 });
  });
});
