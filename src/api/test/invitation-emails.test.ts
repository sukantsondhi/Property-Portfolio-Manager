import { afterEach, describe, expect, it } from "vitest";
import { organizationInvitationEmail, platformInvitationEmail } from "../src/services/invitationEmails";

describe("invitation emails", () => {
  afterEach(() => delete process.env.WEB_URL);

  it("builds a platform sign-in link for the invited Microsoft account", () => {
    process.env.WEB_URL = "https://portfolio.example.com";
    const email = platformInvitationEmail("person@example.com");
    const login = new URL(email.signInUrl);
    expect(email.subject).toContain("Property Portfolio Manager");
    expect(email.plainText).toContain("person@example.com");
    expect(login.pathname).toBe("/.auth/login/aad");
    expect(login.searchParams.get("post_login_redirect_uri")).toBe("https://portfolio.example.com/select-organization");
  });

  it("builds an organisation-specific link and escapes organisation names", () => {
    process.env.WEB_URL = "https://portfolio.example.com";
    const email = organizationInvitationEmail("person@example.com", "org-123", "Smith & <Partners>", "editor");
    const destination = new URL(new URL(email.signInUrl).searchParams.get("post_login_redirect_uri")!);
    expect(destination.pathname).toBe("/select-organization");
    expect(destination.searchParams.get("organization")).toBe("org-123");
    expect(email.html).toContain("Smith &amp; &lt;Partners&gt;");
    expect(email.html).not.toContain("Smith & <Partners>");
  });
});
