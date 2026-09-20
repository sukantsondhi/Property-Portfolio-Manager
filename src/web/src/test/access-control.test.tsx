import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../components/AppShell";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: mocks.useAuth }));

const renderShell = (role: "owner" | "editor", isPlatformAdmin = false) => {
  mocks.useAuth.mockReturnValue({
    user: { email: "person@example.com", isPlatformAdmin },
    organization: { id: "org-1", name: "Portfolio", role },
    selectOrganization: vi.fn(),
  });
  return render(<MemoryRouter><AppShell><div>Portfolio content</div></AppShell></MemoryRouter>);
};

describe("role-specific navigation", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("shows editors their editor access without platform administration", () => {
    renderShell("editor");
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Platform admin" })).not.toBeInTheDocument();
  });

  it("shows owners their owner access without platform administration", () => {
    renderShell("owner");
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Platform admin" })).not.toBeInTheDocument();
  });

  it("shows server-recognised super admins the Platform Admin tab", () => {
    renderShell("owner", true);
    expect(screen.getByText("Super admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Platform admin" })).toHaveAttribute("href", "/app/admin");
  });
});
