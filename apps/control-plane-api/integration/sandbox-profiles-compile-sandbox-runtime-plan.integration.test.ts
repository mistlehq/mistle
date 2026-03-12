import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import {
  createIntegrationRegistry,
  createOpenAiRawBindingCapabilities,
} from "@mistle/integrations-definitions";
import { describe, expect } from "vitest";

import {
  compileSandboxRuntimePlan,
  SandboxRuntimePlanCompilerErrorCodes,
} from "../src/sandbox-profiles/services/compile-sandbox-runtime-plan.js";
import { it } from "./test-context.js";

const integrationRegistry = createIntegrationRegistry();

describe("sandbox profile internal runtime plan compiler integration", () => {
  it("fails when the resolved target secrets omit an existing target entry", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-internal-missing-target-secrets@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_internal_missing_target_secrets_entry",
      organizationId: authenticatedSession.organizationId,
      displayName: "Missing Target Secrets Entry Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_internal_missing_target_secrets_entry",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default-internal-missing-target-secrets-entry",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
          binding_capabilities: createOpenAiRawBindingCapabilities(),
        },
      })
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values({
      id: "icn_compile_internal_missing_target_secrets_entry",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-default-internal-missing-target-secrets-entry",
      displayName: "Missing Secrets Entry Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
      },
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_internal_missing_target_secrets_entry",
      sandboxProfileId: "sbp_compile_internal_missing_target_secrets_entry",
      sandboxProfileVersion: 1,
      connectionId: "icn_compile_internal_missing_target_secrets_entry",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
      },
    });

    await expect(
      compileSandboxRuntimePlan({
        db: fixture.db,
        integrationRegistry,
        resolveTargetSecrets: async () => [],
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_internal_missing_target_secrets_entry",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      }),
    ).rejects.toMatchObject({
      code: SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS,
    });
  });
});
