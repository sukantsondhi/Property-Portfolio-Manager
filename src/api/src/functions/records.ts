import { app, type HttpRequest } from "@azure/functions";
import { authorizeOrganization } from "../services/auth";
import {
  advanceRentPaymentInput,
  advanceRentPaymentUpdateInput,
  isRecordKind,
  validateRecord,
} from "../domain/schemas";
import { getStore } from "../services/store";
import { json, problem, StoreError } from "../services/responses";
import { deleteBlob } from "../services/blobs";

const kindOf = (request: HttpRequest) => {
  const kind = request.params.kind;
  if (!isRecordKind(kind))
    throw new StoreError(404, "unknown_record_type", "Unknown record type.");
  return kind;
};
const bodyOf = async (request: HttpRequest) => {
  try {
    return await request.json();
  } catch {
    throw new StoreError(400, "invalid_json", "A valid JSON body is required.");
  }
};

const listLimit = (request: HttpRequest) => {
  const raw = request.query.get("limit") ?? "100";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 200)
    throw new StoreError(
      400,
      "invalid_limit",
      "The list limit must be a whole number between 1 and 200.",
    );
  return value;
};

const requireEtag = (request: HttpRequest) => {
  const etag = request.headers.get("if-match")?.trim();
  if (!etag)
    throw new StoreError(
      428,
      "precondition_required",
      "Refresh the record and try again.",
    );
  return etag;
};

const assertGenericMutationAllowed = (
  kind: ReturnType<typeof kindOf>,
  method: string,
) => {
  if (
    (kind === "document" || kind === "rentalYear") &&
    (method === "POST" || method === "PATCH")
  )
    throw new StoreError(
      405,
      "managed_record",
      kind === "document"
        ? "Documents must be created through the protected upload workflow."
        : "Rental years must be created through the start-rental-year workflow.",
    );
};

const assertGenericRentAdvanceAllowed = (
  kind: ReturnType<typeof kindOf>,
  data: Record<string, unknown>,
) => {
  if (
    kind === "rentPayment" &&
    (data.status === "in_advance" ||
      Object.keys(data).some((key) => key.startsWith("advance")))
  )
    throw new StoreError(
      405,
      "managed_record",
      "Rent paid in advance must be recorded through the protected advance-payment workflow.",
    );
};

app.http("recordCollection", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "records/{kind}",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const kind = kindOf(request);
      const store = getStore(user.organizationId);
      if (request.method === "GET")
        return json(
          200,
          await store.listPage(
            kind,
            {
              archived: request.query.get("archived") === "true",
              search: request.query.get("search") ?? undefined,
              propertyId: request.query.get("propertyId") ?? undefined,
              tenantId: request.query.get("tenantId") ?? undefined,
              rentalYearId: request.query.get("rentalYearId") ?? undefined,
              limit: listLimit(request),
            },
            request.query.get("continuationToken") ?? undefined,
          ),
        );
      assertGenericMutationAllowed(kind, request.method);
      const data = validateRecord(kind, await bodyOf(request));
      assertGenericRentAdvanceAllowed(kind, data);
      return json(201, await store.create(kind, data, user));
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("recordItem", {
  methods: ["GET", "PATCH", "DELETE"],
  authLevel: "anonymous",
  route: "records/{kind}/{id}",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request, request.method === "DELETE");
      const kind = kindOf(request);
      const id = request.params.id;
      const store = getStore(user.organizationId);
      if (request.method === "GET") return json(200, await store.get(kind, id));
      if (request.method === "DELETE") {
        if (kind === "rentalYear")
          throw new StoreError(
            405,
            "managed_record",
            "Rental years are managed by the rental-year workflow.",
          );
        const etag = requireEtag(request);
        const result = await store.permanentDelete(
          kind,
          id,
          etag,
        );
        const blobResults = await Promise.allSettled(
          result.blobNames.map(async (blobName) => {
            await deleteBlob(blobName);
            await store.acknowledgeBlobDeletion(blobName);
          }),
        );
        const blobCleanupFailures = blobResults.filter(
          (result) => result.status === "rejected",
        ).length;
        if (blobCleanupFailures)
          console.error(
            `Failed to clean up ${blobCleanupFailures} permanently deleted document blob(s).`,
          );
        return json(200, {
          deletedCount: result.deletedCount,
          blobCleanupFailures,
        });
      }
      assertGenericMutationAllowed(kind, request.method);
      const data = validateRecord(kind, await bodyOf(request), true);
      assertGenericRentAdvanceAllowed(kind, data);
      return json(
        200,
        await store.update(kind, id, data, user, requireEtag(request)),
      );
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("advanceRentPayment", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "rent-payments/advance",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const input = advanceRentPaymentInput.parse(await bodyOf(request));
      const payments = await getStore(user.organizationId).createRentAdvance(
        input,
        user,
      );
      return json(201, {
        payments,
        coveredFrom: payments[0].appliesToMonth,
        coveredTo: payments.at(-1)?.appliesToMonth,
        totalPaidPence: payments.reduce(
          (sum, payment) => sum + Number(payment.amountPaidPence || 0),
          0,
        ),
      });
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("advanceRentPaymentUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "rent-payments/advance/{id}",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const input = advanceRentPaymentUpdateInput.parse(await bodyOf(request));
      const payments = await getStore(user.organizationId).updateRentAdvance(
        request.params.id,
        input,
        user,
        requireEtag(request),
      );
      return json(200, { payments });
    } catch (error) {
      return problem(error);
    }
  },
});

app.http("recordStatus", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "records/{kind}/{id}/{action}",
  handler: async (request) => {
    try {
      const user = await authorizeOrganization(request);
      const kind = kindOf(request);
      const action = request.params.action;
      if (kind === "rentalYear")
        throw new StoreError(
          405,
          "managed_record",
          "Rental years are managed by the rental-year workflow.",
        );
      if (!["archive", "restore"].includes(action))
        throw new StoreError(404, "unknown_action", "Unknown action.");
      return json(
        200,
        await getStore(user.organizationId).setArchived(
          kind,
          request.params.id,
          action === "archive",
          user,
          requireEtag(request),
        ),
      );
    } catch (error) {
      return problem(error);
    }
  },
});
