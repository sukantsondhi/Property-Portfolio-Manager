import { app, type HttpRequest } from "@azure/functions";
import { z } from "zod";
import { validateRecord } from "../domain/schemas";
import { authorizeOrganization } from "../services/auth";
import { json, problem, StoreError } from "../services/responses";
import { getStore } from "../services/store";
import { getDirectory } from "../services/directory";
import { downloadBlobBase64 } from "../services/blobs";
import { rentalYearBackupEmail, sendPortfolioEmail } from "../services/portfolioEmails";

const inputSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    annualRentPence: z.number().int().positive().max(1_000_000_000),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "The rental year end date must be on or after its start date.",
    path: ["endDate"],
  });

function validId(value: string | undefined, label: string) {
  if (!z.string().uuid().safeParse(value).success)
    throw new StoreError(400, `invalid_${label}`, `A valid ${label.replace("_", " ")} identifier is required.`);
  return value!;
}

function requireEtag(request: HttpRequest) {
  const etag = request.headers.get("if-match")?.trim();
  if (!etag) throw new StoreError(428, "precondition_required", "Refresh the rental year and try again.");
  return etag;
}

app.http("startRentalYear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "properties/{id}/rental-years/start",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const propertyId = validId(request.params.id, "property");
      const input = inputSchema.parse(await request.json());
      const store = getStore(user.organizationId);
      const result = await store.startRentalYear(propertyId, input, user);
      let backupEmail: "sent" | "not_required" | "failed" = "not_required";
      let attachmentCount = 0;
      if (result.closed) {
        try {
          const [property, targets, records] = await Promise.all([
            store.get("property", propertyId),
            getDirectory().organizationBackupTargets(user.organizationId),
            store.allActive(),
          ]);
          const yearRecords = records.filter((record) => record.rentalYearId === result.closed!.id);
          const documents = yearRecords.filter((record) => record.kind === "document");
          const attachments: { name: string; contentType: string; contentInBase64: string }[] = [];
          let attachedBytes = 0;
          for (const document of documents) {
            const size = Number(document.size || 0);
            if (!document.blobName || !size || attachedBytes + size > 6 * 1024 * 1024) continue;
            try {
              attachments.push({
                name: String(document.fileName || "document").replace(/[\\/\r\n]/g, "_"),
                contentType: String(document.mimeType || "application/octet-stream"),
                contentInBase64: await downloadBlobBase64(String(document.blobName), Math.min(size, 6 * 1024 * 1024 - attachedBytes)),
              });
              attachedBytes += size;
            } catch {
              // The protected history link remains available when a blob cannot be attached.
            }
          }
          attachmentCount = attachments.length;
          if (targets.recipients.length) {
            const historicalProperty = result.closed.propertySnapshot && typeof result.closed.propertySnapshot === "object"
              ? result.closed.propertySnapshot as typeof property
              : property;
            const message = rentalYearBackupEmail({ organizationId: user.organizationId, organizationName: targets.name, property: historicalProperty, year: result.closed, records: yearRecords, recipients: [], attachments });
            await Promise.all(
              targets.recipients.map((recipient) =>
                sendPortfolioEmail({ ...message, recipients: [recipient] }),
              ),
            );
            backupEmail = "sent";
          }
        } catch {
          backupEmail = "failed";
          console.error("Rental-year backup email delivery failed after rollover.");
        }
      }
      return json(201, { ...result, backupEmail, attachmentCount });
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("restoreRentalYear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "properties/{id}/rental-years/{yearId}/restore",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const propertyId = validId(request.params.id, "property");
      const yearId = validId(request.params.yearId, "rental_year");
      return json(200, await getStore(user.organizationId).restoreRentalYear(propertyId, yearId, user, requireEtag(request)));
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("saveRentalYearToHistory", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "properties/{id}/rental-years/{yearId}/save-history",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const propertyId = validId(request.params.id, "property");
      const yearId = validId(request.params.yearId, "rental_year");
      return json(200, await getStore(user.organizationId).saveRentalYearToHistory(propertyId, yearId, user, requireEtag(request)));
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("updateRestoredRentalYearProperty", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "properties/{id}/rental-years/{yearId}/property",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const propertyId = validId(request.params.id, "property");
      const yearId = validId(request.params.yearId, "rental_year");
      const input = validateRecord("property", await request.json());
      return json(200, await getStore(user.organizationId).updateRestoredYearProperty(propertyId, yearId, input, user, requireEtag(request)));
    } catch (error) {
      return problem(error);
    }
  },
});
