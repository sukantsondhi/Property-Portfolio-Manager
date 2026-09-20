import { EmailClient } from "@azure/communication-email";
import type { OrganizationRole } from "../domain/types";

export type InvitationEmail = {
  recipient: string;
  subject: string;
  plainText: string;
  html: string;
  signInUrl: string;
};

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function webUrl() {
  const configured = process.env.WEB_URL?.trim();
  if (!configured) throw new Error("WEB_URL is required for invitation emails.");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("WEB_URL must use HTTPS.");
  return url;
}

function signInUrl(organizationId?: string) {
  const root = webUrl();
  const destination = new URL("/select-organization", root);
  if (organizationId) destination.searchParams.set("organization", organizationId);
  const login = new URL("/.auth/login/aad", root);
  login.searchParams.set("post_login_redirect_uri", destination.toString());
  return login.toString();
}

export function platformInvitationEmail(recipient: string): InvitationEmail {
  const link = signInUrl();
  return {
    recipient,
    subject: "You have been invited to Property Portfolio Manager",
    plainText: `You have been invited to the private Property Portfolio Manager platform.\n\nSign in with this Microsoft account: ${recipient}\n\nAccept your invitation: ${link}\n\nThis invitation is intended only for ${recipient} and expires after 14 days.`,
    html: `<h1>You have been invited</h1><p>You now have access to the private <strong>Property Portfolio Manager</strong> platform.</p><p>Sign in using this Microsoft account: <strong>${escapeHtml(recipient)}</strong></p><p><a href="${escapeHtml(link)}">Sign in to Property Portfolio Manager</a></p><p>This invitation is intended only for ${escapeHtml(recipient)} and expires after 14 days.</p>`,
    signInUrl: link,
  };
}

export function organizationInvitationEmail(recipient: string, organizationId: string, organizationName: string, role: OrganizationRole): InvitationEmail {
  const link = signInUrl(organizationId);
  const roleLabel = role === "owner" ? "Owner" : "Editor";
  const subjectOrganizationName = organizationName.replace(/[\r\n]+/g, " ").trim();
  return {
    recipient,
    subject: `You have been added to ${subjectOrganizationName} in Property Portfolio Manager`,
    plainText: `You have been added to the ${organizationName} organisation in Property Portfolio Manager as ${roleLabel}.\n\nUse this Microsoft account: ${recipient}\n\nOpen the organisation: ${link}\n\nIf you do not yet have platform access, the platform administrator must also approve this email address.`,
    html: `<h1>You have been added to an organisation</h1><p>You have been added to <strong>${escapeHtml(organizationName)}</strong> in Property Portfolio Manager as <strong>${roleLabel}</strong>.</p><p>Use this Microsoft account: <strong>${escapeHtml(recipient)}</strong></p><p><a href="${escapeHtml(link)}">Open ${escapeHtml(organizationName)}</a></p><p>If you do not yet have platform access, the platform administrator must also approve this email address.</p>`,
    signInUrl: link,
  };
}

export async function sendInvitationEmail(message: InvitationEmail) {
  const connectionString = process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
  const senderAddress = process.env.REMINDER_SENDER_ADDRESS;
  if (!connectionString || !senderAddress) throw new Error("Invitation email settings are incomplete.");
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    recipients: { to: [{ address: message.recipient }] },
    content: { subject: message.subject, plainText: message.plainText, html: message.html },
  });
  const result = await poller.pollUntilDone();
  if (result.status !== "Succeeded") throw new Error("Azure Communication Services did not deliver the invitation email.");
  return result;
}
