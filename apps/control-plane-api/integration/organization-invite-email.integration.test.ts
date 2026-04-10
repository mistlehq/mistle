import { randomUUID } from "node:crypto";

import { MemberRoles, members, sessions } from "@mistle/db/control-plane";
import { SendOrganizationInvitationWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
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

  it("forbids members from creating and canceling invitations through auth endpoints", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "integration-organization-invite-owner-permissions@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "integration-organization-invite-member-permissions@example.com",
    });
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    await addMemberToActiveOrganization({
      fixture,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });

    const forbiddenInviteResponse = await fixture.request("/v1/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: memberSession.cookie,
      },
      body: JSON.stringify({
        organizationId: ownerSession.organizationId,
        email: inviteeEmail,
        role: "member",
      }),
    });

    expect(forbiddenInviteResponse.status).toBe(403);
    await expect(forbiddenInviteResponse.json()).resolves.toEqual({
      code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
      message: "You are not allowed to invite users to this organization",
    });

    const ownerInviteResponse = await fixture.request("/v1/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ownerSession.cookie,
      },
      body: JSON.stringify({
        organizationId: ownerSession.organizationId,
        email: inviteeEmail,
        role: "member",
      }),
    });

    expect(ownerInviteResponse.status).toBe(200);
    const invitationPayload: unknown = await ownerInviteResponse.json();
    if (
      typeof invitationPayload !== "object" ||
      invitationPayload === null ||
      !("id" in invitationPayload) ||
      typeof invitationPayload.id !== "string"
    ) {
      throw new Error("Expected owner invite response to include invitation id.");
    }

    const forbiddenCancelResponse = await fixture.request(
      "/v1/auth/organization/cancel-invitation",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: memberSession.cookie,
        },
        body: JSON.stringify({
          invitationId: invitationPayload.id,
        }),
      },
    );

    expect(forbiddenCancelResponse.status).toBe(403);
    await expect(forbiddenCancelResponse.json()).resolves.toEqual({
      code: "YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION",
      message: "You are not allowed to cancel this invitation",
    });
  });
});

async function addMemberToActiveOrganization(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.fixture.db.insert(members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: MemberRoles.MEMBER,
  });

  await input.fixture.db
    .update(sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(sessions.userId, input.userId));
}
