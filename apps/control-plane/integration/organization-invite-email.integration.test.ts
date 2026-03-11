import { randomUUID } from "node:crypto";

import { SendOrganizationInvitationWorkflowSpec } from "@control-plane/workflows";
import { describe, expect } from "vitest";

import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
import { it } from "./test-context.js";

describe("organization invite email integration", () => {
  it("persists an invitation and enqueues invitation delivery workflow", async ({ fixture }) => {
    const inviterSession = await fixture.authSession({
      email: "integration-organization-invite-sender@example.com",
    });
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;
    const queuedInvitationRunsBefore = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SendOrganizationInvitationWorkflowSpec.name,
      inputEquals: {
        email: inviteeEmail,
      },
    });

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

    const invitation = await fixture.db.query.invitations.findFirst({
      columns: {
        id: true,
        organizationId: true,
        email: true,
        status: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, inviterSession.organizationId),
          eq(table.email, inviteeEmail),
          eq(table.status, "pending"),
        ),
    });
    expect(invitation).toBeDefined();
    if (invitation === undefined) {
      throw new Error("Expected invitation row to be persisted.");
    }
    expect(invitation.email).toBe(inviteeEmail);

    const queuedInvitationRunsAfter = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SendOrganizationInvitationWorkflowSpec.name,
      inputEquals: {
        email: inviteeEmail,
      },
    });
    expect(queuedInvitationRunsAfter).toBe(queuedInvitationRunsBefore + 1);
  });
});
