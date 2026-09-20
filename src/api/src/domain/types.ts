export const recordKinds = [
  "property",
  "tenant",
  "guarantor",
  "reference",
  "tenancy",
  "rentPayment",
  "expense",
  "compliance",
  "document",
  "rentalYear",
] as const;

export type RecordKind = (typeof recordKinds)[number];

export interface PortfolioRecord {
  id: string;
  organizationId: string;
  kind: RecordKind;
  archived: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  _etag?: string;
  [key: string]: unknown;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: string[];
  isPlatformAdmin?: boolean;
  organizationId?: string;
  organizationRole?: OrganizationRole;
}

export type OrganizationRole = "owner" | "editor";

export interface OrganizationSummary {
  id: string;
  name: string;
  role: OrganizationRole;
}

export interface PlatformSession {
  user: AuthenticatedUser;
  organizations: OrganizationSummary[];
}

export interface ListOptions {
  archived?: boolean;
  search?: string;
  propertyId?: string;
  tenantId?: string;
  rentalYearId?: string;
  limit?: number;
}

export interface ListPage {
  items: PortfolioRecord[];
  continuationToken?: string;
}

export interface StartRentalYearInput {
  label: string;
  startDate: string;
  endDate: string;
  annualRentPence: number;
}

export interface AdvanceRentPaymentInput {
  propertyId: string;
  tenantId: string;
  tenancyId?: string;
  rentalYearId?: string;
  paidDate: string;
  additionalMonths: number;
  method: "bank_transfer" | "cash" | "other";
  rentFrequency: "monthly" | "quarterly" | "yearly";
  bankReference: string;
  notes: string;
}

export type AdvanceRentPaymentUpdateInput = Pick<
  AdvanceRentPaymentInput,
  "paidDate" | "method" | "rentFrequency" | "bankReference" | "notes"
>;
