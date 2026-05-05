/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { getLocalPreparedRuntimeSandboxBaseImageRef } from "@mistle/config";
import { IntegrationBindingKinds, IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createDefinitionsBundle } from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  compileSandboxRuntimePlan,
  SandboxRuntimePlanCompilerErrorCodes,
} from "../src/sandbox-profiles/services/compile-sandbox-runtime-plan.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const Definitions = createDefinitionsBundle();
const LocalPreparedRuntimeSandboxBaseImageRef = getLocalPreparedRuntimeSandboxBaseImageRef();

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profile internal runtime plan compiler integration", () => {
  it("fails when resolved target secrets omit an existing target entry", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-compile-internal-missing-target-secrets@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_compile_internal_missing_target_secrets_entry",
        organizationId: session.organizationId,
        displayName: "Missing Target Secrets Entry Profile",
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_compile_internal_missing_target_secrets_entry",
        version: 1,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-default-internal-missing-target-secrets-entry",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_compile_internal_missing_target_secrets_entry",
        organizationId: session.organizationId,
        targetKey: "openai-default-internal-missing-target-secrets-entry",
        displayName: "Missing Secrets Entry Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_compile_internal_missing_target_secrets_entry",
          sandboxProfileId: "sbp_compile_internal_missing_target_secrets_entry",
          sandboxProfileVersion: 1,
          connectionId: "icn_compile_internal_missing_target_secrets_entry",
          kind: IntegrationBindingKinds.AGENT,
          config: {
            runtime: {
              runtimeId: "codex",
              config: {},
            },
          },
        }),
      );

    await expect(
      compileSandboxRuntimePlan({
        db: env.controlPlaneDb,
        integrationDefinitions: Definitions,
        resolveTargetSecrets: async () => [],
        organizationId: session.organizationId,
        profileId: "sbp_compile_internal_missing_target_secrets_entry",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: LocalPreparedRuntimeSandboxBaseImageRef,
        },
      }),
    ).rejects.toMatchObject({
      code: SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS,
    });
  });
});
