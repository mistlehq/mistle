import {
  integrationConnectionResources,
  integrationConnectionResourceStates,
  integrationConnections,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  integrationTargets,
  IntegrationBindingKinds,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { describe, expect } from "vitest";

import {
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesNotFoundCodes,
} from "../src/sandbox-profiles/services/errors.js";
import { putProfileVersionIntegrationBindings } from "../src/sandbox-profiles/services/put-profile-version-integration-bindings.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

describe("sandbox profile version put integration bindings service integration", () => {
  it("replaces integration bindings for a profile version", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-service@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default-put-bindings-service",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
          binding_capabilities: createOpenAiRawBindingCapabilities(),
        },
      })
      .onConflictDoNothing();

    const [connectionA, connectionB] = await fixture.db
      .insert(integrationConnections)
      .values([
        {
          id: "icn_put_bindings_service_001",
          organizationId: authenticatedSession.organizationId,
          targetKey: "openai-default-put-bindings-service",
          displayName: "Service Connection A",
          config: {
            auth_scheme: "api-key",
          },
        },
        {
          id: "icn_put_bindings_service_002",
          organizationId: authenticatedSession.organizationId,
          targetKey: "openai-default-put-bindings-service",
          displayName: "Service Connection B",
          config: {
            auth_scheme: "api-key",
          },
        },
      ])
      .returning();

    if (connectionA === undefined || connectionB === undefined) {
      throw new Error("Expected integration connections to be inserted.");
    }

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_service_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "PUT Bindings Profile",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_service_001",
      version: 2,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_put_bindings_existing_001",
        sandboxProfileId: "sbp_put_bindings_service_001",
        sandboxProfileVersion: 2,
        connectionId: connectionA.id,
        kind: IntegrationBindingKinds.AGENT,
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "medium",
        },
      },
      {
        id: "ibd_put_bindings_existing_002",
        sandboxProfileId: "sbp_put_bindings_service_001",
        sandboxProfileVersion: 2,
        connectionId: connectionA.id,
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          connector: "legacy",
        },
      },
    ]);

    const result = await putProfileVersionIntegrationBindings(
      {
        db: fixture.db,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_put_bindings_service_001",
        profileVersion: 2,
        bindings: [
          {
            id: "ibd_put_bindings_existing_001",
            connectionId: connectionB.id,
            kind: IntegrationBindingKinds.AGENT,
            config: {
              runtime: "codex-cli",
              defaultModel: "gpt-5.3-codex",
              reasoningEffort: "medium",
            },
          },
          {
            connectionId: connectionA.id,
            kind: IntegrationBindingKinds.AGENT,
            config: {
              runtime: "codex-cli",
              defaultModel: "gpt-5.3-codex-spark",
              reasoningEffort: "high",
            },
          },
        ],
      },
    );

    expect(result.bindings).toHaveLength(2);

    const updatedBinding = result.bindings.find(
      (binding) => binding.id === "ibd_put_bindings_existing_001",
    );
    expect(updatedBinding).toBeDefined();
    expect(updatedBinding?.connectionId).toBe(connectionB.id);
    expect(updatedBinding?.kind).toBe(IntegrationBindingKinds.AGENT);
    expect(updatedBinding?.config).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });

    const insertedBinding = result.bindings.find(
      (binding) =>
        binding.id !== "ibd_put_bindings_existing_001" && binding.connectionId === connectionA.id,
    );
    expect(insertedBinding).toBeDefined();
    expect(insertedBinding?.id).not.toBe("");
    expect(insertedBinding?.kind).toBe(IntegrationBindingKinds.AGENT);
    expect(insertedBinding?.config).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5.3-codex-spark",
      reasoningEffort: "high",
    });

    const deletedBinding =
      await fixture.db.query.sandboxProfileVersionIntegrationBindings.findFirst({
        where: (table, { eq }) => eq(table.id, "ibd_put_bindings_existing_002"),
      });
    expect(deletedBinding).toBeUndefined();
  });

  it("throws not found when sandbox profile is missing", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-missing-profile@example.com",
    });

    await expect(
      putProfileVersionIntegrationBindings(
        {
          db: fixture.db,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_put_bindings_missing_profile",
          profileVersion: 1,
          bindings: [],
        },
      ),
    ).rejects.toMatchObject({
      code: SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
    });
  });

  it("throws not found when sandbox profile version is missing", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_missing_version_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Missing Version",
      status: IntegrationConnectionStatuses.ACTIVE,
    });

    await expect(
      putProfileVersionIntegrationBindings(
        {
          db: fixture.db,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_put_bindings_missing_version_001",
          profileVersion: 3,
          bindings: [],
        },
      ),
    ).rejects.toMatchObject({
      code: SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
    });
  });

  it("throws bad request when binding references inaccessible connection", async ({ fixture }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-connection-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-connection-org-b@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default-connection-reference",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
          binding_capabilities: createOpenAiRawBindingCapabilities(),
        },
      })
      .onConflictDoNothing();

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_connection_reference_001",
      organizationId: firstOrgSession.organizationId,
      displayName: "Connection Reference",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_connection_reference_001",
      version: 1,
    });

    const [secondOrgConnection] = await fixture.db
      .insert(integrationConnections)
      .values({
        id: "icn_put_bindings_other_org_001",
        organizationId: secondOrgSession.organizationId,
        targetKey: "openai-default-connection-reference",
        displayName: "Other Org Connection",
        config: {
          auth_scheme: "api-key",
        },
      })
      .returning();

    if (secondOrgConnection === undefined) {
      throw new Error("Expected second-organization connection to be inserted.");
    }

    await expect(
      putProfileVersionIntegrationBindings(
        {
          db: fixture.db,
        },
        {
          organizationId: firstOrgSession.organizationId,
          profileId: "sbp_put_bindings_connection_reference_001",
          profileVersion: 1,
          bindings: [
            {
              connectionId: secondOrgConnection.id,
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: "codex-cli",
                defaultModel: "gpt-5.3-codex",
                reasoningEffort: "medium",
              },
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      code: SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONNECTION_REFERENCE,
    });
  });

  it("throws bad request when request references non-existent binding id", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-invalid-binding-id@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default-binding-reference",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
          binding_capabilities: createOpenAiRawBindingCapabilities(),
        },
      })
      .onConflictDoNothing();
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_invalid_binding_reference_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Invalid Binding Reference",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_invalid_binding_reference_001",
      version: 1,
    });

    const [connection] = await fixture.db
      .insert(integrationConnections)
      .values({
        id: "icn_put_bindings_valid_reference_001",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default-binding-reference",
        displayName: "Valid Reference Connection",
        config: {
          auth_scheme: "api-key",
        },
      })
      .returning();

    if (connection === undefined) {
      throw new Error("Expected connection to be inserted.");
    }

    await expect(
      putProfileVersionIntegrationBindings(
        {
          db: fixture.db,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_put_bindings_invalid_binding_reference_001",
          profileVersion: 1,
          bindings: [
            {
              id: "ibd_non_existent",
              connectionId: connection.id,
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: "codex-cli",
                defaultModel: "gpt-5.3-codex",
                reasoningEffort: "medium",
              },
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      code: SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_REFERENCE,
    });
  });

  it("accepts a github binding when the selected repositories are accessible in the synced snapshot", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-github-accessible@example.com",
    });

    await insertGitHubBindingValidationFixture({
      fixture,
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_put_bindings_github_accessible_001",
      profileVersion: 1,
      connectionId: "icn_put_bindings_github_accessible_001",
      targetKey: "github-cloud-put-bindings-accessible",
    });

    await fixture.db.insert(integrationConnectionResourceStates).values({
      connectionId: "icn_put_bindings_github_accessible_001",
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.READY,
      totalCount: 2,
      lastSyncedAt: "2026-03-09T10:00:00.000Z",
    });
    await fixture.db.insert(integrationConnectionResources).values([
      {
        id: "rsc_put_bindings_github_accessible_001",
        connectionId: "icn_put_bindings_github_accessible_001",
        familyId: "github",
        kind: "repository",
        handle: "mistlehq/mistle",
        displayName: "mistlehq/mistle",
        metadata: {
          visibility: "private",
        },
        lastSeenAt: "2026-03-09T10:00:00.000Z",
      },
      {
        id: "rsc_put_bindings_github_accessible_002",
        connectionId: "icn_put_bindings_github_accessible_001",
        familyId: "github",
        kind: "repository",
        handle: "mistlehq/platform",
        displayName: "mistlehq/platform",
        metadata: {
          visibility: "private",
        },
        lastSeenAt: "2026-03-09T10:00:00.000Z",
      },
    ]);

    const result = await putProfileVersionIntegrationBindings(
      {
        db: fixture.db,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_put_bindings_github_accessible_001",
        profileVersion: 1,
        bindings: [
          {
            connectionId: "icn_put_bindings_github_accessible_001",
            kind: IntegrationBindingKinds.GIT,
            config: {
              repositories: ["mistlehq/mistle", "mistlehq/platform"],
            },
          },
        ],
      },
    );

    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]?.config).toEqual({
      repositories: ["mistlehq/mistle", "mistlehq/platform"],
    });
  });

  it("rejects a github binding when the selected repositories are not accessible in the synced snapshot", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-github-unavailable@example.com",
    });

    await insertGitHubBindingValidationFixture({
      fixture,
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_put_bindings_github_unavailable_001",
      profileVersion: 1,
      connectionId: "icn_put_bindings_github_unavailable_001",
      targetKey: "github-cloud-put-bindings-unavailable",
    });

    await fixture.db.insert(integrationConnectionResourceStates).values({
      connectionId: "icn_put_bindings_github_unavailable_001",
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.READY,
      totalCount: 1,
      lastSyncedAt: "2026-03-09T10:00:00.000Z",
    });
    await fixture.db.insert(integrationConnectionResources).values({
      id: "rsc_put_bindings_github_unavailable_001",
      connectionId: "icn_put_bindings_github_unavailable_001",
      familyId: "github",
      kind: "repository",
      handle: "mistlehq/mistle",
      displayName: "mistlehq/mistle",
      metadata: {
        visibility: "private",
      },
      lastSeenAt: "2026-03-09T10:00:00.000Z",
    });

    await expect(
      putProfileVersionIntegrationBindings(
        {
          db: fixture.db,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_put_bindings_github_unavailable_001",
          profileVersion: 1,
          bindings: [
            {
              clientRef: "draft-github-binding",
              connectionId: "icn_put_bindings_github_unavailable_001",
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: ["mistlehq/private-repo"],
              },
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      code: SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE,
      details: {
        issues: [
          {
            clientRef: "draft-github-binding",
            validatorCode: "system.inaccessible_resource_reference",
            field: "repositories",
            safeMessage:
              "Selected repository 'mistlehq/private-repo' is no longer accessible for this connection.",
          },
        ],
      },
    });
  });

  it("rejects a github binding when repository sync has not produced a usable snapshot yet", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-github-never-synced@example.com",
    });

    await insertGitHubBindingValidationFixture({
      fixture,
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_put_bindings_github_never_synced_001",
      profileVersion: 1,
      connectionId: "icn_put_bindings_github_never_synced_001",
      targetKey: "github-cloud-put-bindings-never-synced",
    });

    await expect(
      putProfileVersionIntegrationBindings(
        {
          db: fixture.db,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_put_bindings_github_never_synced_001",
          profileVersion: 1,
          bindings: [
            {
              connectionId: "icn_put_bindings_github_never_synced_001",
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: ["mistlehq/mistle"],
              },
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      code: SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE,
      details: {
        issues: [
          {
            validatorCode: "system.resource_sync_required",
            field: "repositories",
            safeMessage:
              "Resource sync is required before repositories can be selected for this connection.",
          },
        ],
      },
    });
  });
});

async function insertGitHubBindingValidationFixture(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  profileId: string;
  profileVersion: number;
  connectionId: string;
  targetKey: string;
}): Promise<void> {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoNothing();

  await input.fixture.db.insert(sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: "GitHub Binding Validation",
    status: IntegrationConnectionStatuses.ACTIVE,
  });
  await input.fixture.db.insert(sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: input.profileVersion,
  });
  await input.fixture.db.insert(integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    displayName: "GitHub Connection",
    config: {
      auth_scheme: "api-key",
    },
  });
}
