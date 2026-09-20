import { z } from "zod";
import { recordKinds, type RecordKind } from "./types";

const text = z.string().trim().max(1000);
const optionalText = text.optional().default("");
const id = z.string().uuid();
const optionalId = z
  .union([id, z.literal("")])
  .optional()
  .default("");
const isoDate = z
  .union([z.iso.date(), z.literal("")])
  .optional()
  .default("");
const money = z.number().int().min(0).max(1_000_000_000);
const requiredMoney = money.positive();
const rentalYearLink = { rentalYearId: optionalId };

const propertyBase = z.object({
    name: z.string().trim().min(1).max(120),
    addressLine1: z.string().trim().min(1).max(180),
    addressLine2: optionalText,
    city: z.string().trim().min(1).max(100),
    postcode: z.string().trim().min(2).max(12),
    propertyType: z.enum(["house", "flat", "hmo", "other"]).default("house"),
    status: z.enum(["active", "vacant", "maintenance"]).default("active"),
    bedrooms: z.number().int().min(0).max(100).default(0),
    bathrooms: z.number().int().min(0).max(100).default(0),
    acquisitionDate: isoDate,
    purchasePricePence: money.default(0),
    rentInputFrequency: z.enum(["monthly", "yearly"]).default("yearly"),
    monthlyRentPence: requiredMoney,
    annualRentPence: requiredMoney,
    tenancyStartDate: z.iso.date(),
    tenancyEndDate: z.iso.date(),
    rentCollectionDay: z.number().int().min(1).max(31),
    imageDocumentId: optionalId,
    amenities: z.array(z.string().trim().max(80)).max(50).default([]),
    notes: optionalText,
  });
const property = propertyBase
  .refine((value) => value.tenancyEndDate >= value.tenancyStartDate, {
    message: "The tenancy end date must be on or after its start date.",
    path: ["tenancyEndDate"],
  });

const tenant = z.object({
  propertyId: id,
  ...rentalYearLink,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email(),
  phone: optionalText,
  dateOfBirth: isoDate,
  university: z.string().trim().max(100).optional().default(""),
  course: optionalText,
  studentId: optionalText,
  emergencyContactName: optionalText,
  emergencyContactPhone: optionalText,
  room: optionalText,
  monthlyRentPence: requiredMoney,
  rentFrequency: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
  depositPence: money.default(0),
  depositBankReference: optionalText,
  depositStatus: z
    .enum(["not_received", "received", "protected", "returned"])
    .default("not_received"),
  notes: optionalText,
});

const guarantor = z.object({
  tenantId: id,
  ...rentalYearLink,
  name: z.string().trim().min(1).max(160),
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: optionalText,
  address: optionalText,
  relationship: optionalText,
  status: z.enum(["pending", "approved", "declined"]).default("pending"),
  notes: optionalText,
});
const reference = z.object({
  tenantId: id,
  ...rentalYearLink,
  refereeName: z.string().trim().min(1).max(160),
  organisation: optionalText,
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: optionalText,
  type: z
    .enum(["landlord", "employer", "academic", "personal", "other"])
    .default("landlord"),
  status: z
    .enum(["requested", "received", "approved", "declined"])
    .default("requested"),
  notes: optionalText,
});
const tenancy = z.object({
  propertyId: id,
  ...rentalYearLink,
  tenantIds: z.array(id).min(1).max(20),
  room: optionalText,
  startDate: z.iso.date(),
  endDate: isoDate,
  rentPence: money.default(0),
  rentFrequency: z.enum(["weekly", "monthly", "quarterly"]).default("monthly"),
  depositPence: money.default(0),
  depositReference: optionalText,
  status: z.enum(["draft", "active", "ended"]).default("active"),
  notes: optionalText,
});
const rentPaymentBase = z.object({
  propertyId: id,
  ...rentalYearLink,
  tenancyId: optionalId,
  tenantId: id,
  dueDate: z.iso.date(),
  paidDate: z.iso.date(),
  appliesToMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  amountDuePence: money,
  amountPaidPence: money.default(0),
  method: z
    .enum(["bank_transfer", "cash", "other"])
    .default("bank_transfer"),
  rentFrequency: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
  bankReference: optionalText,
  status: z
    .enum(["due", "partial", "paid", "late", "waived", "adjusted", "in_advance"])
    .default("due"),
  advancePaymentId: id.optional(),
  advanceSequence: z.number().int().min(0).max(23).optional(),
  advanceAdditionalMonths: z.number().int().min(1).max(23).optional(),
  advanceCoveredFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  advanceCoveredTo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  notes: optionalText,
});
const requireAdjustedRentNotes = (
  value: { status?: string; notes?: string },
  context: z.RefinementCtx,
) => {
  if (value.status === "adjusted" && !value.notes) {
    context.addIssue({
      code: "custom",
      path: ["notes"],
      message: "Explain why this rent entry was adjusted.",
    });
  }
};
const rentPayment = rentPaymentBase.superRefine(requireAdjustedRentNotes);
export const advanceRentPaymentInput = z.object({
  propertyId: id,
  tenantId: id,
  tenancyId: optionalId,
  rentalYearId: optionalId,
  paidDate: z.iso.date(),
  additionalMonths: z.number().int().min(1).max(48),
  method: z.enum(["bank_transfer", "cash", "other"]).default("bank_transfer"),
  rentFrequency: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
  bankReference: optionalText,
  notes: optionalText,
});
export const advanceRentPaymentUpdateInput = advanceRentPaymentInput.pick({
  paidDate: true,
  method: true,
  rentFrequency: true,
  bankReference: true,
  notes: true,
});
const expense = z.object({
  propertyId: id,
  ...rentalYearLink,
  category: z
    .enum([
      "mortgage",
      "maintenance",
      "utilities",
      "insurance",
      "tax",
      "management",
      "furnishing",
      "other",
    ])
    .default("maintenance"),
  supplier: optionalText,
  amountPence: money,
  expenseDate: z.iso.date(),
  recurring: z.boolean().default(false),
  description: z.string().trim().min(1).max(500),
  documentId: optionalId,
});
const compliance = z.object({
  propertyId: id,
  ...rentalYearLink,
  category: z.enum([
    "epc",
    "boiler",
    "gas_safety",
    "eicr",
    "insurance",
    "hmo_licence",
    "fire_safety",
    "other",
  ]),
  title: z.string().trim().min(1).max(160),
  provider: optionalText,
  reference: optionalText,
  issueDate: isoDate,
  expiryDate: isoDate,
  status: z
    .enum(["valid", "due_soon", "expired", "not_required"])
    .default("valid"),
  reminderEnabled: z.boolean().default(true),
  reminderOffsetsDays: z
    .array(z.number().int().min(0).max(365))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length, "Reminder days must be unique.")
    .default([30, 7, 1]),
  notes: optionalText,
});
const document = z.object({
  propertyId: optionalId,
  tenantId: optionalId,
  ...rentalYearLink,
  category: z.string().trim().min(1).max(80),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  size: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
  blobName: z.string().trim().min(1).max(1024),
});
const rentalYear = z.object({
  propertyId: id,
  label: z.string().trim().min(1).max(80),
  startDate: isoDate,
  endDate: isoDate,
  annualRentPence: requiredMoney,
  status: z.enum(["current", "closed", "restored"]),
  propertySnapshot: z.record(z.string(), z.unknown()).optional(),
  notes: optionalText,
});

export const schemas: Record<RecordKind, z.ZodTypeAny> = {
  property,
  tenant,
  guarantor,
  reference,
  tenancy,
  rentPayment,
  expense,
  compliance,
  document,
  rentalYear,
};

export function isRecordKind(value: string | undefined): value is RecordKind {
  return !!value && recordKinds.includes(value as RecordKind);
}

export function validateRecord(
  kind: RecordKind,
  value: unknown,
  partial = false,
): Record<string, unknown> {
  const base = schemas[kind] as z.ZodObject<z.ZodRawShape>;
  const schema = !partial
    ? base
    : kind === "property"
      ? propertyBase.partial().refine(
          (value) =>
            !value.tenancyStartDate ||
            !value.tenancyEndDate ||
            value.tenancyEndDate >= value.tenancyStartDate,
          {
            message: "The tenancy end date must be on or after its start date.",
            path: ["tenancyEndDate"],
          },
        )
      : kind === "rentPayment"
        ? rentPaymentBase.partial().superRefine(requireAdjustedRentNotes)
        : base.partial();
  const parsed = schema.parse(value) as Record<string, unknown>;
  if (!partial || !value || typeof value !== "object" || Array.isArray(value)) return parsed;
  const submitted = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(submitted)
      .filter((key) => Object.hasOwn(parsed, key))
      .map((key) => [key, parsed[key]]),
  );
}
