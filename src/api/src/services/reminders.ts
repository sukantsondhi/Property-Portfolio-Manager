import { EmailClient } from "@azure/communication-email";
import type { PortfolioRecord } from "../domain/types";

const MS_PER_DAY = 86_400_000;
export class ReminderNotSentError extends Error {}
export type DueReminder = { record: PortfolioRecord; propertyName: string; daysUntilExpiry: number; offsetDays: number };
export type RentCollectionTenantStatus = {
  tenantId: string;
  tenantName: string;
  status: string;
  amountExpectedPence: number;
  amountReceivedPence: number;
  notes: string[];
  lastRecordedDate?: string;
};
export type RentCollectionReminder = {
  propertyId: string;
  propertyName: string;
  month: string;
  collectionDate: string;
  stage: "initial" | "weekly" | "complete";
  deliveryStage: string;
  weekNumber: number;
  tenants: RentCollectionTenantStatus[];
  allSettled: boolean;
};
const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const paymentMonth = (record: PortfolioRecord) => String(record.appliesToMonth || record.paidDate || record.dueDate || "").slice(0, 7);
const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(value / 100);
const subjectText = (value: unknown) => String(value).replace(/[\r\n]+/g, " ").trim();
const isSettledRentStatus = (status: unknown) => ["paid", "in_advance", "waived", "adjusted"].includes(String(status));

export function findDueReminders(records: PortfolioRecord[], now = new Date()): DueReminder[] {
  const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
  const propertyNames = new Map(records.filter((record) => record.kind === "property").map((record) => [record.id, String(record.name)]));
  return records
    .filter((record) => record.kind === "compliance" && !record.rentalYearId && record.reminderEnabled !== false && typeof record.expiryDate === "string" && record.expiryDate)
    .flatMap((record) => {
      const daysUntilExpiry = Math.ceil((Date.parse(`${record.expiryDate}T00:00:00Z`) - today) / MS_PER_DAY);
      const offsets = [...new Set([...(Array.isArray(record.reminderOffsetsDays) ? record.reminderOffsetsDays.map(Number) : [30, 7, 1]), 0])];
      return offsets.filter((offset) => daysUntilExpiry === offset).map((offsetDays) => ({ record, propertyName: propertyNames.get(String(record.propertyId)) ?? "Unknown property", daysUntilExpiry, offsetDays }));
    })
    .filter((item) => Number.isFinite(item.daysUntilExpiry))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

function collectionDateForMonth(month: string, requestedDay: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(requestedDay, lastDay)).padStart(2, "0")}`;
}

function monthsFromTo(start: string, end: string) {
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  const count = (endYear - startYear) * 12 + endMonth - startMonth;
  return Array.from({ length: Math.max(0, count) + 1 }, (_, offset) => {
    const date = new Date(Date.UTC(startYear, startMonth - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function findDueRentCollectionReminders(records: PortfolioRecord[], now = new Date()): RentCollectionReminder[] {
  const today = isoDay(now);
  const currentMonth = today.slice(0, 7);
  const years = records.filter((record) => record.kind === "rentalYear" && record.status === "current");
  return records
    .filter((property) => property.kind === "property" && Number.isInteger(Number(property.rentCollectionDay)) && Number(property.rentCollectionDay) >= 1 && Number(property.rentCollectionDay) <= 31)
    .flatMap((property): RentCollectionReminder[] => {
      const currentYear = years.find((year) => year.propertyId === property.id);
      const periodStart = String(currentYear?.startDate || property.tenancyStartDate || "").slice(0, 7);
      const periodEnd = String(currentYear?.endDate || property.tenancyEndDate || "").slice(0, 7);
      if ((periodStart && currentMonth < periodStart) || !periodStart) return [];
      const tenants = records.filter((record) => record.kind === "tenant" && record.propertyId === property.id && (!currentYear || record.rentalYearId === currentYear.id));
      if (!tenants.length) return [];
      const lastMonth = periodEnd && periodEnd < currentMonth ? periodEnd : currentMonth;
      return monthsFromTo(periodStart, lastMonth).flatMap((month): RentCollectionReminder[] => {
        const collectionDate = collectionDateForMonth(month, Number(property.rentCollectionDay));
        const daysSinceCollection = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${collectionDate}T00:00:00Z`)) / MS_PER_DAY);
        if (daysSinceCollection < 0) return [];
        const payments = records.filter((record) => record.kind === "rentPayment" && record.propertyId === property.id && paymentMonth(record) === month && (!currentYear || record.rentalYearId === currentYear.id));
        const statuses = tenants.map((tenant): RentCollectionTenantStatus => {
          const tenantPayments = payments
            .filter((payment) => payment.tenantId === tenant.id)
            .sort((a, b) => String(b.paidDate || b.updatedAt).localeCompare(String(a.paidDate || a.updatedAt)));
          const settled = tenantPayments.find((payment) => isSettledRentStatus(payment.status));
          const latest = settled ?? tenantPayments[0];
          return {
            tenantId: tenant.id,
            tenantName: `${String(tenant.firstName || "")} ${String(tenant.lastName || "")}`.trim() || "Unnamed tenant",
            status: String(latest?.status || "due"),
            amountExpectedPence: Number(tenant.monthlyRentPence || 0),
            amountReceivedPence: tenantPayments.reduce((sum, payment) => sum + Number(payment.amountPaidPence || 0), 0),
            notes: [...new Set(tenantPayments.map((payment) => String(payment.notes || "").trim()).filter(Boolean))],
            ...(latest?.paidDate ? { lastRecordedDate: String(latest.paidDate) } : {}),
          };
        });
        const allSettled = statuses.every((status) => isSettledRentStatus(status.status));
        if ((allSettled && month !== currentMonth) || (!allSettled && daysSinceCollection % 7 !== 0)) return [];
        const weekNumber = Math.floor(daysSinceCollection / 7);
        const stage = allSettled ? "complete" : weekNumber === 0 ? "initial" : "weekly";
        return [{
          propertyId: property.id,
          propertyName: String(property.name || "Property"),
          month,
          collectionDate,
          stage,
          deliveryStage: stage === "complete" ? "complete" : weekNumber === 0 ? "initial" : `week-${weekNumber}`,
          weekNumber,
          tenants: statuses,
          allSettled,
        }];
      });
    });
}

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export async function sendReminderEmail(recipient: string, organizationName: string, items: DueReminder[]) {
  const connectionString = process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
  const senderAddress = process.env.REMINDER_SENDER_ADDRESS;
  if (!connectionString || !senderAddress) throw new ReminderNotSentError("Email reminder settings are incomplete.");
  const lines = items.map((item) => `${item.propertyName}: ${String(item.record.title)} is due ${String(item.record.expiryDate)} (${item.offsetDays} days)`);
  const rows = items.map((item) => `<tr><td>${escapeHtml(item.propertyName)}</td><td>${escapeHtml(item.record.title)}</td><td>${escapeHtml(item.record.expiryDate)}</td><td>${item.offsetDays} days</td></tr>`).join("");
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    recipients: { to: [{ address: recipient }] },
    content: {
      subject: `Property Portfolio Manager: ${items.length} reminder${items.length === 1 ? "" : "s"} for ${organizationName}`,
      plainText: `Property reminders for ${organizationName}:\n\n${lines.join("\n")}\n\nOpen Property Portfolio Manager: ${process.env.WEB_URL ?? ""}`,
      html: `<h1>Property reminders</h1><p>These items for <strong>${escapeHtml(organizationName)}</strong> are due.</p><table border="1" cellpadding="8" cellspacing="0"><thead><tr><th>Property</th><th>Item</th><th>Due date</th><th>Reminder</th></tr></thead><tbody>${rows}</tbody></table><p><a href="${escapeHtml(process.env.WEB_URL ?? "")}">Open Property Portfolio Manager</a></p>`,
    },
  });
  const result = await poller.pollUntilDone();
  if (result.status === "Failed" || result.status === "Canceled") throw new ReminderNotSentError("Azure Communication Services did not deliver the compliance reminder.");
  if (result.status !== "Succeeded") throw new Error("Azure Communication Services returned an uncertain compliance reminder status.");
  return result;
}

export function rentCollectionEmail(organizationName: string, item: RentCollectionReminder) {
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${item.month}-01T00:00:00Z`));
  const summary = item.tenants.map((tenant) => `${tenant.tenantName}: ${tenant.status}; received ${money(tenant.amountReceivedPence)} of ${money(tenant.amountExpectedPence)}${tenant.notes.length ? `; notes: ${tenant.notes.join(" | ")}` : ""}`);
  const rows = item.tenants.map((tenant) => `<tr><td>${escapeHtml(tenant.tenantName)}</td><td>${escapeHtml(tenant.status.replace("_", " "))}</td><td>${escapeHtml(money(tenant.amountReceivedPence))}</td><td>${escapeHtml(money(tenant.amountExpectedPence))}</td><td>${tenant.notes.length ? tenant.notes.map(escapeHtml).join("<br>") : "—"}</td></tr>`).join("");
  const heading = item.allSettled
    ? `Rent at ${item.propertyName} is settled for ${monthLabel}`
    : item.stage === "initial"
      ? `Rent collection update for ${item.propertyName}`
      : `Weekly rent follow-up for ${item.propertyName}`;
  const introduction = item.allSettled
    ? `Every tenant is recorded as Paid, In advance, Waived or Adjusted for ${monthLabel}.`
    : `Here is the ${monthLabel} rent position as at this reminder. Weekly follow-ups continue every seven days after ${item.collectionDate} until every tenant is recorded as Paid, In advance, Waived or Adjusted.`;
  return {
    subject: subjectText(`Property Portfolio Manager: ${heading}`),
    plainText: `${heading}\n\nOrganisation: ${organizationName}\nProperty: ${item.propertyName}\nMonth: ${monthLabel}\nCollection date: ${item.collectionDate}\n\n${introduction}\n\n${summary.join("\n")}\n\nOpen Property Portfolio Manager: ${process.env.WEB_URL ?? ""}`,
    html: `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(introduction)}</p><p><strong>Organisation:</strong> ${escapeHtml(organizationName)}<br><strong>Property:</strong> ${escapeHtml(item.propertyName)}<br><strong>Month:</strong> ${escapeHtml(monthLabel)}<br><strong>Collection date:</strong> ${escapeHtml(item.collectionDate)}</p><table border="1" cellpadding="8" cellspacing="0"><thead><tr><th>Tenant</th><th>Status</th><th>Received</th><th>Expected</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table><p><a href="${escapeHtml(process.env.WEB_URL ?? "")}">Open Property Portfolio Manager</a></p>`,
  };
}

export async function sendRentCollectionEmail(recipient: string, organizationName: string, item: RentCollectionReminder) {
  const connectionString = process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
  const senderAddress = process.env.REMINDER_SENDER_ADDRESS;
  if (!connectionString || !senderAddress) throw new ReminderNotSentError("Email reminder settings are incomplete.");
  const content = rentCollectionEmail(organizationName, item);
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({ senderAddress, recipients: { to: [{ address: recipient }] }, content });
  const result = await poller.pollUntilDone();
  if (result.status === "Failed" || result.status === "Canceled") throw new ReminderNotSentError("Azure Communication Services did not deliver the rent reminder.");
  if (result.status !== "Succeeded") throw new Error("Azure Communication Services returned an uncertain rent reminder status.");
  return result;
}
