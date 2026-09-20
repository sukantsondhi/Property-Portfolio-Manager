import { HttpRequest } from "@azure/functions";
import { afterEach, describe, expect, it } from "vitest";
import { authenticateIdentity } from "../src/services/auth";

const requestFor = (principal?: object) => new HttpRequest({ method: "GET", url: "http://localhost/api/me", headers: principal ? { "x-ms-client-principal": Buffer.from(JSON.stringify(principal)).toString("base64") } : {} });
const principal = (overrides: Record<string, unknown> = {}) => ({ identityProvider: "aad", userId: "immutable-user-id", userDetails: "Person@Example.com", userRoles: ["authenticated"], ...overrides });

describe("Microsoft identity boundary", () => {
  afterEach(() => { delete process.env.LOCAL_AUTH; delete process.env.NODE_ENV; });
  it("normalizes an authenticated Microsoft identity", () => expect(authenticateIdentity(requestFor(principal()))).toMatchObject({ userId: "immutable-user-id", email: "person@example.com" }));
  it("rejects missing identity headers", () => expect(() => authenticateIdentity(requestFor())).toThrow("Sign in is required"));
  it("rejects a non-Microsoft provider", () => expect(() => authenticateIdentity(requestFor(principal({ identityProvider: "github" })))).toThrow("Use a Microsoft account"));
  it("rejects a principal without a provider", () => expect(() => authenticateIdentity(requestFor(principal({ identityProvider: undefined })))).toThrow("Use a Microsoft account"));
  it("rejects a principal without the authenticated role", () => expect(() => authenticateIdentity(requestFor(principal({ userRoles: ["anonymous"] })))).toThrow("valid Microsoft account"));
});
