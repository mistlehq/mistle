/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { putSandboxProfileVersionMaintenanceScriptResponseSchema } from "../src/sandbox-profiles/schemas.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profile version maintenance script integration", () => {
  it("updates and clears a version maintenance script", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-maintenance-script@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_maintenance_script_001",
        organizationId: session.organizationId,
        displayName: "Maintenance Script Profile",
        activeVersion: 1,
        createdAt: "2026-05-15T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_maintenance_script_001",
        version: 1,
      }),
    );

    const updateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_maintenance_script_001/versions/1/maintenance-script",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          maintenanceScript: "echo maintain",
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    expect(
      putSandboxProfileVersionMaintenanceScriptResponseSchema.parse(await updateResponse.json()),
    ).toEqual({
      sandboxProfileId: "sbp_maintenance_script_001",
      version: 1,
      maintenanceScript: "echo maintain",
    });

    const clearResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_maintenance_script_001/versions/1/maintenance-script",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          maintenanceScript: null,
        }),
      },
    );

    expect(clearResponse.status).toBe(200);
    expect(
      putSandboxProfileVersionMaintenanceScriptResponseSchema.parse(await clearResponse.json()),
    ).toEqual({
      sandboxProfileId: "sbp_maintenance_script_001",
      version: 1,
      maintenanceScript: null,
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        maintenanceScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_maintenance_script_001"), eq(table.version, 1)),
    });
    expect(persistedVersion?.maintenanceScript).toBeNull();
  });
});
