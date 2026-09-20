import type { HttpRequest } from "@azure/functions";
import type { AuthenticatedUser } from "../domain/types";
import { getDirectory } from "./directory";
import { assertProductionConfiguration } from "./credential";

interface ClientPrincipal { identityProvider?: string; userId: string; userDetails: string; userRoles: string[] }

export class AuthError extends Error { constructor(message: string, public status = 401, public code = "unauthorized") { super(message); } }

export function authenticateIdentity(request: HttpRequest): AuthenticatedUser {
  assertProductionConfiguration();
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (["POST", "PATCH", "DELETE"].includes(request.method) && contentType !== "application/json" && !request.headers.has("x-document-metadata"))
    throw new AuthError("Mutations require JSON or the protected document upload header.", 415, "unsupported_content_type");
  if (process.env.LOCAL_AUTH === "true" && process.env.NODE_ENV === "development") {
    const email = (request.headers.get("x-local-user") ?? "developer@localhost").trim().toLowerCase();
    return { userId: `local-${email}`, email, roles: ["authenticated"] };
  }
  const encoded = request.headers.get("x-ms-client-principal");
  if (!encoded) throw new AuthError("Sign in is required.");
  let principal: ClientPrincipal;
  try { principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ClientPrincipal; }
  catch { throw new AuthError("The identity header is invalid."); }
  const email = principal.userDetails?.trim().toLowerCase();
  if (!email || !principal.userId || !principal.userRoles?.includes("authenticated")) throw new AuthError("A valid Microsoft account is required.");
  if (!["aad", "microsoftaccount"].includes(principal.identityProvider?.toLowerCase() ?? "")) throw new AuthError("Use a Microsoft account to sign in.", 403, "microsoft_only");
  return { userId: principal.userId, email, roles: principal.userRoles };
}

export async function authenticatePlatform(request: HttpRequest) {
  return getDirectory().resolveUser(authenticateIdentity(request));
}

export async function authorizeOrganization(request: HttpRequest, ownerOnly = false) {
  const organizationId = request.headers.get("x-organization-id")?.trim() ?? "";
  return getDirectory().authorize(authenticateIdentity(request), organizationId, ownerOnly);
}
