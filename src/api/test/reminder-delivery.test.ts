import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortfolioRecord } from "../src/domain/types";
import { sendReminderEmail, sendRentCollectionEmail, type RentCollectionReminder } from "../src/services/reminders";

const delivery = vi.hoisted(() => ({ status: "Failed" }));
vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    async beginSend() { return { pollUntilDone: async () => ({ status: delivery.status }) }; }
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
    delete process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
    delete process.env.REMINDER_SENDER_ADDRESS;
    delete process.env.WEB_URL;
    delivery.status = "Failed";
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
