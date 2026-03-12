import { SandboxProfileStatuses, sandboxProfiles } from "@mistle/db/control-plane";
import { RequestDeleteSandboxProfileWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

import {
  NotFoundResponseSchema,
  SandboxProfileDeletionAcceptedResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/contracts.js";
import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
import { it } from "./test-context.js";

describe("sandbox profiles request delete integration", () => {
  it("returns accepted and enqueues sandbox profile deletion workflow", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-request-delete@example.com",
    });
    const workflowRunCountBefore = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: RequestDeleteSandboxProfileWorkflowSpec.name,
      inputEquals: {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_delete_001",
      },
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

    const workflowRunCountAfter = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: RequestDeleteSandboxProfileWorkflowSpec.name,
      inputEquals: {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_delete_001",
      },
    });
    expect(workflowRunCountAfter).toBe(workflowRunCountBefore + 1);

    const persistedProfile = await fixture.db.query.sandboxProfiles.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.id, "sbp_delete_001"),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(persistedProfile).toBeDefined();
  });

  it("returns 401 when no authenticated session is provided", async ({ fixture }) => {
    const response = await fixture.request("/v1/sandbox/profiles/sbp_delete_unauth", {
      method: "DELETE",
    });

    expect(response.status).toBe(401);
  });

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
  });

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
  });
});
