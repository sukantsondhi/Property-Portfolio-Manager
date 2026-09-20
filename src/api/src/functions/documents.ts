import { app } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateRecord } from "../domain/schemas";
import type { PortfolioRecord } from "../domain/types";
import { authorizeOrganization } from "../services/auth";
import {
  allowedMimeTypes,
  assertFileSignature,
  blobProperties,
  buildBlobName,
  deleteBlob,
  downloadBlobBuffer,
  downloadSas,
  maxFileSize,
  uploadSas,
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

app.http("documentUploadUrl", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "documents/upload-url",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      if (process.env.DOCUMENT_UPLOADS_ENABLED !== "true") throw new StoreError(503, "uploads_disabled", "Document uploads are disabled by the administrator.");
      const input = uploadRequest.parse(await request.json());
      if (!allowedMimeTypes.has(input.mimeType))
        throw new StoreError(
          400,
          "unsupported_file",
          "Use PDF, JPG, PNG, WebP, DOCX, or XLSX files.",
        );
      const target = await resolveDocumentTarget(getStore(user.organizationId), input);
      const documentId = randomUUID();
      const blobName = buildBlobName(
        documentId,
        target.propertyId,
        input.category,
        input.fileName,
        user.organizationId,
      );
      return json(200, {
        documentId,
        blobName,
        ...target,
        ...(await uploadSas(blobName, input.mimeType)),
      });
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("documentComplete", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "documents/complete",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      if (process.env.DOCUMENT_UPLOADS_ENABLED !== "true") throw new StoreError(503, "uploads_disabled", "Document uploads are disabled by the administrator.");
      const input = uploadRequest
        .extend({ documentId: z.string().uuid(), blobName: z.string().min(1) })
        .parse(await request.json());
      const target = await resolveDocumentTarget(getStore(user.organizationId), input);
      const expectedBlobName = buildBlobName(
        input.documentId,
        target.propertyId,
        input.category,
        input.fileName,
        user.organizationId,
      );
      if (input.blobName !== expectedBlobName)
        throw new StoreError(
          400,
          "invalid_blob_name",
          "The uploaded document key is invalid.",
        );
      const properties = await blobProperties(input.blobName);
      try {
        if (
          !properties.contentLength ||
          properties.contentLength > maxFileSize ||
          properties.contentLength !== input.size
        )
          throw new StoreError(
            400,
            "invalid_upload",
            "The uploaded file size does not match the request.",
          );
        if (!allowedMimeTypes.has(properties.contentType ?? ""))
          throw new StoreError(
            400,
            "unsupported_file",
            "The uploaded file type is not allowed.",
          );
        if (properties.contentType !== input.mimeType)
          throw new StoreError(
            400,
            "mime_type_mismatch",
            "The uploaded file type does not match the request.",
          );
        assertFileSignature(input.fileName, input.mimeType, await downloadBlobBuffer(input.blobName));
      } catch (error) {
        await deleteBlob(input.blobName).catch(() => undefined);
        throw error;
      }
      const record = validateRecord("document", {
        ...input,
        ...target,
        blobName: expectedBlobName,
        size: properties.contentLength,
      });
      return json(201, await getStore(user.organizationId).create("document", record, user));
    } catch (error) {
      return problem(error);
    }
  },
});

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
