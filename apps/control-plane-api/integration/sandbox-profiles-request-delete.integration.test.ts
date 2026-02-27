import { SandboxProfileStatuses, sandboxProfiles } from "@mistle/db/control-plane";
import { systemClock, systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

import {
  NotFoundResponseSchema,
  SandboxProfileDeletionAcceptedResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/contracts.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

const DELETE_WORKFLOW_TIMEOUT_MS = 10_000;
const DELETE_WORKFLOW_POLL_INTERVAL_MS = 100;

async function waitForProfileDeletion(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  profileId: string;
  organizationId: string;
  timeoutMs: number;
}): Promise<void> {
  const timeoutAt = systemClock.nowMs() + input.timeoutMs;

  while (systemClock.nowMs() <= timeoutAt) {
    const profile = await input.fixture.db.query.sandboxProfiles.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
    });

    if (profile === undefined) {
      return;
    }

    await systemSleeper.sleep(DELETE_WORKFLOW_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for sandbox profile ${input.profileId} to be deleted.`);
}

describe("sandbox profiles request delete integration", () => {
  it("enqueues deletion and removes the sandbox profile asynchronously", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-request-delete@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_delete_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Delete Me",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await fixture.request("/v1/sandbox/profiles/sbp_delete_001", {
      method: "DELETE",
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(202);

    const body = SandboxProfileDeletionAcceptedResponseSchema.parse(await response.json());
    expect(body.status).toBe("accepted");
    expect(body.profileId).toBe("sbp_delete_001");

    await waitForProfileDeletion({
      fixture,
      profileId: "sbp_delete_001",
      organizationId: authenticatedSession.organizationId,
      timeoutMs: DELETE_WORKFLOW_TIMEOUT_MS,
    });
  }, 60_000);

  it("returns 401 when no authenticated session is provided", async ({ fixture }) => {
    const response = await fixture.request("/v1/sandbox/profiles/sbp_delete_unauth", {
      method: "DELETE",
    });

    expect(response.status).toBe(401);
  }, 60_000);

  it("returns 400 for invalid profile id params", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-delete-validation@example.com",
    });

    const response = await fixture.request("/v1/sandbox/profiles/invalid-profile-id", {
      method: "DELETE",
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.success).toBe(false);
    expect(body.error.name).toBe("ZodError");
  }, 60_000);

  it("returns 404 for profiles outside the authenticated user's organization", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-delete-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-delete-org-b@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_delete_org_b_001",
      organizationId: secondOrgSession.organizationId,
      displayName: "Org B Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const response = await fixture.request("/v1/sandbox/profiles/sbp_delete_org_b_001", {
      method: "DELETE",
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });
    expect(response.status).toBe(404);

    const body = NotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_NOT_FOUND");
  }, 60_000);
});
