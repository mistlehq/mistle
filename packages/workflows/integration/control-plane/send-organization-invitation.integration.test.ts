import { describe, expect } from "vitest";

import { SendOrganizationInvitationWorkflowSpec } from "../../src/control-plane/index.js";
import { it } from "./test-context.js";

describe("send organization invitation workflow integration", () => {
  it("runs the workflow and sends an invitation email via SMTP", async ({ fixture }) => {
    const recipient = "workflow-invitation@mistle.dev";
    const invitationUrl =
      "http://localhost:5173/invitations/accept?invitationId=inv_123&email=workflow-invitation%40mistle.dev";
    const handle = await fixture.openWorkflow.runWorkflow(SendOrganizationInvitationWorkflowSpec, {
      email: recipient,
      organizationName: "Mistle Org",
      inviterDisplayName: "Owner",
      role: "member",
      invitationUrl,
    });
    const result = await handle.result({ timeoutMs: 10_000 });

    expect(result.messageId).not.toBe("");

    const message = await fixture.mailpitService.waitForMessage({
      timeoutMs: 10_000,
      description: `workflow invitation email for ${recipient}`,
      matcher: ({ message: listMessage }) =>
        listMessage.Subject === "You're invited to join Mistle Org" &&
        listMessage.To.some((address) => address.Address === recipient),
    });
    const summary = await fixture.mailpitService.getMessageSummary(message.ID);

    expect(message.Subject).toBe("You're invited to join Mistle Org");
    expect(message.To.map((address) => address.Address)).toContain(recipient);
    expect(summary.Text).toContain(`Accept invitation: ${invitationUrl}`);
  }, 90_000);
});
