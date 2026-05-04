/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { SendOrganizationInvitationWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { eq, sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("organization invitations write integration", () => {
  it("persists an invitation and enqueues invitation delivery", async ({ env }) => {
    const inviterSession = await env.auth.createSession({
      email: "integration-new-organization-invite-sender@example.com",
    });
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    const inviteResponse = await inviteMember({
      cookie: inviterSession.cookie,
      env,
      organizationId: inviterSession.organizationId,
      email: inviteeEmail,
      role: "member",
    });

    expect(inviteResponse.status).toBe(200);

    const invitation = await env.controlPlaneDb.query.invitations.findFirst({
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

    const queuedWorkflowInput = await waitForQueuedInvitationWorkflowInput({
      env,
      email: inviteeEmail,
    });
    expect(queuedWorkflowInput).toMatchObject({
      email: inviteeEmail,
      organizationName: expect.any(String),
      inviterDisplayName: inviterSession.email,
      role: "member",
    });
    expect(queuedWorkflowInput.invitationUrl).toContain(invitation.id);
    expect(queuedWorkflowInput.invitationUrl).toContain(encodeURIComponent(inviteeEmail));
  });

  it("forbids members from creating and canceling invitations", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-organization-invite-owner-permissions@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-organization-invite-member-permissions@example.com",
    });
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;

    await addMemberToActiveOrganization({
      env,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });

    const forbiddenInviteResponse = await inviteMember({
      cookie: memberSession.cookie,
      env,
      organizationId: ownerSession.organizationId,
      email: inviteeEmail,
      role: "member",
    });

    expect(forbiddenInviteResponse.status).toBe(403);
    await expect(forbiddenInviteResponse.json()).resolves.toEqual({
      code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
      message: "You are not allowed to invite users to this organization",
    });

    const ownerInviteResponse = await inviteMember({
      cookie: ownerSession.cookie,
      env,
      organizationId: ownerSession.organizationId,
      email: inviteeEmail,
      role: "member",
    });

    expect(ownerInviteResponse.status).toBe(200);
    const invitationPayload = InvitationResponseSchema.parse(await ownerInviteResponse.json());

    const forbiddenCancelResponse = await env.controlPlaneApi.http.fetch(
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

const InvitationResponseSchema = z.object({
  id: z.string().min(1),
});

const InvitationWorkflowInputSchema = z.looseObject({
  email: z.email(),
  organizationName: z.string().min(1),
  inviterDisplayName: z.string().min(1),
  role: z.string().min(1),
  invitationUrl: z.url(),
});

async function inviteMember(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  organizationId: string;
  email: string;
  role: string;
}): Promise<Response> {
  return await input.env.controlPlaneApi.http.fetch("/v1/auth/organization/invite-member", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: input.cookie,
    },
    body: JSON.stringify({
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
    }),
  });
}

async function waitForQueuedInvitationWorkflowInput(input: {
  env: IntegrationTestEnvironment;
  email: string;
}) {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.controlPlaneDb.execute(sql<{ input: unknown }>`
      select input
      from control_plane_openworkflow.workflow_runs
      where
        workflow_name = ${SendOrganizationInvitationWorkflowSpec.name}
        and input->>'email' = ${input.email}
      order by created_at desc
      limit 1
    `);
    const row = result.rows[0];
    if (row !== undefined) {
      return InvitationWorkflowInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued organization invitation workflow input for email '${input.email}'.`,
  );
}

async function addMemberToActiveOrganization(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: "member",
  });

  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(input.env.controlPlaneTables.sessions.userId, input.userId));
}
