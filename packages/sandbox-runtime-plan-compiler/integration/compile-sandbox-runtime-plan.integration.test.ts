import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizations,
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
  type CompileSandboxRuntimePlanInput,
} from "../src/index.js";
import { it } from "./test-context.js";

const integrationRegistry = createIntegrationRegistry();

function createCompileInput(input: {
  organizationId: string;
  profileId: string;
  profileVersion: number;
}): Pick<
  CompileSandboxRuntimePlanInput,
  "organizationId" | "profileId" | "profileVersion" | "image"
> {
  return {
    organizationId: input.organizationId,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    image: {
      source: "base",
      imageRef: "mistle/sandbox-base:dev",
    },
  };
}

describe("compileSandboxRuntimePlan integration", () => {
  it("compiles runtime plan for a valid profile version", async ({ fixture }) => {
    await fixture.db.insert(organizations).values({
      id: "org_srpc_compile_success",
      name: "Sandbox Runtime Plan Compiler Success",
      slug: "sandbox-runtime-plan-compiler-success",
    });
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_srpc_compile_success",
      organizationId: "org_srpc_compile_success",
      displayName: "Compile Success Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_srpc_compile_success",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-srpc-success",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_srpc_compile_success",
      organizationId: "org_srpc_compile_success",
      targetKey: "openai-default-srpc-success",
      displayName: "SRPC Compile Success Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
      },
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_srpc_compile_success",
      sandboxProfileId: "sbp_srpc_compile_success",
      sandboxProfileVersion: 1,
      connectionId: "icn_srpc_compile_success",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
      },
    });

    const runtimePlan = await compileSandboxRuntimePlan({
      db: fixture.db,
      integrationRegistry,
      resolveTargetSecrets: async ({ targets }) =>
        targets.map((target) => ({
          targetKey: target.targetKey,
          secrets: {},
        })),
      ...createCompileInput({
        organizationId: "org_srpc_compile_success",
        profileId: "sbp_srpc_compile_success",
        profileVersion: 1,
      }),
    });

    expect(runtimePlan.sandboxProfileId).toBe("sbp_srpc_compile_success");
    expect(runtimePlan.version).toBe(1);
    expect(runtimePlan.runtimeClients).toHaveLength(1);
    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.egressRoutes[0]?.routeId).toBe("route_ibd_srpc_compile_success");
    expect(runtimePlan.runtimeClients[0]?.setup.env.OPENAI_BASE_URL).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("fails when sandbox profile does not exist", async ({ fixture }) => {
    await expect(
      compileSandboxRuntimePlan({
        db: fixture.db,
        integrationRegistry,
        resolveTargetSecrets: async () => [],
        ...createCompileInput({
          organizationId: "org_srpc_missing_profile",
          profileId: "sbp_srpc_missing_profile",
          profileVersion: 1,
        }),
      }),
    ).rejects.toMatchObject({
      code: SandboxRuntimePlanCompilerErrorCodes.PROFILE_NOT_FOUND,
    });
  });

  it("fails when sandbox profile version does not exist", async ({ fixture }) => {
    await fixture.db.insert(organizations).values({
      id: "org_srpc_missing_version",
      name: "Sandbox Runtime Plan Compiler Missing Version",
      slug: "sandbox-runtime-plan-compiler-missing-version",
    });
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_srpc_missing_version",
      organizationId: "org_srpc_missing_version",
      displayName: "Missing Version Profile",
      status: "active",
    });

    await expect(
      compileSandboxRuntimePlan({
        db: fixture.db,
        integrationRegistry,
        resolveTargetSecrets: async () => [],
        ...createCompileInput({
          organizationId: "org_srpc_missing_version",
          profileId: "sbp_srpc_missing_version",
          profileVersion: 9,
        }),
      }),
    ).rejects.toMatchObject({
      code: SandboxRuntimePlanCompilerErrorCodes.PROFILE_VERSION_NOT_FOUND,
    });
  });

  it("fails when a binding references a connection from another organization", async ({
    fixture,
  }) => {
    await fixture.db.insert(organizations).values([
      {
        id: "org_srpc_binding_scope_owner",
        name: "Sandbox Runtime Plan Compiler Binding Owner",
        slug: "sandbox-runtime-plan-compiler-binding-owner",
      },
      {
        id: "org_srpc_binding_scope_foreign",
        name: "Sandbox Runtime Plan Compiler Binding Foreign",
        slug: "sandbox-runtime-plan-compiler-binding-foreign",
      },
    ]);
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_srpc_missing_connection",
      organizationId: "org_srpc_binding_scope_owner",
      displayName: "Missing Connection Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_srpc_missing_connection",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-srpc-missing-connection",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_srpc_foreign_connection",
      organizationId: "org_srpc_binding_scope_foreign",
      targetKey: "openai-default-srpc-missing-connection",
      displayName: "SRPC Foreign Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_srpc_missing_connection",
      sandboxProfileId: "sbp_srpc_missing_connection",
      sandboxProfileVersion: 1,
      connectionId: "icn_srpc_foreign_connection",
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
        resolveTargetSecrets: async ({ targets }) =>
          targets.map((target) => ({
            targetKey: target.targetKey,
            secrets: {},
          })),
        ...createCompileInput({
          organizationId: "org_srpc_binding_scope_owner",
          profileId: "sbp_srpc_missing_connection",
          profileVersion: 1,
        }),
      }),
    ).rejects.toMatchObject({
      code: SandboxRuntimePlanCompilerErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE,
    });
  });

  it("fails when the resolved target secrets omit an existing target entry", async ({
    fixture,
  }) => {
    await fixture.db.insert(organizations).values({
      id: "org_srpc_missing_target_secrets_entry",
      name: "Sandbox Runtime Plan Compiler Missing Target Secrets Entry",
      slug: "sandbox-runtime-plan-compiler-missing-target-secrets-entry",
    });
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_srpc_missing_target_secrets_entry",
      organizationId: "org_srpc_missing_target_secrets_entry",
      displayName: "Missing Target Secrets Entry Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_srpc_missing_target_secrets_entry",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-srpc-missing-target-secrets-entry",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_srpc_missing_target_secrets_entry",
      organizationId: "org_srpc_missing_target_secrets_entry",
      targetKey: "openai-default-srpc-missing-target-secrets-entry",
      displayName: "SRPC Missing Secrets Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
      },
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_srpc_missing_target_secrets_entry",
      sandboxProfileId: "sbp_srpc_missing_target_secrets_entry",
      sandboxProfileVersion: 1,
      connectionId: "icn_srpc_missing_target_secrets_entry",
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
        ...createCompileInput({
          organizationId: "org_srpc_missing_target_secrets_entry",
          profileId: "sbp_srpc_missing_target_secrets_entry",
          profileVersion: 1,
        }),
      }),
    ).rejects.toMatchObject({
      code: SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS,
    });
  });
});
