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
  kind: RecordKind;
  organizationId: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  _etag?: string;
  [key: string]: unknown;
}
export interface DashboardData {
  propertyCount: number;
  activeTenancies: number;
  occupiedProperties: number;
  occupancyPercent: number;
  incomePence: number;
  expensePence: number;
  balancePence: number;
  arrearsPence: number;
  upcoming: PortfolioRecord[];
  byProperty: {
    propertyId: string;
    name: string;
    incomePence: number;
    expensePence: number;
    balancePence: number;
  }[];
}
export interface User {
  userId: string;
  email: string;
  roles: string[];
  isPlatformAdmin?: boolean;
}
export type OrganizationRole = "owner" | "editor";
export interface Organization {
  id: string;
  name: string;
  role: OrganizationRole;
}
export interface Session {
  user: User;
  organizations: Organization[];
}
