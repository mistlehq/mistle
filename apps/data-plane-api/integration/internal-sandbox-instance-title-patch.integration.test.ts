/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxInstancePurposes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  DATA_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_SANDBOX_ROUTE_BASE_PATH,
} from "../src/internal/index.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

describe.concurrent("internal sandbox instance title patch integration", () => {
  it("patches a sandbox instance title for the matching organization", async ({ env }) => {
    await insertSandboxInstance(env, {
      id: "sbi_dp_api_title_patch_matching_org",
      organizationId: "org_dp_api_title_patch_matching_org",
      title: null,
    });

    const response = await patchSandboxTitle({
      env,
      sandboxInstanceId: "sbi_dp_api_title_patch_matching_org",
      body: {
        organizationId: "org_dp_api_title_patch_matching_org",
        title: "Renamed from integration-new",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_dp_api_title_patch_matching_org",
      title: "Renamed from integration-new",
      updatedAt: expect.any(String),
    });

    await expect(readSandboxTitle(env, "sbi_dp_api_title_patch_matching_org")).resolves.toBe(
      "Renamed from integration-new",
    );
  });

  it("only writes generated titles when the current title is unset", async ({ env }) => {
    await insertSandboxInstance(env, {
      id: "sbi_dp_api_title_patch_if_unset_empty",
      organizationId: "org_dp_api_title_patch_if_unset",
      title: null,
    });
    await insertSandboxInstance(env, {
      id: "sbi_dp_api_title_patch_if_unset_existing",
      organizationId: "org_dp_api_title_patch_if_unset",
      title: "Manual title",
    });

    const emptyResponse = await patchSandboxTitle({
      env,
      sandboxInstanceId: "sbi_dp_api_title_patch_if_unset_empty",
      body: {
        onlyIfUnset: true,
        organizationId: "org_dp_api_title_patch_if_unset",
        title: "Generated title",
      },
    });
    expect(emptyResponse.status).toBe(200);
    await expect(emptyResponse.json()).resolves.toMatchObject({
      id: "sbi_dp_api_title_patch_if_unset_empty",
      title: "Generated title",
    });

    const existingResponse = await patchSandboxTitle({
      env,
      sandboxInstanceId: "sbi_dp_api_title_patch_if_unset_existing",
      body: {
        onlyIfUnset: true,
        organizationId: "org_dp_api_title_patch_if_unset",
        title: "Generated title",
      },
    });
    expect(existingResponse.status).toBe(200);
    await expect(existingResponse.json()).resolves.toMatchObject({
      id: "sbi_dp_api_title_patch_if_unset_existing",
      title: "Manual title",
    });

    await expect(readSandboxTitle(env, "sbi_dp_api_title_patch_if_unset_empty")).resolves.toBe(
      "Generated title",
    );
    await expect(readSandboxTitle(env, "sbi_dp_api_title_patch_if_unset_existing")).resolves.toBe(
      "Manual title",
    );
  });

  it("does not patch instances outside the requested organization", async ({ env }) => {
    await insertSandboxInstance(env, {
      id: "sbi_dp_api_title_patch_other_org",
      organizationId: "org_dp_api_title_patch_other_org",
      title: "Existing title",
    });

    const response = await patchSandboxTitle({
      env,
      sandboxInstanceId: "sbi_dp_api_title_patch_other_org",
      body: {
        organizationId: "org_dp_api_title_patch_requesting_org",
        title: "Should not be written",
      },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Sandbox instance 'sbi_dp_api_title_patch_other_org' was not found.",
    });
    await expect(readSandboxTitle(env, "sbi_dp_api_title_patch_other_org")).resolves.toBe(
      "Existing title",
    );
  });

  it("does not patch setup-check instances", async ({ env }) => {
    await insertSandboxInstance(env, {
      id: "sbi_dp_api_title_patch_setup_check",
      organizationId: "org_dp_api_title_patch_setup_check",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      title: "Setup check title",
    });

    const response = await patchSandboxTitle({
      env,
      sandboxInstanceId: "sbi_dp_api_title_patch_setup_check",
      body: {
        organizationId: "org_dp_api_title_patch_setup_check",
        title: "Should not be written",
      },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Sandbox instance 'sbi_dp_api_title_patch_setup_check' was not found.",
    });
    await expect(readSandboxTitle(env, "sbi_dp_api_title_patch_setup_check")).resolves.toBe(
      "Setup check title",
    );
  });

  it("rejects blank titles", async ({ env }) => {
    const response = await patchSandboxTitle({
      env,
      sandboxInstanceId: "sbi_dp_api_title_patch_validation",
      body: {
        organizationId: "org_dp_api_title_patch_validation",
        title: "   ",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    id: string;
    organizationId: string;
    purpose?: typeof SandboxInstancePurposes.SESSION | typeof SandboxInstancePurposes.SETUP_CHECK;
    title: string | null;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.id,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_dp_api_title_patch",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.id}`,
    status: SandboxInstanceStatuses.RUNNING,
    startedByKind: "user",
    startedById: "usr_dp_api_title_patch",
    source: "dashboard",
    purpose: input.purpose ?? SandboxInstancePurposes.SESSION,
    title: input.title,
  });
}

function patchSandboxTitle(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  body: {
    onlyIfUnset?: boolean;
    organizationId: string;
    title: string;
  };
}) {
  return input.env.dataPlaneApi.http.fetch(
    `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/${input.sandboxInstanceId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [DATA_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
      },
      body: JSON.stringify(input.body),
    },
  );
}

async function readSandboxTitle(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<string | null> {
  const sandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      title: true,
    },
    where: (table, { eq }) => eq(table.id, sandboxInstanceId),
  });
  if (sandboxInstance === undefined) {
    throw new Error(`Expected sandbox instance '${sandboxInstanceId}' to exist.`);
  }

  return sandboxInstance.title;
}
