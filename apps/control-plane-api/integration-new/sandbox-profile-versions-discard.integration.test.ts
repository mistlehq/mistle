/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  DiscardSandboxProfileVersionDraftConflictResponseSchema,
  DiscardSandboxProfileVersionDraftResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe("sandbox profile versions discard integration", () => {
  it("atomically deletes the draft version and reports that no draft remains", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-discard@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-version-discard",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_version_discard_agent",
        organizationId: session.organizationId,
        targetKey: "openai-version-discard",
        displayName: "Discard Agent Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_discard_001",
        organizationId: session.organizationId,
        displayName: "Discard Draft Profile",
        activeVersion: 1,
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_discard_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-24T00:01:00.000Z",
        setupScript: "echo published",
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_discard_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo draft",
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_version_discard_draft_agent",
          sandboxProfileId: "sbp_version_discard_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_version_discard_agent",
          kind: IntegrationBindingKinds.AGENT,
        }),
      );
    await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
      id: "sch_version_discard_refresh",
      organizationId: session.organizationId,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "Discard refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileSnapshotRefreshScheduleTargets)
      .values({
        scheduleId: "sch_version_discard_refresh",
        sandboxProfileId: "sbp_version_discard_001",
        sandboxProfileVersion: 2,
      });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_discard_001/versions/2/discard",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = DiscardSandboxProfileVersionDraftResponseSchema.parse(await response.json());
    expect(body).toEqual({
      discardedVersion: 2,
      hasDraft: false,
    });

    const discardedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_version_discard_001"), eq(table.version, 2)),
    });
    const activeVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_version_discard_001"), eq(table.version, 1)),
    });
    const draftBindings =
      await env.controlPlaneDb.query.sandboxProfileVersionIntegrationBindings.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, "sbp_version_discard_001"),
            eq(table.sandboxProfileVersion, 2),
          ),
      });
    const refreshSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_version_discard_refresh"),
    });

    expect(discardedVersion).toBeUndefined();
    expect(activeVersion?.state).toBe(SandboxProfileVersionStates.PUBLISHED);
    expect(draftBindings).toEqual([]);
    expect(refreshSchedule).toEqual(
      expect.objectContaining({
        enabled: false,
        nextScheduledAt: null,
      }),
    );
    expect(refreshSchedule?.deletedAt).not.toBeNull();
  });

  it("rejects discarding a published version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-discard-published@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_discard_published_001",
        organizationId: session.organizationId,
        displayName: "Discard Published Profile",
        activeVersion: 1,
        createdAt: "2026-04-24T01:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_discard_published_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-24T01:01:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_discard_published_001/versions/1/discard",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const body = DiscardSandboxProfileVersionDraftConflictResponseSchema.parse(
      await response.json(),
    );
    expect(body.code).toBe("PROFILE_VERSION_ACTIVE");
  });

  it("rejects discarding the only draft version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-discard-only-draft@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_discard_only_draft_001",
        organizationId: session.organizationId,
        displayName: "Discard Only Draft Profile",
        activeVersion: null,
        createdAt: "2026-04-24T02:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_discard_only_draft_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_discard_only_draft_001/versions/1/discard",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const body = DiscardSandboxProfileVersionDraftConflictResponseSchema.parse(
      await response.json(),
    );
    expect(body.code).toBe("DRAFT_ONLY_PROFILE_VERSION_CANNOT_BE_DISCARDED");

    const profile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      where: (table, { eq }) => eq(table.id, "sbp_version_discard_only_draft_001"),
    });
    const version = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_version_discard_only_draft_001"), eq(table.version, 1)),
    });

    expect(profile?.activeVersion).toBeNull();
    expect(version?.state).toBe(SandboxProfileVersionStates.DRAFT);
  });
});
