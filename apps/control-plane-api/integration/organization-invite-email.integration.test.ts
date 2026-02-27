import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";

import { it } from "./test-context.js";

describe("organization invite email integration", () => {
  it("sends an invitation email when inviting a member", async ({ fixture }) => {
    const inviterSession = await fixture.authSession({
      email: "integration-organization-invite-sender@example.com",
    });
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    const inviteResponse = await fixture.request("/v1/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: inviterSession.cookie,
      },
      body: JSON.stringify({
        organizationId: inviterSession.organizationId,
        email: inviteeEmail,
        role: "member",
      }),
    });

    expect(inviteResponse.status).toBe(200);

    const invitationMessage = await fixture.mailpitService.waitForMessage({
      timeoutMs: 15_000,
      description: `Organization invitation email for ${inviteeEmail}`,
      matcher: ({ message }) =>
        message.Subject.startsWith("You're invited to join") &&
        message.To.some((address) => address.Address === inviteeEmail),
    });

    const invitationSummary = await fixture.mailpitService.getMessageSummary(invitationMessage.ID);
    expect(invitationSummary.Text).toContain("Accept invitation:");
    expect(invitationSummary.Text).toContain("invitationId=");
    expect(invitationSummary.Text).toContain(`email=${encodeURIComponent(inviteeEmail)}`);
  }, 60_000);
});
