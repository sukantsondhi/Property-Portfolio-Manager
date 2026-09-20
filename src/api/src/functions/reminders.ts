import { app, type HttpRequest } from "@azure/functions";
import { createHash, timingSafeEqual } from "node:crypto";
import { findDueReminders, findDueRentCollectionReminders, ReminderNotSentError, sendReminderEmail, sendRentCollectionEmail } from "../services/reminders";
import { json, problem, StoreError } from "../services/responses";
import { getDirectory } from "../services/directory";
import { getStore } from "../services/store";

function authorizeScheduler(request: HttpRequest) {
  const expected = Buffer.from(process.env.REMINDER_API_KEY ?? "");
  const provided = Buffer.from(request.headers.get("x-reminder-key") ?? "");
  const valid = expected.length >= 32 && expected.length === provided.length && timingSafeEqual(expected, provided);
  if (!valid) throw new StoreError(401, "unauthorized_scheduler", "The reminder scheduler credential is invalid.");
}
const deliveryKey = (organizationId: string, recordId: string, expiryDate: unknown, offset: number, recipient: string) => createHash("sha256").update([organizationId, recordId, String(expiryDate), String(offset), recipient.toLowerCase()].join("|")).digest("hex");
const rentDeliveryKey = (organizationId: string, propertyId: string, month: string, stage: string, recipient: string) => createHash("sha256").update(["rent", organizationId, propertyId, month, stage, recipient.toLowerCase()].join("|")).digest("hex");

export async function runReminders(request: HttpRequest) {
    try {
      authorizeScheduler(request);
      const directory = getDirectory();
      const sendClaimed = async (claims: { key: string; token: string }[], send: () => Promise<unknown>) => {
        let accepted = false;
        try {
          await send();
          accepted = true;
          for (const claim of claims) await directory.recordReminderDelivery(claim.key, claim.token);
        } catch (error) {
          for (const claim of claims)
            await directory.failReminderDelivery(claim.key, claim.token, !accepted && error instanceof ReminderNotSentError).catch(() => undefined);
          throw new StoreError(502, "reminder_delivery_failed", "A reminder could not be confirmed. Review delivery status before retrying uncertain sends.");
        }
      };
      let sent = 0;
      let complianceCount = 0;
      let rentCollectionCount = 0;
      for (const organization of await directory.reminderTargets()) {
        const records = await getStore(organization.id).allActive();
        const due = findDueReminders(records);
        const rentDue = findDueRentCollectionReminders(records);
        for (const recipient of [...new Set(organization.recipients)]) {
          const unsent: { key: string; token: string; item: (typeof due)[number] }[] = [];
          for (const item of due) {
            const key = deliveryKey(organization.id, item.record.id, item.record.expiryDate, item.offsetDays, recipient);
            const token = await directory.claimReminderDelivery(key, { targetOrganizationId: organization.id, recordId: item.record.id, recipient, dueDate: item.record.expiryDate, offsetDays: item.offsetDays });
            if (token) unsent.push({ key, token, item });
          }
          if (unsent.length) {
            await sendClaimed(unsent, () => sendReminderEmail(recipient, organization.name, unsent.map(({ item }) => item)));
            sent += unsent.length;
            complianceCount += unsent.length;
          }
          for (const item of rentDue) {
            if (
              item.month < new Date().toISOString().slice(0, 7) &&
              !(await directory.hasReminderDelivery(
                rentDeliveryKey(organization.id, item.propertyId, item.month, "initial", recipient),
              ))
            ) continue;
            const key = rentDeliveryKey(organization.id, item.propertyId, item.month, item.deliveryStage, recipient);
            const token = await directory.claimReminderDelivery(key, {
              targetOrganizationId: organization.id,
              propertyId: item.propertyId,
              recipient,
              reminderType: "rent_collection",
              rentMonth: item.month,
              reminderStage: item.deliveryStage,
            });
            if (!token) continue;
            await sendClaimed([{ key, token }], () => sendRentCollectionEmail(recipient, organization.name, item));
            sent += 1;
            rentCollectionCount += 1;
          }
        }
      }
      const unresolved = await directory.unresolvedReminderDeliveries();
      if (unresolved) return json(503, { error: { code: "delivery_review_required", message: "Some reminder deliveries require operator review before they can be retried." }, unresolved, count: sent });
      return json(200, { sent: sent > 0, count: sent, complianceCount, rentCollectionCount });
    } catch (error) { return problem(error); }
}

app.http("runReminders", { methods: ["POST"], authLevel: "anonymous", route: "reminders/run", handler: runReminders });
