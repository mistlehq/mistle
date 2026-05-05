/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  SandboxProfileVersionDefaultPersistenceModes,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  PutSandboxProfileVersionPersistenceModeConflictResponseSchema,
  PutSandboxProfileVersionPersistenceModeNotFoundResponseSchema,
  PutSandboxProfileVersionPersistenceModeResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profile version persistence mode put integration", () => {
  it("updates a draft version without requiring organization persistent sandboxes to be enabled", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-persistence-mode@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_persistence_mode_001",
        organizationId: session.organizationId,
        displayName: "Persistence Mode Profile",
        createdAt: "2026-05-05T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_persistence_mode_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_persistence_mode_001/versions/1/persistence-mode",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionPersistenceModeResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      sandboxProfileId: "sbp_put_persistence_mode_001",
      version: 1,
      defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        defaultPersistenceMode: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_put_persistence_mode_001"), eq(table.version, 1)),
    });
    expect(persistedVersion?.defaultPersistenceMode).toBe(
      SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
    );
  });

  it("returns 409 without changing persistence mode when the selected version is published", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-persistence-mode-published@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_persistence_mode_published_001",
        organizationId: session.organizationId,
        displayName: "Published Persistence Mode Profile",
        activeVersion: 1,
        createdAt: "2026-05-05T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_persistence_mode_published_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_persistence_mode_published_001/versions/1/persistence-mode",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
        }),
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PutSandboxProfileVersionPersistenceModeConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_DRAFT");

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        defaultPersistenceMode: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.sandboxProfileId, "sbp_put_persistence_mode_published_001"),
          eq(table.version, 1),
        ),
    });
    expect(persistedVersion?.defaultPersistenceMode).toBe(
      SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
    );
  });

  it("returns 404 when the selected profile version does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-persistence-mode-missing@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_persistence_mode_missing_001",
        organizationId: session.organizationId,
        displayName: "Missing Persistence Mode Profile",
        createdAt: "2026-05-05T00:00:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_persistence_mode_missing_001/versions/2/persistence-mode",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
        }),
      },
    );

    expect(response.status).toBe(404);
    const responseBody = PutSandboxProfileVersionPersistenceModeNotFoundResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  });
});
