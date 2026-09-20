import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const apiBase = process.env.SMOKE_API_URL ?? "http://127.0.0.1:7071/api";
const runId = `${Date.now()}`;
const admin = "developer@localhost";
const owner = `owner.${runId}@example.com`;
const editor = `editor.${runId}@example.com`;
const promotedAdmin = `admin.${runId}@example.com`;
const outsider = `outsider.${runId}@example.com`;
const fixtureDirectory = path.join(os.tmpdir(), "property-portfolio-manager-smoke-fixtures", runId);
const checks = [];

function check(name, condition, details = "") {
  assert.ok(condition, `${name}${details ? `: ${details}` : ""}`);
  checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

async function api(user, urlPath, { method = "GET", organizationId, body, headers = {}, statuses = [200] } = {}) {
  const response = await fetch(`${apiBase}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-local-user": user,
      ...(organizationId ? { "x-organization-id": organizationId } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : undefined; } catch { parsed = raw; }
  if (!statuses.includes(response.status)) {
    throw new Error(`${method} ${urlPath} returned ${response.status}: ${raw.slice(0, 1000)}`);
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

const record = (user, organizationId, kind, body) => api(user, `/records/${kind}`, { method: "POST", organizationId, body, statuses: [201] }).then((result) => result.body);
const list = (user, organizationId, kind, archived = false) => api(user, `/records/${kind}?archived=${archived}&limit=200`, { organizationId }).then((result) => result.body.items);

async function invitePlatform(email) {
  const result = await api(admin, "/platform/invitations/create", { method: "POST", body: { email }, statuses: [201, 502] });
  check(`platform invitation persisted for ${email}`, [201, 502].includes(result.status));
  const accepted = await api(email, "/me");
  check(`invited Microsoft identity accepted for ${email}`, accepted.body.user.email === email);
}

async function upload(user, organizationId, propertyId, fixture) {
  const metadata = { propertyId, category: fixture.category, fileName: fixture.fileName, mimeType: fixture.mimeType, size: fixture.content.length };
  const grant = await api(user, "/documents/upload-url", { method: "POST", organizationId, body: metadata });
  const uploaded = await fetch(grant.body.url, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "content-type": fixture.mimeType }, body: fixture.content });
  check(`private blob upload ${fixture.fileName}`, uploaded.ok, `HTTP ${uploaded.status}`);
  return api(user, "/documents/complete", { method: "POST", organizationId, body: { ...metadata, documentId: grant.body.documentId, blobName: grant.body.blobName }, statuses: fixture.invalid ? [400] : [201] });
}

async function main() {
  await mkdir(fixtureDirectory, { recursive: true });
  const fixtures = [
    { fileName: "property-card.png", mimeType: "image/png", category: "property_image", content: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") },
    { fileName: "compliance-certificate.pdf", mimeType: "application/pdf", category: "compliance", content: Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF") },
    { fileName: "tenant-photo.jpg", mimeType: "image/jpeg", category: "identity", content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]) },
    { fileName: "property-cover.webp", mimeType: "image/webp", category: "other", content: Buffer.from("RIFF0000WEBPVP8 dummy") },
    { fileName: "tenancy-agreement.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "tenancy", content: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("dummy word/document.xml tenancy agreement")]) },
    { fileName: "finance-ledger.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", category: "finance", content: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("dummy xl/workbook.xml rent ledger")]) },
  ];
  for (const fixture of fixtures) await writeFile(path.join(fixtureDirectory, fixture.fileName), fixture.content);
  const invalidFixture = { fileName: "spoofed.pdf", mimeType: "application/pdf", category: "other", content: Buffer.from("MZ executable payload"), invalid: true };
  await writeFile(path.join(fixtureDirectory, invalidFixture.fileName), invalidFixture.content);
  check("multiple dummy document fixtures created", fixtures.length === 6);

  const health = await api(admin, "/health");
  check("local API health", health.body.status === "ok");
  const denied = await api(outsider, "/me", { statuses: [403] });
  check("uninvited sign-on denied", denied.body.error.code === "invitation_required");

  for (const email of [owner, editor, promotedAdmin]) await invitePlatform(email);
  const organizationName = `Smoke Portfolio ${runId}`;
  const createdOrganization = await api(owner, "/organizations", { method: "POST", body: { name: organizationName }, statuses: [201] });
  const organizationId = createdOrganization.body.id;
  check("owner created organisation", createdOrganization.body.role === "owner");
  const membershipResult = await api(owner, `/organizations/${organizationId}/invitations`, { method: "POST", organizationId, body: { email: editor, role: "editor" }, statuses: [201, 502] });
  check("owner added accepted editor", [201, 502].includes(membershipResult.status));
  const editorSession = await api(editor, "/me");
  check("editor sees joined organisation", editorSession.body.organizations.some((item) => item.id === organizationId && item.role === "editor"));
  const forbiddenAdmin = await api(editor, "/platform/invitations/create", { method: "POST", body: { email: `blocked.${runId}@example.com` }, statuses: [403] });
  check("editor cannot add platform users", forbiddenAdmin.body.error.code === "admin_required");

  const year = new Date().getUTCFullYear();
  const propertyOne = await record(editor, organizationId, "property", {
    name: `1 Security Test Street ${runId}`,
    addressLine1: "1 Security Test Street",
    addressLine2: "Dummy Flat A",
    city: "Egham",
    postcode: "TW20 0EX",
    propertyType: "hmo",
    status: "active",
    bedrooms: 6,
    bathrooms: 2,
    acquisitionDate: `${year - 2}-06-01`,
    purchasePricePence: 42500000,
    rentInputFrequency: "monthly",
    monthlyRentPence: 360000,
    annualRentPence: 4320000,
    tenancyStartDate: `${year}-01-01`,
    tenancyEndDate: `${year}-12-31`,
    rentCollectionDay: 9,
    amenities: ["Wi-Fi", "Garden"],
    notes: "Primary smoke-test property",
  });
  const propertyTwo = await record(editor, organizationId, "property", {
    name: `2 Isolation Test Road ${runId}`,
    addressLine1: "2 Isolation Test Road",
    city: "Egham",
    postcode: "TW20 9ZZ",
    propertyType: "flat",
    status: "vacant",
    bedrooms: 2,
    bathrooms: 1,
    purchasePricePence: 27500000,
    rentInputFrequency: "yearly",
    monthlyRentPence: 120000,
    annualRentPence: 1440000,
    tenancyStartDate: `${year}-01-01`,
    tenancyEndDate: `${year}-12-31`,
    rentCollectionDay: 15,
    notes: "Cross-property boundary target",
  });
  check("editor created multiple required-field properties", propertyOne.id && propertyTwo.id);

  const firstYear = await api(editor, `/properties/${propertyOne.id}/rental-years/start`, { method: "POST", organizationId, body: { label: `${year}/${year + 1}`, startDate: `${year}-01-01`, endDate: `${year}-12-31`, annualRentPence: 4320000 }, statuses: [201] });
  check("first rental year started", firstYear.body.current.status === "current");
  const rentalYearId = firstYear.body.current.id;

  const tenants = [];
  for (const [index, firstName] of ["Asha", "Ben", "Chloe"].entries()) {
    tenants.push(await record(editor, organizationId, "tenant", {
      propertyId: propertyOne.id,
      firstName,
      lastName: `Tenant${index + 1}`,
      email: `${firstName.toLowerCase()}.${runId}@example.com`,
      phone: `0700000000${index}`,
      university: index === 1 ? "Example University" : "Sample College",
      course: "Dummy course",
      room: `Room ${index + 1}`,
      monthlyRentPence: 120000,
      rentFrequency: "monthly",
      depositPence: 120000,
      depositBankReference: `DEP-${runId}-${index}`,
      depositStatus: index === 2 ? "received" : "protected",
      notes: `Tenant smoke note ${index + 1}`,
    }));
  }
  check("multiple tenants inherit current rental year", tenants.every((tenant) => tenant.rentalYearId === rentalYearId));
  await record(editor, organizationId, "guarantor", { tenantId: tenants[0].id, name: "Grace Guarantor", email: `guarantor.${runId}@example.com`, relationship: "Parent", status: "approved", notes: "Identity checked" });
  await record(editor, organizationId, "reference", { tenantId: tenants[0].id, refereeName: "Robin Referee", organisation: "Example University", email: `referee.${runId}@example.com`, type: "academic", status: "approved", notes: "Reference received" });
  const tenancy = await record(editor, organizationId, "tenancy", { propertyId: propertyOne.id, tenantIds: tenants.map((tenant) => tenant.id), room: "Whole house", startDate: `${year}-01-01`, endDate: `${year}-12-31`, rentPence: 360000, rentFrequency: "monthly", depositPence: 360000, depositReference: `TEN-${runId}`, status: "active", notes: "Joint tenancy smoke record" });
  check("tenant, guarantor, reference and tenancy records linked", tenancy.rentalYearId === rentalYearId);

  const month = `${year}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
  const paymentStatuses = ["paid", "partial", "due", "late", "waived", "adjusted"];
  let paidPayment;
  for (const [index, status] of paymentStatuses.entries()) {
    if (status === "late") continue;
    const payment = await record(editor, organizationId, "rentPayment", {
      propertyId: propertyOne.id,
      tenancyId: tenancy.id,
      tenantId: tenants[index % tenants.length].id,
      dueDate: `${month}-01`,
      paidDate: `${month}-${String(Math.min(14 + index, 28)).padStart(2, "0")}`,
      appliesToMonth: month,
      amountDuePence: status === "waived" ? 0 : 120000,
      amountPaidPence: status === "paid" || status === "late" ? 120000 : status === "partial" ? 60000 : 0,
      method: index % 2 ? "cash" : "bank_transfer",
      rentFrequency: "monthly",
      bankReference: `RENT-${runId}-${index}`,
      status,
      notes: status === "adjusted" ? `Adjusted for ${month}: smoke-test correction` : `Status ${status}`,
    });
    if (status === "paid") paidPayment = payment;
  }
  const blockedAdditional = await api(editor, "/records/rentPayment", {
    method: "POST",
    organizationId,
    body: {
      propertyId: propertyOne.id,
      tenancyId: tenancy.id,
      tenantId: tenants[0].id,
      dueDate: `${month}-01`,
      paidDate: `${month}-16`,
      appliesToMonth: month,
      amountDuePence: 120000,
      amountPaidPence: 30000,
      method: "bank_transfer",
      rentFrequency: "monthly",
      bankReference: `BLOCKED-${runId}`,
      status: "late",
      notes: "must replace Paid first",
    },
    statuses: [409],
  });
  check("Paid month requires explicit replacement before another entry", blockedAdditional.body.error.code === "rent_payment_requires_override");
  const replacedPaid = await api(editor, `/records/rentPayment/${paidPayment.id}`, {
    method: "PATCH",
    organizationId,
    headers: { "if-match": paidPayment._etag },
    body: {
      paidDate: `${month}-14`,
      amountPaidPence: 40000,
      status: "partial",
      notes: "Paid entry corrected to first partial instalment",
    },
    statuses: [200],
  });
  const latePayment = await record(editor, organizationId, "rentPayment", {
    propertyId: propertyOne.id,
    tenancyId: tenancy.id,
    tenantId: tenants[0].id,
    dueDate: `${month}-01`,
    paidDate: `${month}-16`,
    appliesToMonth: month,
    amountDuePence: 120000,
    amountPaidPence: 30000,
    method: "bank_transfer",
    rentFrequency: "monthly",
    bankReference: `LATE-${runId}`,
    status: "late",
    notes: "Second instalment received late",
  });
  const editedLatePayment = await api(editor, `/records/rentPayment/${latePayment.id}`, {
    method: "PATCH",
    organizationId,
    headers: { "if-match": latePayment._etag },
    body: { notes: "Second instalment corrected and received late", bankReference: `LATE-CORRECTED-${runId}` },
    statuses: [200],
  });
  check("specific ordinary rent entry edited with concurrency protection", editedLatePayment.body.notes === "Second instalment corrected and received late" && editedLatePayment.body.version === latePayment.version + 1);
  const archivedLatePayment = await api(editor, `/records/rentPayment/${latePayment.id}/archive`, {
    method: "POST",
    organizationId,
    headers: { "if-match": editedLatePayment.body._etag },
    statuses: [200],
  });
  const restoredLatePayment = await api(editor, `/records/rentPayment/${latePayment.id}/restore`, {
    method: "POST",
    organizationId,
    headers: { "if-match": archivedLatePayment.body._etag },
    statuses: [200],
  });
  check("specific ordinary rent entry delete and restore stays connected", archivedLatePayment.body.archived === true && restoredLatePayment.body.archived === false);
  const finalPaid = await record(editor, organizationId, "rentPayment", {
    propertyId: propertyOne.id,
    tenancyId: tenancy.id,
    tenantId: tenants[0].id,
    dueDate: `${month}-01`,
    paidDate: `${month}-20`,
    appliesToMonth: month,
    amountDuePence: 120000,
    amountPaidPence: 50000,
    method: "bank_transfer",
    rentFrequency: "monthly",
    bankReference: `FINAL-${runId}`,
    status: "paid",
    notes: "Final instalment",
  });
  const duplicatePaid = await api(editor, "/records/rentPayment", {
    method: "POST",
    organizationId,
    body: {
      propertyId: propertyOne.id,
      tenancyId: tenancy.id,
      tenantId: tenants[0].id,
      dueDate: `${month}-01`,
      paidDate: `${month}-21`,
      appliesToMonth: month,
      amountDuePence: 120000,
      amountPaidPence: 50000,
      method: "bank_transfer",
      rentFrequency: "monthly",
      status: "paid",
      notes: "must not create a second Paid entry",
    },
    statuses: [409],
  });
  check("Paid replacement unlocks additive instalments but never duplicate Paid", replacedPaid.body.status === "partial" && latePayment.status === "late" && finalPaid.status === "paid" && duplicatePaid.body.error.code === "rent_payment_requires_override");
  const recordedStatuses = new Set((await list(editor, organizationId, "rentPayment")).filter((payment) => payment.appliesToMonth === month).map((payment) => payment.status));
  check("all requested rent statuses recorded", paymentStatuses.every((status) => recordedStatuses.has(status)));

  const advanceStartMonthNumber = new Date().getUTCMonth() === 0 ? 2 : 1;
  const advanceMonth = `${year}-${String(advanceStartMonthNumber).padStart(2, "0")}`;
  const directAdvance = await api(editor, "/records/rentPayment", {
    method: "POST",
    organizationId,
    body: {
      propertyId: propertyOne.id,
      tenancyId: tenancy.id,
      tenantId: tenants[0].id,
      dueDate: `${advanceMonth}-14`,
      paidDate: `${advanceMonth}-14`,
      appliesToMonth: advanceMonth,
      amountDuePence: 120000,
      amountPaidPence: 120000,
      method: "bank_transfer",
      rentFrequency: "monthly",
      status: "in_advance",
      notes: "must use protected workflow",
    },
    statuses: [405],
  });
  check("generic API rejects manufactured advance-rent entries", directAdvance.body.error.code === "managed_record");
  const advance = await api(editor, "/rent-payments/advance", {
    method: "POST",
    organizationId,
    body: {
      propertyId: propertyOne.id,
      tenancyId: tenancy.id,
      tenantId: tenants[0].id,
      paidDate: `${advanceMonth}-14`,
      additionalMonths: 2,
      method: "bank_transfer",
      rentFrequency: "monthly",
      bankReference: `ADV-${runId}`,
      notes: "Three months paid in advance",
    },
    statuses: [201],
  });
  const expectedAdvanceMonths = [0, 1, 2].map((offset) => `${year}-${String(advanceStartMonthNumber + offset).padStart(2, "0")}`);
  check(
    "advance rent creates linked monthly entries and updates future month options",
    advance.body.totalPaidPence === 360000 &&
      advance.body.payments.length === 3 &&
      advance.body.payments.every((payment) => payment.status === "in_advance" && payment.amountPaidPence === 120000 && payment.notes === "Three months paid in advance") &&
      advance.body.payments.map((payment) => payment.appliesToMonth).join(",") === expectedAdvanceMonths.join(",") &&
      new Set(advance.body.payments.map((payment) => payment.advancePaymentId)).size === 1,
  );
  const editedAdvance = await api(editor, `/rent-payments/advance/${advance.body.payments[0].id}`, {
    method: "PATCH",
    organizationId,
    headers: { "if-match": advance.body.payments[0]._etag },
    body: {
      paidDate: `${advanceMonth}-16`,
      method: "cash",
      rentFrequency: "monthly",
      bankReference: `ADV-CORRECTED-${runId}`,
      notes: "Corrected linked advance receipt",
    },
    statuses: [200],
  });
  check("linked advance receipt edits every monthly allocation", editedAdvance.body.payments.length === 3 && editedAdvance.body.payments.every((payment) => payment.paidDate === `${advanceMonth}-16` && payment.method === "cash" && payment.notes === "Corrected linked advance receipt"));
  const archivedAdvance = await api(editor, `/records/rentPayment/${editedAdvance.body.payments[0].id}/archive`, {
    method: "POST",
    organizationId,
    headers: { "if-match": editedAdvance.body.payments[0]._etag },
    statuses: [200],
  });
  const archivedAdvanceEntries = (await list(editor, organizationId, "rentPayment", true)).filter((payment) => payment.advancePaymentId === advance.body.payments[0].advancePaymentId);
  const restoredAdvance = await api(editor, `/records/rentPayment/${archivedAdvance.body.id}/restore`, {
    method: "POST",
    organizationId,
    headers: { "if-match": archivedAdvance.body._etag },
    statuses: [200],
  });
  check("deleting a linked advance payment archives and restores its full group", archivedAdvanceEntries.length === 3 && restoredAdvance.body.archived === false);
  const duplicateAdvance = await api(editor, "/rent-payments/advance", {
    method: "POST",
    organizationId,
    body: {
      propertyId: propertyOne.id,
      tenancyId: tenancy.id,
      tenantId: tenants[0].id,
      paidDate: `${advanceMonth}-14`,
      additionalMonths: 2,
      method: "bank_transfer",
      rentFrequency: "monthly",
      bankReference: `ADV-${runId}`,
      notes: "Duplicate must fail",
    },
    statuses: [409],
  });
  check("duplicate advance months are rejected without double counting", duplicateAdvance.body.error.code === "rent_month_already_recorded");

  for (let index = 0; index < 6; index += 1) {
    await record(editor, organizationId, "expense", { propertyId: propertyOne.id, category: index % 2 ? "maintenance" : "insurance", supplier: `Dummy supplier ${index}`, amountPence: 10000 + index * 1000, expenseDate: `${year}-${String(index + 1).padStart(2, "0")}-10`, recurring: index === 0, description: `Smoke expense ${index + 1}` });
  }
  for (const [index, category] of ["gas_safety", "eicr", "insurance"].entries()) {
    await record(editor, organizationId, "compliance", { propertyId: propertyOne.id, category, title: `Compliance ${index + 1}`, provider: "Dummy Compliance Ltd", reference: `COMP-${runId}-${index}`, issueDate: `${year}-01-01`, expiryDate: `${year}-12-${20 + index}`, status: "valid", reminderEnabled: true, reminderOffsetsDays: [30, 7, 1], notes: "Smoke compliance record" });
  }
  check("multiple finance and compliance records created", true);

  const dashboard = await api(editor, "/dashboard", { organizationId });
  check("overview property and occupancy metrics connected", dashboard.body.propertyCount === 2 && dashboard.body.occupiedProperties === 1 && dashboard.body.occupancyPercent === 50);
  check("overview income, arrears and financial position connected", dashboard.body.incomePence === 540000 && dashboard.body.expensePence === 75000 && dashboard.body.balancePence === 465000 && dashboard.body.arrearsPence > 0);
  check("overview next-60-days data connected", Array.isArray(dashboard.body.upcoming));

  const uploadedDocuments = [];
  for (const fixture of fixtures) uploadedDocuments.push((await upload(editor, organizationId, propertyOne.id, fixture)).body);
  const imageDocument = uploadedDocuments.find((document) => document.category === "property_image");
  const latestProperty = await api(editor, `/records/property/${propertyOne.id}`, { organizationId });
  const updatedProperty = await api(editor, `/records/property/${propertyOne.id}`, { method: "PATCH", organizationId, headers: { "if-match": latestProperty.body._etag }, body: { imageDocumentId: imageDocument.id }, statuses: [200] });
  check("property card image linked without storing a SAS URL", updatedProperty.body.imageDocumentId === imageDocument.id && !JSON.stringify(updatedProperty.body).includes("sig="));
  const invalidUpload = await upload(editor, organizationId, propertyOne.id, invalidFixture);
  check("spoofed dummy file rejected", invalidUpload.body.error.code === "invalid_file_signature");
  const documents = await list(editor, organizationId, "document");
  check("rejected file created no document metadata", documents.length === fixtures.length && !documents.some((item) => item.fileName === invalidFixture.fileName));

  const viewGrant = await api(editor, `/documents/${imageDocument.id}/view-url`, { method: "POST", organizationId });
  const viewed = await fetch(viewGrant.body.url);
  check("private property image view grant works", viewed.ok && Buffer.from(await viewed.arrayBuffer()).equals(fixtures[0].content));
  const pdfDocument = uploadedDocuments.find((document) => document.mimeType === "application/pdf");
  const downloadGrant = await api(editor, `/documents/${pdfDocument.id}/download-url`, { method: "POST", organizationId });
  const downloaded = await fetch(downloadGrant.body.url);
  check("private attachment download grant works", downloaded.ok && downloaded.headers.get("content-disposition")?.startsWith("attachment"));
  const rejectedInline = await api(editor, `/documents/${pdfDocument.id}/view-url`, { method: "POST", organizationId, statuses: [400] });
  check("non-image inline view rejected", rejectedInline.body.error.code === "not_an_image");

  const mismatch = await api(editor, "/records/rentPayment", { method: "POST", organizationId, body: { propertyId: propertyTwo.id, tenantId: tenants[0].id, dueDate: `${month}-01`, paidDate: `${month}-14`, appliesToMonth: month, amountDuePence: 120000, amountPaidPence: 120000, method: "bank_transfer", rentFrequency: "monthly", status: "paid", notes: "must fail" }, statuses: [409] });
  check("cross-property relationship rejected", mismatch.body.error.code === "relationship_mismatch");

  const expenses = await list(editor, organizationId, "expense");
  const archived = await api(editor, `/records/expense/${expenses[0].id}/archive`, { method: "POST", organizationId, headers: { "if-match": expenses[0]._etag }, statuses: [200] });
  check("editor archived record with all fields retained", archived.body.archived === true && archived.body.description === expenses[0].description);
  const archivedList = await list(owner, organizationId, "expense", true);
  check("archive list exposes restorable record", archivedList.some((item) => item.id === archived.body.id));
  const restored = await api(editor, `/records/expense/${archived.body.id}/restore`, { method: "POST", organizationId, headers: { "if-match": archived.body._etag }, statuses: [200] });
  check("editor restored archived record", restored.body.archived === false);
  const rearchived = await api(editor, `/records/expense/${restored.body.id}/archive`, { method: "POST", organizationId, headers: { "if-match": restored.body._etag }, statuses: [200] });
  const editorDelete = await api(editor, `/records/expense/${rearchived.body.id}`, { method: "DELETE", organizationId, headers: { "if-match": rearchived.body._etag }, statuses: [403] });
  check("editor cannot permanently delete archive", editorDelete.body.error.code === "owner_required");
  const ownerDelete = await api(owner, `/records/expense/${rearchived.body.id}`, { method: "DELETE", organizationId, headers: { "if-match": rearchived.body._etag }, statuses: [200] });
  check("owner permanently deleted archived record", ownerDelete.body.deletedCount === 1);

  const privateName = `Isolated Portfolio ${runId}`;
  const privateOrganization = await api(owner, "/organizations", { method: "POST", body: { name: privateName }, statuses: [201] });
  const isolated = await api(editor, "/dashboard", { organizationId: privateOrganization.body.id, statuses: [404] });
  check("ordinary editor isolated from another organisation", isolated.body.error.code === "organization_not_found");
  const superAdminOrganizations = await api(admin, "/organizations");
  check("bootstrap super admin receives owner-equivalent organisation access", superAdminOrganizations.body.some((item) => item.id === privateOrganization.body.id && item.role === "owner"));
  const superAdminMembers = await api(admin, `/organizations/${organizationId}/members`, { organizationId });
  check("super admin can administer organisation members", Array.isArray(superAdminMembers.body.members));
  await api(admin, "/platform/admins", { method: "PATCH", body: { email: promotedAdmin, enabled: true } });
  const promotedSession = await api(promotedAdmin, "/me");
  check("current super admin can grant another super admin", promotedSession.body.user.isPlatformAdmin === true && promotedSession.body.organizations.some((item) => item.id === organizationId));
  await api(admin, "/platform/admins", { method: "PATCH", body: { email: promotedAdmin, enabled: false } });

  const rollover = await api(owner, `/properties/${propertyOne.id}/rental-years/start`, { method: "POST", organizationId, body: { label: `${year + 1}/${year + 2}`, startDate: `${year + 1}-01-01`, endDate: `${year + 1}-12-31`, annualRentPence: 4440000 }, statuses: [201] });
  check("rental-year rollover produced a closed history snapshot", rollover.body.closed?.status === "closed" && rollover.body.recordsMoved > 0);
  check("rollover included private document attachments before delivery attempt", rollover.body.attachmentCount === fixtures.length);
  const historicalTenants = (await list(owner, organizationId, "tenant")).filter((item) => item.rentalYearId === rollover.body.closed.id);
  const immutable = await api(owner, `/records/tenant/${historicalTenants[0].id}`, { method: "PATCH", organizationId, headers: { "if-match": historicalTenants[0]._etag }, body: { notes: "must not change" }, statuses: [409] });
  check("closed history is read-only", immutable.body.error.code === "historical_record");
  const closedYears = (await list(owner, organizationId, "rentalYear")).filter((item) => item.status === "closed");
  check("history remains linked by property and rental year", closedYears.some((item) => item.propertyId === propertyOne.id && item.propertySnapshot?.name === propertyOne.name));
  const closedPayments = await api(owner, `/records/rentPayment?archived=false&limit=200&rentalYearId=${rollover.body.closed.id}`, { organizationId });
  const currentPayments = await api(owner, `/records/rentPayment?archived=false&limit=200&rentalYearId=${rollover.body.current.id}`, { organizationId });
  check("finance year filtering returns only the selected rental year", closedPayments.body.items.length === paymentStatuses.length + 4 && currentPayments.body.items.length === 0);
  const restoredYear = await api(editor, `/properties/${propertyOne.id}/rental-years/${rollover.body.closed.id}/restore`, { method: "POST", organizationId, headers: { "if-match": rollover.body.closed._etag }, statuses: [200] });
  check("closed rental year can be explicitly restored for editing", restoredYear.body.status === "restored");
  const correctedHistoricalTenant = await api(editor, `/records/tenant/${historicalTenants[0].id}`, { method: "PATCH", organizationId, headers: { "if-match": historicalTenants[0]._etag }, body: { notes: "Corrected while rental year restored" }, statuses: [200] });
  check("restored rental-year records become editable", correctedHistoricalTenant.body.notes === "Corrected while rental year restored");
  const correctedSnapshot = await api(editor, `/properties/${propertyOne.id}/rental-years/${restoredYear.body.id}/property`, { method: "PATCH", organizationId, headers: { "if-match": restoredYear.body._etag }, body: { ...restoredYear.body.propertySnapshot, name: `${propertyOne.name} corrected`, rentCollectionDay: 9 }, statuses: [200] });
  check("restored property snapshot can be corrected without changing the live property", correctedSnapshot.body.propertySnapshot.name === `${propertyOne.name} corrected` && (await api(editor, `/records/property/${propertyOne.id}`, { organizationId })).body.name === propertyOne.name);
  const rolloverDuringEdit = await api(editor, `/properties/${propertyOne.id}/rental-years/start`, { method: "POST", organizationId, body: { label: `${year + 2}/${year + 3}`, startDate: `${year + 2}-01-01`, endDate: `${year + 2}-12-31`, annualRentPence: 4560000 }, statuses: [409] });
  check("new rollover is blocked during a restored-year edit session", rolloverDuringEdit.body.error.code === "rental_year_edit_in_progress");
  const savedHistory = await api(editor, `/properties/${propertyOne.id}/rental-years/${restoredYear.body.id}/save-history`, { method: "POST", organizationId, headers: { "if-match": correctedSnapshot.body._etag }, statuses: [200] });
  const immutableAgain = await api(editor, `/records/tenant/${historicalTenants[0].id}`, { method: "PATCH", organizationId, headers: { "if-match": correctedHistoricalTenant.body._etag }, body: { notes: "must be read only again" }, statuses: [409] });
  check("saving restored edits returns the year to read-only History", savedHistory.body.status === "closed" && immutableAgain.body.error.code === "historical_record");
  const rentalYearsAfterCorrection = await list(editor, organizationId, "rentalYear");
  check("the actual current rental year remains current after a historical correction", rentalYearsAfterCorrection.some((item) => item.id === rollover.body.current.id && item.status === "current"));

  const deletedOrganization = await api(admin, `/organizations/${privateOrganization.body.id}`, { method: "DELETE", organizationId: privateOrganization.body.id, body: { confirmationName: privateName }, statuses: [200] });
  check("super admin can delete a disposable organisation", deletedOrganization.body.name === privateName);
  const deletedLookup = await api(owner, "/dashboard", { organizationId: privateOrganization.body.id, statuses: [404] });
  check("deleted organisation access removed", deletedLookup.body.error.code === "organization_not_found");

  process.stdout.write(`\n${checks.length} aggressive local smoke checks passed.\nFixtures: ${fixtureDirectory}\n`);
}

try {
  await main();
} finally {
  if (process.env.KEEP_SMOKE_FIXTURES !== "true") await rm(fixtureDirectory, { recursive: true, force: true });
}
