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
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_compile_success",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-default",
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
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
      },
    );

    expect(runtimePlan.sandboxProfileId).toBe("sbp_compile_success");
    expect(runtimePlan.version).toBe(1);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.artifacts[0]).toMatchObject({
      artifactKey: "codex-cli",
      name: "Codex CLI",
      lifecycle: {
        install: [{ args: ["sh", "-euc"], timeoutMs: 120_000 }],
        update: [{ args: ["sh", "-euc"], timeoutMs: 120_000 }],
        remove: [{ args: ["rm", "-f", "/usr/local/bin/codex"] }],
      },
    });

    const installScript = runtimePlan.artifacts[0]?.lifecycle.install[0]?.args[2];
    expect(typeof installScript).toBe("string");
    expect(installScript).toContain("https://github.com/openai/codex/releases/latest/download");
    expect(installScript).toContain("codex-x86_64-unknown-linux-musl.tar.gz");
    expect(installScript).toContain("codex-aarch64-unknown-linux-musl.tar.gz");
    expect(installScript).toContain("/usr/local/bin/codex");
    expect(runtimePlan.runtimeClientSetups).toEqual([
      {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "http://sandboxd.internal/egress/routes/route_ibd_compile_success",
          OPENAI_MODEL: "gpt-5.3-codex",
          OPENAI_REASONING_EFFORT: "medium",
        },
        files: [
          {
            fileId: "codex_config",
            path: "/workspace/.codex/config.toml",
            mode: 384,
            content: `model = "gpt-5.3-codex"
model_reasoning_effort = "medium"
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
            sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
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
            sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
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
            sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
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
            sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
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
