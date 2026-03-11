import {
  integrationConnections,
  integrationTargets,
  IntegrationBindingKinds,
  SandboxProfileStatuses,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  PutSandboxProfileVersionIntegrationBindingsResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
} from "../src/sandbox-profiles/contracts.js";
import { it } from "./test-context.js";

describe("sandbox profile version integration bindings get integration", () => {
  it("returns profile-version integration bindings", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-bindings-get@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-bindings-get",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
      },
    });
    const [connection] = await fixture.db
      .insert(integrationConnections)
      .values({
        id: "icn_bindings_get_001",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default-bindings-get",
        displayName: "Bindings Get Connection",
      })
      .returning();

    if (connection === undefined) {
      throw new Error("Expected integration connection to be inserted.");
    }

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_bindings_get_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Bindings Get Profile",
      status: SandboxProfileStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_bindings_get_001",
      version: 1,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_bindings_get_001",
      sandboxProfileId: "sbp_bindings_get_001",
      sandboxProfileVersion: 1,
      connectionId: connection.id,
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
        additionalInstructions: "Prefer concise answers.",
      },
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_bindings_get_001/versions/1/integration-bindings",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionIntegrationBindingsResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.bindings).toHaveLength(1);
    expect(responseBody.bindings[0]).toMatchObject({
      id: "ibd_bindings_get_001",
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
        additionalInstructions: "Prefer concise answers.",
      },
    });
  }, 60_000);

  it("returns 404 when profile version is missing", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-bindings-get-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_bindings_get_missing_version_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Bindings Missing Version Profile",
      status: SandboxProfileStatuses.ACTIVE,
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_bindings_get_missing_version_001/versions/10/integration-bindings",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = SandboxProfileVersionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  }, 60_000);
});
