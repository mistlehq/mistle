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
import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { describe, expect } from "vitest";

import { compileProfileVersionRuntimePlan } from "../src/sandbox-profiles/services/compile-profile-version-runtime-plan.js";
import {
  SandboxProfilesCompileError,
  SandboxProfilesCompileErrorCodes,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../src/sandbox-profiles/services/errors.js";
import { it } from "./test-context.js";

describe("sandbox profile compile runtime plan integration", () => {
  it("compiles runtime plan from version bindings, connections, and targets", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-success@example.com",
    });
    const targetKey = "openai-default-compile-runtime-plan";

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_success",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Success Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_success",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
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
      id: "icn_compile_success",
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Compile Success Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
      },
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_success",
      sandboxProfileId: "sbp_compile_success",
      sandboxProfileVersion: 1,
      connectionId: "icn_compile_success",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
        additionalInstructions: "Prefer concise answers.\nAlways explain tradeoffs.",
      },
    });

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_success",
        profileVersion: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
      },
    );

    expect(runtimePlan.sandboxProfileId).toBe("sbp_compile_success");
    expect(runtimePlan.version).toBe(1);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.artifacts[0]?.artifactKey).toBe("codex-cli");
    expect(runtimePlan.artifacts[0]?.name).toBe("Codex CLI");

    const installCommand = runtimePlan.artifacts[0]?.lifecycle.install[0];
    expect(installCommand?.args.slice(0, 2)).toEqual(["sh", "-euc"]);
    expect(installCommand?.timeoutMs).toBe(120_000);

    const updateCommand = runtimePlan.artifacts[0]?.lifecycle.update?.[0];
    expect(updateCommand?.args.slice(0, 2)).toEqual(["sh", "-euc"]);
    expect(updateCommand?.timeoutMs).toBe(120_000);

    expect(runtimePlan.artifacts[0]?.lifecycle.remove).toEqual([
      { args: ["rm", "-f", "/workspace/.mistle/bin/codex"] },
    ]);

    const installScript = installCommand?.args[2];
    expect(typeof installScript).toBe("string");
    expect(installScript).toContain("repo=openai/codex");
    expect(installScript).toContain("releases/latest/download/$asset_name");
    expect(installScript).toContain("codex-x86_64-unknown-linux-musl.tar.gz");
    expect(installScript).toContain("codex-aarch64-unknown-linux-musl.tar.gz");
    expect(installScript).toContain("/workspace/.mistle/bin/codex");
    expect(runtimePlan.runtimeClients).toEqual([
      {
        clientId: "codex-cli",
        setup: {
          env: {
            OPENAI_BASE_URL: "https://api.openai.com/v1",
            OPENAI_MODEL: "gpt-5.3-codex",
            OPENAI_REASONING_EFFORT: "medium",
          },
          files: [
            {
              fileId: "codex_config",
              path: "/home/sandbox/.codex/config.toml",
              mode: 384,
              content: `model = "gpt-5.3-codex"
model_reasoning_effort = "medium"
developer_instructions = "Prefer concise answers.\\nAlways explain tradeoffs."

[projects."/"]
trust_level = "trusted"
`,
            },
          ],
        },
        processes: [
          {
            processKey: "codex-app-server",
            command: {
              args: [
                "/workspace/.mistle/bin/codex",
                "app-server",
                "--listen",
                "ws://127.0.0.1:4500",
              ],
            },
            readiness: {
              type: "ws",
              url: "ws://127.0.0.1:4500",
              timeoutMs: 5_000,
            },
            stop: {
              signal: "sigterm",
              timeoutMs: 10_000,
              gracePeriodMs: 2_000,
            },
          },
        ],
        endpoints: [
          {
            endpointKey: "app-server",
            processKey: "codex-app-server",
            transport: {
              type: "ws",
              url: "ws://127.0.0.1:4500",
            },
            connectionMode: "dedicated",
          },
        ],
      },
    ]);
  });

  it("returns profile not found when the sandbox profile does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-profile@example.com",
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
          integrationsConfig: fixture.config.integrations,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_profile",
          profileVersion: 1,
          image: {
            source: "base",
            imageRef: "mistle/sandbox-base:dev",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesNotFoundError);

      if (error instanceof SandboxProfilesNotFoundError) {
        expect(error.code).toBe(SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND);
      }
    }
  });

  it("returns profile version not found when the version does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_missing_version",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Missing Version Profile",
      status: "active",
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
          integrationsConfig: fixture.config.integrations,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_version",
          profileVersion: 9,
          image: {
            source: "base",
            imageRef: "mistle/sandbox-base:dev",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesNotFoundError);

      if (error instanceof SandboxProfilesNotFoundError) {
        expect(error.code).toBe(SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND);
      }
    }
  });

  it("fails when a binding references a connection from another organization", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-connection@example.com",
    });
    const inaccessibleConnectionSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-connection-foreign-org@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_missing_connection",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Missing Connection Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_missing_connection",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default-missing-connection",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
        },
      })
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values({
      id: "icn_missing",
      organizationId: inaccessibleConnectionSession.organizationId,
      targetKey: "openai-default-missing-connection",
      displayName: "Foreign Compile Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_missing_connection",
      sandboxProfileId: "sbp_compile_missing_connection",
      sandboxProfileVersion: 1,
      connectionId: "icn_missing",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
      },
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
          integrationsConfig: fixture.config.integrations,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_connection",
          profileVersion: 1,
          image: {
            source: "base",
            imageRef: "mistle/sandbox-base:dev",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesCompileError);

      if (error instanceof SandboxProfilesCompileError) {
        expect(error.code).toBe(
          SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        );
      }
    }
  });

  it("fails when a target has invalid encrypted secrets", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-invalid-target-secrets@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_invalid_target_secrets",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Invalid Target Secrets Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_invalid_target_secrets",
      version: 1,
    });
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default-invalid-target-secrets",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
        },
        secrets: {
          masterKeyVersion: 999,
          nonce: "invalid",
          ciphertext: "invalid",
        },
      })
      .onConflictDoNothing();
    await fixture.db.insert(integrationConnections).values({
      id: "icn_compile_invalid_target_secrets",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-default-invalid-target-secrets",
      displayName: "Invalid Secrets Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_invalid_target_secrets",
      sandboxProfileId: "sbp_compile_invalid_target_secrets",
      sandboxProfileVersion: 1,
      connectionId: "icn_compile_invalid_target_secrets",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
      },
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
          integrationsConfig: fixture.config.integrations,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_invalid_target_secrets",
          profileVersion: 1,
          image: {
            source: "base",
            imageRef: "mistle/sandbox-base:dev",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesCompileError);

      if (error instanceof SandboxProfilesCompileError) {
        expect(error.code).toBe(SandboxProfilesCompileErrorCodes.INVALID_TARGET_SECRETS);
      }
    }
  });
});
