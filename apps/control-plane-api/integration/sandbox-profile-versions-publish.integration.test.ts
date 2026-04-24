import {
  integrationConnections,
  integrationTargets,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  PublishSandboxProfileVersionConflictResponseSchema,
  PublishSandboxProfileVersionNotFoundResponseSchema,
  PublishSandboxProfileVersionResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createIntegrationConnectionFixture,
  createIntegrationTargetFixture,
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
  createSandboxProfileVersionIntegrationBindingFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profile versions publish integration", () => {
  it("publishes a draft version and makes it active", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publish@example.com",
    });

    await fixture.db.insert(integrationTargets).values(
      createIntegrationTargetFixture({
        targetKey: "openai-version-publish-valid",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await fixture.db.insert(integrationConnections).values(
      createIntegrationConnectionFixture({
        id: "icn_version_publish_valid",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-version-publish-valid",
        displayName: "Publish Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_publish_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Publish Profile",
        activeVersion: 1,
        createdAt: "2026-03-18T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_publish_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-18T00:01:00.000Z",
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_publish_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values(
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_version_publish_valid",
        sandboxProfileId: "sbp_version_publish_001",
        sandboxProfileVersion: 2,
        connectionId: "icn_version_publish_valid",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_publish_001/versions/2/publish",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PublishSandboxProfileVersionResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      version: {
        sandboxProfileId: "sbp_version_publish_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        isActive: true,
      },
      activeVersion: 2,
    });

    const persistedVersion = await fixture.db.query.sandboxProfileVersions.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_version_publish_001"), eq(table.version, 2)),
    });
    expect(persistedVersion?.state).toBe(SandboxProfileVersionStates.PUBLISHED);
    expect(persistedVersion?.publishedAt).not.toBeNull();

    const persistedProfile = await fixture.db.query.sandboxProfiles.findFirst({
      columns: {
        activeVersion: true,
      },
      where: (table, { eq }) => eq(table.id, "sbp_version_publish_001"),
    });
    expect(persistedProfile?.activeVersion).toBe(2);
  }, 60_000);

  it("returns 409 when the selected version is not a draft", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publish-not-draft@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_publish_not_draft_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Publish Not Draft Profile",
        activeVersion: 1,
        createdAt: "2026-03-19T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_publish_not_draft_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-19T00:01:00.000Z",
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_publish_not_draft_001/versions/1/publish",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PublishSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_DRAFT");
  }, 60_000);

  it("returns 409 when the draft is not publishable", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publish-not-publishable@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_publish_not_publishable_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Publishability Failure Profile",
        activeVersion: null,
        createdAt: "2026-03-20T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_publish_not_publishable_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_publish_not_publishable_001/versions/1/publish",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PublishSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_PUBLISHABLE");
  }, 60_000);

  it("returns 404 when the version does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publish-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_publish_missing_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Missing Publish Version Profile",
        activeVersion: null,
        createdAt: "2026-03-21T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_publish_missing_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_publish_missing_001/versions/2/publish",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = PublishSandboxProfileVersionNotFoundResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  }, 60_000);
});
