import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchivePage } from "../pages/ArchivePage";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  status: vi.fn(),
  permanentDelete: vi.fn(),
}));

vi.mock("../lib/api", () => ({ api: mocks }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ organization: { id: "test-organization", name: "Test", role: "owner" } }),
}));

const archivedProperty = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "test-organization",
  kind: "property" as const,
  name: "Test House",
  archived: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "owner@example.com",
  updatedAt: "2026-07-22T00:00:00.000Z",
  updatedBy: "owner@example.com",
  version: 2,
  _etag: 'W/"2"',
};

describe("ArchivePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockImplementation(async (kind: string) => ({
      items: kind === "property" ? [archivedProperty] : [],
    }));
    mocks.status.mockResolvedValue({ ...archivedProperty, archived: false });
    mocks.permanentDelete.mockResolvedValue({
      deletedCount: 1,
      blobCleanupFailures: 0,
    });
  });

  it("requires confirmation before restoring", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    render(<ArchivePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(confirm).toHaveBeenCalledWith(
      'Restore "Test House"? It will return to the active portfolio views.',
    );
    expect(mocks.status).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(mocks.status).toHaveBeenCalledWith(archivedProperty, "restore"),
    );
  });

  it("requires an irreversible warning before permanent deletion", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    render(<ArchivePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("This cannot be undone."),
    );
    await waitFor(() =>
      expect(mocks.permanentDelete).toHaveBeenCalledWith(archivedProperty),
    );
  });
});
