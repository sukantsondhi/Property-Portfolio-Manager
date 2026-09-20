import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRequest } from "@azure/functions";
import { runReminders } from "../src/functions/reminders";
import { getDirectory, resetDirectoryForTests } from "../src/services/directory";
import { getStore, setStoreForTests } from "../src/services/store";
import type { PortfolioRecord } from "../src/domain/types";
import { sendReminderEmail, sendRentCollectionEmail, type RentCollectionReminder } from "../src/services/reminders";

const delivery = vi.hoisted(() => ({ status: "Failed", sends: 0, transportFailure: false }));
vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    async beginSend() {
      delivery.sends += 1;
      return { pollUntilDone: async () => { if (delivery.transportFailure) throw new Error("synthetic transport interruption"); return { status: delivery.status }; } };
    }
  },
}));

const compliance: PortfolioRecord = {
  id: "compliance-id", organizationId: "test-organization", kind: "compliance", archived: false,
  createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", version: 1,
  title: "EPC renewal", expiryDate: "2026-10-20",
};
const rent: RentCollectionReminder = {
  propertyId: "property-id", propertyName: "Example House", month: "2026-09",
  collectionDate: "2026-09-20", stage: "initial", deliveryStage: "initial", weekNumber: 0,
  allSettled: false, tenants: [],
};

describe("ACS reminder completion", () => {
  afterEach(() => {
    resetDirectoryForTests();
    setStoreForTests();
    delete process.env.DATA_BACKEND;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.REMINDER_API_KEY;
    delete process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
    delete process.env.REMINDER_SENDER_ADDRESS;
    delete process.env.WEB_URL;
    delivery.status = "Failed";
    delivery.sends = 0;
    delivery.transportFailure = false;
  });

  const request = () => new HttpRequest({ method: "POST", url: "http://localhost/api/reminders/run", headers: { "x-reminder-key": "x".repeat(48) } });
  async function dueReminder() {
    process.env.DATA_BACKEND = "memory";
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    process.env.REMINDER_API_KEY = "x".repeat(48);
    process.env.COMMUNICATION_SERVICES_CONNECTION_STRING = "endpoint=https://example.communication.azure.com/;accesskey=dummy";
    process.env.REMINDER_SENDER_ADDRESS = "reminders@example.com";
    const admin = { userId: "admin", email: "admin@example.com", roles: ["authenticated"] };
    const organization = await getDirectory().createOrganization("Synthetic Portfolio", admin);
    const store = getStore(organization.id);
    const property = await store.create("property", { name: "House" }, admin);
    await store.create("compliance", { propertyId: property.id, title: "EPC", expiryDate: new Date().toISOString().slice(0, 10), reminderOffsetsDays: [0] }, admin);
  }

  it("sends each delivery once when scheduler calls overlap", async () => {
    await dueReminder();
    delivery.status = "Succeeded";
    const results = await Promise.all([runReminders(request()), runReminders(request())]);
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(delivery.sends).toBe(1);
    await runReminders(request());
    expect(delivery.sends).toBe(1);
  });

  it("retries a confirmed failure but suppresses ambiguous outcomes", async () => {
    await dueReminder();
    expect((await runReminders(request())).status).toBe(502);
    delivery.transportFailure = true;
    expect((await runReminders(request())).status).toBe(502);
    delivery.transportFailure = false;
    delivery.status = "Succeeded";
    expect(await runReminders(request())).toMatchObject({ status: 503, jsonBody: { error: { code: "delivery_review_required" }, unresolved: 1 } });
    expect(delivery.sends).toBe(2);
  });

  it("rejects an invalid scheduler credential before sending", async () => {
    await dueReminder();
    expect((await runReminders(new HttpRequest({ method: "POST", url: "http://localhost/api/reminders/run" }))).status).toBe(401);
    expect(delivery.sends).toBe(0);
  });

  it("rejects an ACS failed status so compliance and rent stages can retry", async () => {
    process.env.COMMUNICATION_SERVICES_CONNECTION_STRING = "endpoint=https://example.communication.azure.com/;accesskey=dummy";
    process.env.REMINDER_SENDER_ADDRESS = "reminders@example.com";
    process.env.WEB_URL = "https://portfolio.example.com";
    await expect(sendReminderEmail("admin@example.com", "Example Organisation", [{ record: compliance, propertyName: "Example House", daysUntilExpiry: 30, offsetDays: 30 }])).rejects.toThrow("did not deliver the compliance reminder");
    await expect(sendRentCollectionEmail("admin@example.com", "Example Organisation", rent)).rejects.toThrow("did not deliver the rent reminder");
    delivery.status = "Succeeded";
    await expect(sendReminderEmail("admin@example.com", "Example Organisation", [{ record: compliance, propertyName: "Example House", daysUntilExpiry: 30, offsetDays: 30 }])).resolves.toMatchObject({ status: "Succeeded" });
    await expect(sendRentCollectionEmail("admin@example.com", "Example Organisation", rent)).resolves.toMatchObject({ status: "Succeeded" });
  });
});
