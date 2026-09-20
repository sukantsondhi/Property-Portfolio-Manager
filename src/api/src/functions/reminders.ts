import { app, type HttpRequest } from "@azure/functions";
import { createHash, timingSafeEqual } from "node:crypto";
import { findDueReminders, findDueRentCollectionReminders, sendReminderEmail, sendRentCollectionEmail } from "../services/reminders";
import { json, problem, StoreError } from "../services/responses";
import { getDirectory } from "../services/directory";
import { getStore } from "../services/store";

function authorizeScheduler(request: HttpRequest) {
  const expected = process.env.REMINDER_API_KEY ?? "";
  const provided = request.headers.get("x-reminder-key") ?? "";
  const valid = expected.length >= 32 && expected.length === provided.length && timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  if (!valid) throw new StoreError(401, "unauthorized_scheduler", "The reminder scheduler credential is invalid.");
}
const deliveryKey = (organizationId: string, recordId: string, expiryDate: unknown, offset: number, recipient: string) => createHash("sha256").update([organizationId, recordId, String(expiryDate), String(offset), recipient.toLowerCase()].join("|")).digest("hex");
const rentDeliveryKey = (organizationId: string, propertyId: string, month: string, stage: string, recipient: string) => createHash("sha256").update(["rent", organizationId, propertyId, month, stage, recipient.toLowerCase()].join("|")).digest("hex");

app.http("runReminders", {
  methods: ["POST"], authLevel: "anonymous", route: "reminders/run",
  handler: async (request) => {
    try {
      authorizeScheduler(request);
      const directory = getDirectory();
      let sent = 0;
      let complianceCount = 0;
      let rentCollectionCount = 0;
      for (const organization of await directory.reminderTargets()) {
        const records = await getStore(organization.id).allActive();
        const due = findDueReminders(records);
        const rentDue = findDueRentCollectionReminders(records);
        for (const recipient of [...new Set(organization.recipients)]) {
          const unsent = [];
          for (const item of due) {
            const key = deliveryKey(organization.id, item.record.id, item.record.expiryDate, item.offsetDays, recipient);
            if (!(await directory.hasReminderDelivery(key))) unsent.push({ key, item });
          }
          if (unsent.length) {
            await sendReminderEmail(recipient, organization.name, unsent.map(({ item }) => item));
            for (const { key, item } of unsent) await directory.recordReminderDelivery(key, { targetOrganizationId: organization.id, recordId: item.record.id, recipient, dueDate: item.record.expiryDate, offsetDays: item.offsetDays });
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
            if (await directory.hasReminderDelivery(key)) continue;
            await sendRentCollectionEmail(recipient, organization.name, item);
            await directory.recordReminderDelivery(key, {
              targetOrganizationId: organization.id,
              propertyId: item.propertyId,
              recipient,
              reminderType: "rent_collection",
              rentMonth: item.month,
              reminderStage: item.deliveryStage,
            });
            sent += 1;
            rentCollectionCount += 1;
          }
        }
      }
      return json(200, { sent: sent > 0, count: sent, complianceCount, rentCollectionCount });
    } catch (error) { return problem(error); }
  },
});
