import { describe, expect, it } from "vitest";

import { buildOrganizationInvitationTemplate } from "./builder.js";

describe("emails organization invitation", () => {
  it("builds an organization invitation email template", async () => {
    const template = await buildOrganizationInvitationTemplate({
      organizationName: "Acme <Platform>",
      inviterDisplayName: "Jane & John",
      role: "admin<script>",
      invitationUrl: "https://example.com/accept?x=<tag>&y='quoted'",
    });

    expect(template.subject).toBe("You're invited to join Acme <Platform>");
    expect(template.html).toContain("Jane &#x26; John invited you to join Acme &#x3C;Platform>");
    expect(template.html).toContain("as admin&#x3C;script>.");
    expect(template.html).toContain("href=\"https://example.com/accept?x=<tag>&#x26;y='quoted'\"");
    expect(template.text).toContain(
      "Jane & John invited you to join Acme <Platform> as admin<script>.",
    );
    expect(template.text).toContain(
      "Accept invitation https://example.com/accept?x=<tag>&y='quoted'",
    );
  });

  it("matches snapshot for a stable organization invitation template output", async () => {
    const template = await buildOrganizationInvitationTemplate({
      organizationName: "Acme",
      inviterDisplayName: "Jane Doe",
      role: "admin",
      invitationUrl: "https://example.com/accept?invitationId=inv_123",
    });

    expect(template).toMatchSnapshot();
  });
});
