import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "../pages/AdminPage";
import { OrganizationPage } from "../pages/OrganizationPage";

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
  deleteOrganization: vi.fn(),
  platformInvitations: vi.fn(),
  invitePlatformUser: vi.fn(),
  revokePlatformInvitation: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../lib/api", () => ({ api: mocks }));
vi.mock("../context/AuthContext", () => ({ useAuth: mocks.useAuth }));

describe("invitation forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.members.mockResolvedValue({ members: [], invitations: [] });
    mocks.platformInvitations.mockResolvedValue([]);
    mocks.inviteMember.mockResolvedValue({ status: "pending", existing: false, emailDelivery: "sent" });
    mocks.invitePlatformUser.mockResolvedValue({ status: "pending", existing: false, emailDelivery: "sent" });
    mocks.deleteOrganization.mockResolvedValue({ name: "Portfolio", deletedRecordCount: 0, deletedBlobCount: 0, blobCleanupFailures: 0 });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("keeps a stable organisation form reference across the async request", async () => {
    mocks.useAuth.mockReturnValue({ organization: { id: "org-1", name: "Portfolio", role: "owner" }, refreshSession: vi.fn(), selectOrganization: vi.fn() });
    render(<MemoryRouter><OrganizationPage /></MemoryRouter>);
    const email = screen.getByPlaceholderText("Microsoft account email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "member@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite user" }));

    await screen.findByText("Access invitation saved and emailed.");
    expect(mocks.inviteMember).toHaveBeenCalledWith("org-1", "member@example.com", "editor");
    expect(email.value).toBe("");
  });

  it("keeps a stable platform form reference across the async request", async () => {
    mocks.useAuth.mockReturnValue({ user: { email: "admin@example.com", isPlatformAdmin: true } });
    render(<MemoryRouter><AdminPage /></MemoryRouter>);
    const email = screen.getByPlaceholderText("person@example.com") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "member@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));

    await screen.findByText("Platform invitation created and emailed. The user must sign in with that Microsoft account.");
    await waitFor(() => expect(mocks.invitePlatformUser).toHaveBeenCalledWith("member@example.com"));
    expect(email.value).toBe("");
  });

  it("requires the exact organisation name and a final confirmation before deletion", async () => {
    const refreshSession = vi.fn().mockResolvedValue(undefined);
    const selectOrganization = vi.fn();
    mocks.useAuth.mockReturnValue({ organization: { id: "org-1", name: "Portfolio", role: "owner" }, refreshSession, selectOrganization });
    vi.spyOn(window, "prompt").mockReturnValue("Portfolio");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MemoryRouter><OrganizationPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Delete organisation" }));
    await waitFor(() => expect(mocks.deleteOrganization).toHaveBeenCalledWith("org-1", "Portfolio"));
    expect(selectOrganization).toHaveBeenCalledWith(null);
    expect(refreshSession).toHaveBeenCalledOnce();
  });
});
