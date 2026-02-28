import {
  IntegrationBindingKinds,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  StartSandboxProfileInstanceBadRequestResponseSchema,
  StartSandboxProfileInstanceNotFoundResponseSchema,
  StartSandboxProfileInstanceResponseSchema,
} from "../../src/sandbox-profiles/contracts.js";
import { it } from "./test-context.js";

describe("sandbox profile version start instance integration", () => {
  it("starts a sandbox instance for the selected profile version", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance@example.com",
    });

    await fixture.controlPlaneDb.insert(sandboxProfiles).values({
      id: "sbp_start_instance_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Start Instance Profile",
      status: "active",
    });
    await fixture.controlPlaneDb.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_001",
      version: 3,
      manifest: {
        command: ["echo", "hello"],
      },
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_start_instance_001/versions/3/instances",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(201);

    const body = StartSandboxProfileInstanceResponseSchema.parse(await response.json());
    expect(body.status).toBe("completed");
    expect(body.workflowRunId).not.toBe("");
    expect(body.sandboxInstanceId).not.toBe("");
    expect(body.providerSandboxId).not.toBe("");

    const persistedSandboxInstance = await fixture.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        provider: true,
      },
      where: (table, { eq }) => eq(table.id, body.sandboxInstanceId),
    });
    expect(persistedSandboxInstance).toBeDefined();
    expect(persistedSandboxInstance?.provider).toBe("docker");
  }, 120_000);

  it("returns 404 when the sandbox profile version does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-missing-version@example.com",
    });

    await fixture.controlPlaneDb.insert(sandboxProfiles).values({
      id: "sbp_start_instance_missing_version",
      organizationId: authenticatedSession.organizationId,
      displayName: "Missing Version Profile",
      status: "active",
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_start_instance_missing_version/versions/9/instances",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(404);

    const body = StartSandboxProfileInstanceNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_VERSION_NOT_FOUND");
  }, 120_000);

  it("returns 400 when compile preflight fails", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-compile-error@example.com",
    });

    await fixture.controlPlaneDb.insert(sandboxProfiles).values({
      id: "sbp_start_instance_compile_error",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Error Profile",
      status: "active",
    });
    await fixture.controlPlaneDb.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_compile_error",
      version: 1,
      manifest: {},
    });
    await fixture.controlPlaneDb.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_start_instance_compile_error",
      sandboxProfileId: "sbp_start_instance_compile_error",
      sandboxProfileVersion: 1,
      connectionId: "icn_missing_connection",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
      },
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_start_instance_compile_error/versions/1/instances",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(response.status).toBe(400);

    const body = StartSandboxProfileInstanceBadRequestResponseSchema.parse(await response.json());
    if (!("code" in body)) {
      throw new Error("Expected sandbox profile compile error response.");
    }
    expect(body.code).toBe("INVALID_BINDING_CONNECTION_REFERENCE");
  }, 120_000);
});
