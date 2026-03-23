import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  StartSandboxProfileInstanceBadRequestResponseSchema,
  StartSandboxProfileInstanceNotFoundResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { it } from "./test-context.js";

describe("sandbox profile version start instance integration", () => {
  it("returns 404 when the sandbox profile version does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
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
  });

  it("returns 400 when compile preflight fails", async ({ fixture }) => {
    const targetKey = "openai-start-instance-preflight";
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-compile-error@example.com",
    });
    const otherOrganizationSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-compile-error-other-org@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_compile_error",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Error Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_compile_error",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_missing_connection",
      organizationId: otherOrganizationSession.organizationId,
      targetKey,
      displayName: "Foreign connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_start_instance_compile_error",
      sandboxProfileId: "sbp_start_instance_compile_error",
      sandboxProfileVersion: 1,
      connectionId: "icn_missing_connection",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
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
  });

  it("returns 400 when the sandbox profile version has no agent binding", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-start-instance-missing-agent-binding@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_start_instance_missing_agent_binding",
      organizationId: authenticatedSession.organizationId,
      displayName: "Missing Agent Binding Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_start_instance_missing_agent_binding",
      version: 1,
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_start_instance_missing_agent_binding/versions/1/instances",
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
    expect(body.code).toBe("AGENT_RUNTIME_REQUIRED");
  });
});
