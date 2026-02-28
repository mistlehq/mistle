import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
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

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_success",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Success Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_success",
      version: 1,
      manifest: {},
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai_default",
      familyId: "openai",
      variantId: "openai-api-key",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_compile_success",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai_default",
      status: IntegrationConnectionStatuses.ACTIVE,
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
      },
    });

    const runtimePlan = await compileProfileVersionRuntimePlan(
      {
        db: fixture.db,
      },
      {
        organizationId: authenticatedSession.organizationId,
        profileId: "sbp_compile_success",
        profileVersion: 1,
        image: {
          source: "default-base",
          imageRef: "mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxProvider: "docker",
          sandboxdEgressBaseUrl: "http://sandboxd.internal",
        },
      },
    );

    expect(runtimePlan.sandboxProfileId).toBe("sbp_compile_success");
    expect(runtimePlan.version).toBe(1);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.runtimeClientSetups).toEqual([
      {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://api.openai.com/v1",
          OPENAI_MODEL: "gpt-5.3-codex",
          OPENAI_REASONING_EFFORT: "medium",
        },
        files: [
          {
            path: "/workspace/.codex/config.toml",
            mode: 384,
            content: `model = "gpt-5.3-codex"
model_reasoning_effort = "medium"
model_provider = "openai"

[model_providers.openai]
name = "OpenAI"
base_url = "https://api.openai.com/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
`,
          },
        ],
      },
    ]);
  }, 60_000);

  it("returns profile not found when the sandbox profile does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-profile@example.com",
    });

    try {
      await compileProfileVersionRuntimePlan(
        {
          db: fixture.db,
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_profile",
          profileVersion: 1,
          image: {
            source: "default-base",
            imageRef: "mistle/sandbox-base:dev",
          },
          runtimeContext: {
            sandboxProvider: "docker",
            sandboxdEgressBaseUrl: "http://sandboxd.internal",
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
  }, 60_000);

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
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_version",
          profileVersion: 9,
          image: {
            source: "default-base",
            imageRef: "mistle/sandbox-base:dev",
          },
          runtimeContext: {
            sandboxProvider: "docker",
            sandboxdEgressBaseUrl: "http://sandboxd.internal",
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
  }, 60_000);

  it("fails when a binding references a missing organization connection", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-connection@example.com",
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
      manifest: {},
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
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_connection",
          profileVersion: 1,
          image: {
            source: "default-base",
            imageRef: "mistle/sandbox-base:dev",
          },
          runtimeContext: {
            sandboxProvider: "docker",
            sandboxdEgressBaseUrl: "http://sandboxd.internal",
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
  }, 60_000);

  it("fails when a connection references a missing target", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-compile-missing-target@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_compile_missing_target",
      organizationId: authenticatedSession.organizationId,
      displayName: "Compile Missing Target Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_compile_missing_target",
      version: 1,
      manifest: {},
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_compile_missing_target",
      organizationId: authenticatedSession.organizationId,
      targetKey: "missing_target",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_compile_missing_target",
      sandboxProfileId: "sbp_compile_missing_target",
      sandboxProfileVersion: 1,
      connectionId: "icn_compile_missing_target",
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
        },
        {
          organizationId: authenticatedSession.organizationId,
          profileId: "sbp_compile_missing_target",
          profileVersion: 1,
          image: {
            source: "default-base",
            imageRef: "mistle/sandbox-base:dev",
          },
          runtimeContext: {
            sandboxProvider: "docker",
            sandboxdEgressBaseUrl: "http://sandboxd.internal",
          },
        },
      );
      throw new Error("Expected compileProfileVersionRuntimePlan to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxProfilesCompileError);

      if (error instanceof SandboxProfilesCompileError) {
        expect(error.code).toBe(
          SandboxProfilesCompileErrorCodes.INVALID_CONNECTION_TARGET_REFERENCE,
        );
      }
    }
  }, 60_000);
});
