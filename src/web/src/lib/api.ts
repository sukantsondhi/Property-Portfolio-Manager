import type {
  DashboardData,
  PortfolioRecord,
  RecordKind,
  Session,
  Organization,
} from "../types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}
let organizationId = localStorage.getItem("ppm.organizationId") ?? "";
export function setApiOrganization(id: string) { organizationId = id; }
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(organizationId ? { "x-organization-id": organizationId } : {}), ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const rawBody = await response.text();
  let body: any = {};
  if (contentType.includes("application/json") && rawBody) {
    try { body = JSON.parse(rawBody); } catch { body = {}; }
  }
  if (!response.ok)
    throw new ApiError(
      body?.error?.message || (contentType.includes("text/html")
        ? `The request was blocked before it reached the application (HTTP ${response.status}). Refresh the page and try again.`
        : `Request failed (HTTP ${response.status}).`),
      response.status,
      body?.error?.details,
    );
  if (!contentType.includes("application/json"))
    throw new ApiError(response.redirected
      ? "Your sign-in session expired. Refresh the page and sign in again."
      : "The application received an unexpected server response. Refresh the page and try again.", response.status);
  return body as T;
}
export const api = {
  me: () => request<Session>("/me"),
  organizations: () => request<Organization[]>("/organizations"),
  createOrganization: (name: string) => request<Organization>("/organizations", { method: "POST", body: JSON.stringify({ name }) }),
  members: (id: string) => request<{ members: { id: string; email: string; role: string; status: "accepted"; acceptedAt: string }[]; invitations: { id: string; email: string; role: string; status: "pending" | "accepted" | "revoked"; expiresAt?: string; acceptedAt?: string; updatedAt: string }[] }>(`/organizations/${id}/members`),
  inviteMember: (id: string, email: string, role: string) => request<{ id: string; status: "pending" | "accepted"; existing: boolean; role: string; organizationName: string; emailDelivery: "sent" | "not_required" }>(`/organizations/${id}/invitations`, { method: "POST", body: JSON.stringify({ email, role }) }),
  removeMember: (id: string, membershipId: string) => request<void>(`/organizations/${id}/members/${membershipId}`, { method: "DELETE" }),
  deleteOrganization: (id: string, confirmationName: string) => request<{ id: string; name: string; deletedRecordCount: number; deletedBlobCount: number; blobCleanupFailures: number; memberNotificationsSent: number; memberNotificationFailures: number }>(`/organizations/${id}`, { method: "DELETE", body: JSON.stringify({ confirmationName }) }),
  platformInvitations: () => request<{ id: string; email: string; status: "pending" | "accepted" | "revoked"; expiresAt?: string; acceptedAt?: string; updatedAt?: string; isPlatformAdmin?: boolean }[]>("/platform/invitations"),
  invitePlatformUser: (email: string) => request<{ id: string; email: string; status: "pending" | "accepted"; existing: boolean; expiresAt?: string; acceptedAt?: string; emailDelivery: "sent" | "not_required" }>("/platform/invitations/create", { method: "POST", body: JSON.stringify({ email }) }),
  revokePlatformInvitation: (id: string) => request<void>(`/platform/invitations/${id}`, { method: "DELETE" }),
  setPlatformAdmin: (email: string, enabled: boolean) => request<{ id: string; email: string; isPlatformAdmin: boolean }>("/platform/admins", { method: "PATCH", body: JSON.stringify({ email, enabled }) }),
  removePlatformUser: (id: string) => request<void>(`/platform/users/${id}`, { method: "DELETE" }),
  dashboard: () => request<DashboardData>("/dashboard"),
  list: (
    kind: RecordKind,
    archived = false,
    continuationToken?: string,
  ) =>
    request<{ items: PortfolioRecord[]; continuationToken?: string }>(
      `/records/${kind}?archived=${archived}&limit=200${continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : ""}`,
    ),
  create: (kind: RecordKind, data: Record<string, unknown>) =>
    request<PortfolioRecord>(`/records/${kind}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  recordRentAdvance: (data: {
    propertyId: string;
    tenantId: string;
    tenancyId?: string;
    rentalYearId?: string;
    paidDate: string;
    additionalMonths: number;
    method: string;
    rentFrequency: string;
    bankReference: string;
    notes: string;
  }) =>
    request<{
      payments: PortfolioRecord[];
      coveredFrom: string;
      coveredTo: string;
      totalPaidPence: number;
    }>("/rent-payments/advance", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateRentAdvance: (
    record: PortfolioRecord,
    data: {
      paidDate: string;
      method: string;
      rentFrequency: string;
      bankReference: string;
      notes: string;
    },
  ) => request<{ payments: PortfolioRecord[] }>(
    `/rent-payments/advance/${record.id}`,
    {
      method: "PATCH",
      headers: record._etag ? { "if-match": record._etag } : {},
      body: JSON.stringify(data),
    },
  ),
  update: (record: PortfolioRecord, data: Record<string, unknown>) =>
    request<PortfolioRecord>(`/records/${record.kind}/${record.id}`, {
      method: "PATCH",
      headers: record._etag ? { "if-match": record._etag } : {},
      body: JSON.stringify(data),
    }),
  status: (record: PortfolioRecord, action: "archive" | "restore") =>
    request<PortfolioRecord>(`/records/${record.kind}/${record.id}/${action}`, {
      method: "POST",
      headers: record._etag ? { "if-match": record._etag } : {},
    }),
  permanentDelete: (record: PortfolioRecord) =>
    request<{ deletedCount: number; blobCleanupFailures: number }>(
      `/records/${record.kind}/${record.id}`,
      {
        method: "DELETE",
        headers: record._etag ? { "if-match": record._etag } : {},
      },
    ),
  downloadUrl: (id: string) =>
    request<{ url: string; expiresAt: string }>(
      `/documents/${id}/download-url`,
      { method: "POST" },
    ),
  viewUrl: (id: string) =>
    request<{ url: string; expiresAt: string }>(
      `/documents/${id}/view-url`,
      { method: "POST" },
    ),
  uploadDocument: async (
    file: File,
    data: { propertyId?: string; tenantId?: string; rentalYearId?: string; category: string },
  ) => {
    const metadata = {
      ...data,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    };
    return request<PortfolioRecord>("/documents/upload", {
      method: "POST",
      headers: {
        "content-type": file.type,
        "x-document-metadata": encodeURIComponent(JSON.stringify(metadata)),
      },
      body: file,
    });
  },
  startRentalYear: (
    propertyId: string,
    data: {
      label: string;
      startDate: string;
      endDate: string;
      annualRentPence: number;
    },
  ) =>
    request<{
      current: PortfolioRecord;
      closed?: PortfolioRecord;
      recordsMoved: number;
      backupEmail: "sent" | "not_required" | "failed";
      attachmentCount: number;
    }>(`/properties/${propertyId}/rental-years/start`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  restoreRentalYear: (propertyId: string, year: PortfolioRecord) =>
    request<PortfolioRecord>(`/properties/${propertyId}/rental-years/${year.id}/restore`, {
      method: "POST",
      headers: year._etag ? { "if-match": year._etag } : {},
    }),
  saveRentalYearToHistory: (propertyId: string, year: PortfolioRecord) =>
    request<PortfolioRecord>(`/properties/${propertyId}/rental-years/${year.id}/save-history`, {
      method: "POST",
      headers: year._etag ? { "if-match": year._etag } : {},
    }),
  updateRestoredYearProperty: (propertyId: string, year: PortfolioRecord, data: Record<string, unknown>) =>
    request<PortfolioRecord>(`/properties/${propertyId}/rental-years/${year.id}/property`, {
      method: "PATCH",
      headers: year._etag ? { "if-match": year._etag } : {},
      body: JSON.stringify(data),
    }),
};
