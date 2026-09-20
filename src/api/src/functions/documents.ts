import { app, type HttpRequest } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateRecord } from "../domain/schemas";
import type { PortfolioRecord } from "../domain/types";
import { authorizeOrganization } from "../services/auth";
import {
  allowedMimeTypes,
  assertFileSignature,
  buildBlobName,
  deleteBlob,
  downloadSas,
  maxFileSize,
  uploadBlob,
  viewSas,
} from "../services/blobs";
import { json, problem, StoreError } from "../services/responses";
import { getStore, type RecordStore } from "../services/store";

const uploadRequest = z.object({
  propertyId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  rentalYearId: z.string().uuid().optional(),
  category: z.string().trim().min(1).max(80),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string(),
  size: z.number().int().positive().max(maxFileSize),
});

type UploadInput = z.infer<typeof uploadRequest>;

export async function resolveDocumentTarget(store: RecordStore, input: UploadInput) {
  let tenant: PortfolioRecord | undefined;
  if (input.tenantId) {
    tenant = await store.get("tenant", input.tenantId);
    if (tenant.archived)
      throw new StoreError(
        409,
        "archived_target",
        "Restore the tenant before uploading a document for them.",
      );
    if (tenant.rentalYearId) {
      const year = await store.get("rentalYear", String(tenant.rentalYearId));
      if (year.status === "closed")
        throw new StoreError(
          409,
          "historical_target",
          "Closed rental-year records are read-only.",
        );
    }
  }

  const propertyId = input.propertyId || String(tenant?.propertyId || "");
  if (!propertyId)
    throw new StoreError(
      400,
      "document_target_required",
      "Choose a property or tenant for this document.",
    );
  if (tenant && tenant.propertyId !== propertyId)
    throw new StoreError(
      400,
      "target_mismatch",
      "The selected tenant does not belong to this property.",
    );
  const property = await store.get("property", propertyId);
  if (property.archived)
    throw new StoreError(
      409,
      "archived_target",
      "Restore the property before uploading documents.",
    );
  const rentalYearId = input.rentalYearId || String(tenant?.rentalYearId || "");
  if (rentalYearId) {
    const year = await store.get("rentalYear", rentalYearId);
    if (year.propertyId !== propertyId)
      throw new StoreError(400, "target_mismatch", "The selected rental year does not belong to this property.");
    if (year.status === "closed")
      throw new StoreError(409, "historical_target", "Restore the rental year before uploading documents to it.");
    if (tenant?.rentalYearId && tenant.rentalYearId !== rentalYearId)
      throw new StoreError(400, "target_mismatch", "The selected tenant belongs to a different rental year.");
  }
  return { propertyId, tenantId: input.tenantId || "", ...(rentalYearId ? { rentalYearId } : {}) };
}

export async function readUploadBody(body: HttpRequest["body"], size: number) {
  if (!body || !Number.isInteger(size) || size < 1 || size > maxFileSize)
    throw new StoreError(400, "invalid_upload", "A file of at most 25 MiB is required.");
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 30_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new StoreError(408, "upload_timeout", "The upload took too long. Try again.");
      if (done) break;
      length += value.byteLength;
      if (length > size || length > maxFileSize) {
        await reader.cancel().catch(() => undefined);
        throw new StoreError(413, "upload_too_large", "The uploaded file exceeds its declared size or the 25 MiB limit.");
      }
      chunks.push(Buffer.from(value));
    }
    if (length !== size) throw new StoreError(400, "invalid_upload", "The uploaded file size does not match the request.");
    return Buffer.concat(chunks, length);
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

export async function uploadDocument(request: HttpRequest) {
  try {
    const user = await authorizeOrganization(request);
    if (process.env.DOCUMENT_UPLOADS_ENABLED !== "true") throw new StoreError(503, "uploads_disabled", "Document uploads are disabled by the administrator.");
    let metadata: unknown;
    try {
      const encoded = request.headers.get("x-document-metadata") ?? "";
      if (encoded.length > 8192) throw new Error("metadata_limit");
      metadata = JSON.parse(decodeURIComponent(encoded));
    } catch { throw new StoreError(400, "invalid_upload_metadata", "Valid document metadata is required."); }
    const input = uploadRequest.parse(metadata);
    if (!allowedMimeTypes.has(input.mimeType) || request.headers.get("content-type") !== input.mimeType)
      throw new StoreError(400, "unsupported_file", "Use PDF, JPG, PNG, WebP, DOCX, or XLSX files with a matching file type.");
    const declaredLength = request.headers.get("content-length");
    if (declaredLength && Number(declaredLength) !== input.size)
      throw new StoreError(400, "invalid_upload", "The uploaded file size does not match the request.");
    const store = getStore(user.organizationId);
    const target = await resolveDocumentTarget(store, input);
    const documentId = randomUUID();
    const blobName = buildBlobName(documentId, target.propertyId, input.category, input.fileName, user.organizationId);
    const reservation = await store.reserveDocumentUpload(documentId, validateRecord("document", { ...input, ...target, blobName }), user);
    try {
      const content = await readUploadBody(request.body, input.size);
      assertFileSignature(input.fileName, input.mimeType, content);
      await authorizeOrganization(request);
      await uploadBlob(blobName, input.mimeType, content);
      const authorized = await authorizeOrganization(request);
      return json(201, await store.completeDocumentUpload(reservation, authorized));
    } catch (error) {
      await store.abandonDocumentUpload(reservation, user, deleteBlob).catch(() => undefined);
      throw error;
    }
  } catch (error) { return problem(error); }
}

export async function retiredDocumentUpload(request: HttpRequest) {
  try {
    await authorizeOrganization(request);
    throw new StoreError(410, "upload_workflow_changed", "Refresh the application before uploading documents.");
  } catch (error) { return problem(error); }
}

app.http("documentUpload", { methods: ["POST"], authLevel: "anonymous", route: "documents/upload", handler: uploadDocument });
app.http("documentUploadUrl", { methods: ["POST"], authLevel: "anonymous", route: "documents/upload-url", handler: retiredDocumentUpload });
app.http("documentComplete", { methods: ["POST"], authLevel: "anonymous", route: "documents/complete", handler: retiredDocumentUpload });

app.http("documentDownload", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "documents/{id}/download-url",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const record = await getStore(user.organizationId).get("document", request.params.id);
      if (record.archived)
        throw new StoreError(
          409,
          "archived",
          "Restore this document before downloading it.",
        );
      return json(
        200,
        await downloadSas(
          String(record.blobName),
          String(record.fileName),
          String(record.mimeType),
        ),
      );
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("documentView", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "documents/{id}/view-url",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const record = await getStore(user.organizationId).get(
        "document",
        request.params.id,
      );
      if (record.archived)
        throw new StoreError(409, "archived", "Restore this image before viewing it.");
      if (!String(record.mimeType).startsWith("image/"))
        throw new StoreError(400, "not_an_image", "Only image documents can be viewed inline.");
      return json(
        200,
        await viewSas(String(record.blobName), String(record.mimeType)),
      );
    } catch (error) {
      return problem(error);
    }
  },
});
