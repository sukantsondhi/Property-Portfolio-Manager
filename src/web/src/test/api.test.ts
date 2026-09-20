import { afterEach, expect, it, vi } from "vitest";
import { api, setApiOrganization } from "../lib/api";

afterEach(() => { vi.unstubAllGlobals(); setApiOrganization(""); });

it("uploads bytes through the same-origin authorised API without a write SAS", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "document", kind: "document" }), { status: 201, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  setApiOrganization("organisation");
  const file = new File(["%PDF-1.7"], "lease.pdf", { type: "application/pdf" });
  await api.uploadDocument(file, { propertyId: "property", category: "tenancy" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith("/api/documents/upload", expect.objectContaining({ method: "POST", body: file, headers: expect.objectContaining({ "x-organization-id": "organisation", "content-type": "application/pdf" }) }));
  const metadata = JSON.parse(decodeURIComponent(fetch.mock.calls[0][1].headers["x-document-metadata"]));
  expect(metadata).toEqual({ propertyId: "property", category: "tenancy", fileName: "lease.pdf", mimeType: "application/pdf", size: 8 });
});