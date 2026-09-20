import { HttpRequest } from "@azure/functions";
import { afterEach, describe, expect, it } from "vitest";
import { authenticateIdentity } from "../src/services/auth";
import { getDirectory } from "../src/services/directory";
import { getStore } from "../src/services/store";

const requestFor = (principal?: object) => new HttpRequest({ method: "GET", url: "http://localhost/api/me", headers: principal ? { "x-ms-client-principal": Buffer.from(JSON.stringify(principal)).toString("base64") } : {} });
const principal = (overrides: Record<string, unknown> = {}) => ({ identityProvider: "aad", userId: "immutable-user-id", userDetails: "Person@Example.com", userRoles: ["authenticated"], ...overrides });

describe("Microsoft identity boundary", () => {
  afterEach(() => { delete process.env.LOCAL_AUTH; delete process.env.NODE_ENV; delete process.env.DATA_BACKEND; delete process.env.WEBSITE_INSTANCE_ID; });
  it("requires explicit development mode for local authentication", () => {
    process.env.LOCAL_AUTH = "true";
    delete process.env.NODE_ENV;
    expect(() => authenticateIdentity(requestFor())).toThrow("Sign in is required");
    process.env.NODE_ENV = "development";
    expect(authenticateIdentity(requestFor())).toMatchObject({ email: "developer@localhost" });
    process.env.WEBSITE_INSTANCE_ID = "synthetic-hosted-instance";
    expect(() => authenticateIdentity(requestFor())).toThrow("must not be enabled");
  });
  it("fails closed instead of using in-memory data in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATA_BACKEND = "memory";
    expect(() => getDirectory()).toThrow("must not be enabled");
    expect(() => getStore("synthetic")).toThrow("must not be enabled");
  });
  it("rejects browser-simple mutation bodies before they reach application handlers", () => {
    const headers = { "x-ms-client-principal": Buffer.from(JSON.stringify(principal())).toString("base64") };
    expect(() => authenticateIdentity(new HttpRequest({ method: "POST", url: "http://localhost/api/organizations", headers: { ...headers, "content-type": "text/plain" } }))).toThrow("Mutations require JSON");
    expect(authenticateIdentity(new HttpRequest({ method: "POST", url: "http://localhost/api/organizations", headers: { ...headers, "content-type": "application/json" } }))).toMatchObject({ userId: "immutable-user-id" });
  });
  it("normalizes an authenticated Microsoft identity", () => expect(authenticateIdentity(requestFor(principal()))).toMatchObject({ userId: "immutable-user-id", email: "person@example.com" }));
  it("rejects missing identity headers", () => expect(() => authenticateIdentity(requestFor())).toThrow("Sign in is required"));
  it("rejects a non-Microsoft provider", () => expect(() => authenticateIdentity(requestFor(principal({ identityProvider: "github" })))).toThrow("Use a Microsoft account"));
  it("rejects a principal without a provider", () => expect(() => authenticateIdentity(requestFor(principal({ identityProvider: undefined })))).toThrow("Use a Microsoft account"));
  it("rejects a principal without the authenticated role", () => expect(() => authenticateIdentity(requestFor(principal({ userRoles: ["anonymous"] })))).toThrow("valid Microsoft account"));
});
