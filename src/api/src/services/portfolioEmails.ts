import { EmailClient, type EmailAttachment } from "@azure/communication-email";
import type { PortfolioRecord } from "../domain/types";

export type PortfolioEmail = {
  recipients: string[];
  subject: string;
  plainText: string;
  html: string;
  attachments?: EmailAttachment[];
};

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const pounds = (value: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0) / 100);
const nameOf = (record: PortfolioRecord) => String(record.name || record.title || record.fileName || record.description || `${record.firstName || ""} ${record.lastName || ""}`.trim() || record.kind);
const internalFields = new Set(["organizationId", "_etag", "blobName"]);
const fieldLabel = (key: string) => key.replace(/Pence$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase());
const fieldValue = (key: string, value: unknown) => {
  if (key.endsWith("Pence")) return pounds(value);
  if (Array.isArray(value)) return value.join(", ") || "None";
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value === "" || value === undefined || value === null) return "Not recorded";
  return String(value);
};
const fieldsOf = (record: PortfolioRecord) => Object.entries(record).filter(([key]) => !internalFields.has(key));

function secureHistoryUrl(organizationId: string, propertyId: string, yearId: string) {
  const root = new URL(process.env.WEB_URL || "http://localhost:5173");
  const url = new URL("/select-organization", root);
  url.searchParams.set("organization", organizationId);
  url.searchParams.set("next", `/app/history/${propertyId}/${yearId}`);
  return url.toString();
}

export function rentalYearBackupEmail(input: {
  organizationId: string;
  organizationName: string;
  property: PortfolioRecord;
  year: PortfolioRecord;
  records: PortfolioRecord[];
  recipients: string[];
  attachments: EmailAttachment[];
}) : PortfolioEmail {
  const { organizationId, organizationName, property, year, records, recipients, attachments } = input;
  const groups = new Map<string, PortfolioRecord[]>();
  for (const record of records) groups.set(record.kind, [...(groups.get(record.kind) ?? []), record]);
  groups.set("property", [property]);
  groups.set("rentalYear", [year]);
  const payments = groups.get("rentPayment") ?? [];
  const expenses = groups.get("expense") ?? [];
  const income = payments.reduce((sum, record) => sum + Number(record.amountPaidPence || 0), 0);
  const costs = expenses.reduce((sum, record) => sum + Number(record.amountPence || 0), 0);
  const link = secureHistoryUrl(organizationId, property.id, year.id);
  const intro = "This backup is organised by record type. Money is shown in pounds, dates use the saved rental-year records, and each document is listed even when it is too large to attach. The secure history link requires the recipient to sign in with an authorised Microsoft account and retain access to the organisation.";
  const orderedKinds = ["property", "rentalYear", "tenant", "guarantor", "reference", "tenancy", "rentPayment", "expense", "compliance", "document"];
  const plainSections = orderedKinds.map((kind) => {
    const items = groups.get(kind) ?? [];
    return `${kind.toUpperCase()} (${items.length})\n${items.map((record) => `- ${nameOf(record)}\n${fieldsOf(record).map(([key, value]) => `  ${fieldLabel(key)}: ${fieldValue(key, value)}`).join("\n")}`).join("\n") || "- None"}`;
  }).join("\n\n");
  const htmlSections = orderedKinds.map((kind) => {
    const items = groups.get(kind) ?? [];
    return `<h2>${escapeHtml(fieldLabel(kind))} (${items.length})</h2>${items.length ? items.map((record) => `<h3>${escapeHtml(nameOf(record))}</h3><table style="border-collapse:collapse;width:100%;margin-bottom:16px"><tbody>${fieldsOf(record).map(([key, value]) => `<tr><th style="padding:6px 8px;border:1px solid #d9e4ee;text-align:left;width:32%">${escapeHtml(fieldLabel(key))}</th><td style="padding:6px 8px;border:1px solid #d9e4ee">${escapeHtml(fieldValue(key, value))}</td></tr>`).join("")}</tbody></table>`).join("") : "<p>None</p>"}`;
  }).join("");
  return {
    recipients,
    subject: `${organizationName}: ${String(property.name)} ${String(year.label)} rental-year backup`,
    plainText: `${organizationName}\n${String(property.name)} — ${String(year.label)}\n${String(year.startDate)} to ${String(year.endDate)}\n\n${intro}\n\nExpected rent: ${pounds(year.annualRentPence)}\nRent received: ${pounds(income)}\nExpenses: ${pounds(costs)}\nNet: ${pounds(income - costs)}\n\n${plainSections}\n\nSecure read-only history: ${link}`,
    html: `<h1>${escapeHtml(property.name)} — ${escapeHtml(year.label)}</h1><p><strong>${escapeHtml(organizationName)}</strong><br>${escapeHtml(year.startDate)} to ${escapeHtml(year.endDate)}</p><p>${escapeHtml(intro)}</p><table style="border-collapse:collapse"><tr><td style="padding:8px"><strong>Expected rent</strong><br>${pounds(year.annualRentPence)}</td><td style="padding:8px"><strong>Received</strong><br>${pounds(income)}</td><td style="padding:8px"><strong>Expenses</strong><br>${pounds(costs)}</td><td style="padding:8px"><strong>Net</strong><br>${pounds(income - costs)}</td></tr></table>${htmlSections}<p><a href="${escapeHtml(link)}">Open the secure read-only rental-year history</a></p>`,
    attachments,
  };
}

export function organizationDeletedEmail(recipient: string, organizationName: string): PortfolioEmail {
  return {
    recipients: [recipient],
    subject: `${organizationName} has been deleted from Property Portfolio Manager`,
    plainText: `The ${organizationName} organisation no longer exists in Property Portfolio Manager. Your organisation access has been removed. Contact the organisation owner if you believe this was unexpected.`,
    html: `<h1>Organisation deleted</h1><p>The <strong>${escapeHtml(organizationName)}</strong> organisation no longer exists in Property Portfolio Manager.</p><p>Your organisation access has been removed. Contact the organisation owner if you believe this was unexpected.</p>`,
  };
}

export async function sendPortfolioEmail(message: PortfolioEmail) {
  const connectionString = process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
  const senderAddress = process.env.REMINDER_SENDER_ADDRESS;
  if (!connectionString || !senderAddress) throw new Error("Portfolio email settings are incomplete.");
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    recipients: { to: message.recipients.map((address) => ({ address })) },
    content: { subject: message.subject, plainText: message.plainText, html: message.html },
    attachments: message.attachments,
  });
  const result = await poller.pollUntilDone();
  if (result.status !== "Succeeded") throw new Error("Azure Communication Services did not deliver the portfolio email.");
  return result;
}
