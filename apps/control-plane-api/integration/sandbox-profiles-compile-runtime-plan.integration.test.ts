import {
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import {
  type CompileBindingInput,
  IntegrationKinds,
  IntegrationRegistry,
  IntegrationSupportedAuthSchemes,
} from "@mistle/integrations-core";
import { describe, expect } from "vitest";
import { z } from "zod";

import { compileProfileVersionRuntimePlan } from "../src/sandbox-profiles/services/compile-profile-version-runtime-plan.js";
import {
  SandboxProfilesCompileError,
  SandboxProfilesCompileErrorCodes,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../src/sandbox-profiles/services/errors.js";
import { it } from "./test-context.js";

function createCompileRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();

  const targetConfigSchema = z
    .object({
      apiBaseUrl: z.url(),
    })
    .strict();
  const bindingConfigSchema = z
    .object({
      defaultModel: z.string().min(1),
    })
    .strict();

  registry.register({
    familyId: "openai",
    variantId: "openai-api-key",
    kind: IntegrationKinds.AGENT,
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema,
    bindingConfigSchema,
    supportedAuthSchemes: [IntegrationSupportedAuthSchemes.API_KEY],
    triggerEventTypes: [],
    compileBinding: (
      input: CompileBindingInput<{ apiBaseUrl: string }, { defaultModel: string }>,
    ) => ({
      egressRoutes: [
        {
          routeId: `route_${input.binding.id}`,
          bindingId: input.binding.id,
          match: {
            hosts: ["api.openai.com"],
            pathPrefixes: ["/v1"],
            methods: ["POST"],
          },
          upstream: {
            baseUrl: input.target.config.apiBaseUrl,
          },
          authInjection: {
            type: "bearer",
            target: "authorization",
          },
          credentialResolver: {
            connectionId: input.connection.id,
            secretType: "api_key",
          },
        },
      ],
      artifacts: [],
      runtimeClientSetups: [
        {
          clientId: "codex-cli",
          env: {
            OPENAI_BASE_URL: input.target.config.apiBaseUrl,
            OPENAI_MODEL: input.binding.config.defaultModel,
          },
          files: [],
        },
      ],
    }),
  });

  return registry;
}

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
        apiBaseUrl: "https://api.openai.com",
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
        defaultModel: "gpt-5.3-codex",
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
        registry: createCompileRegistry(),
      },
    );

    expect(runtimePlan.sandboxProfileId).toBe("sbp_compile_success");
    expect(runtimePlan.version).toBe(1);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.runtimeClientSetups).toEqual([
      {
        clientId: "codex-cli",
        env: {
          OPENAI_BASE_URL: "https://api.openai.com",
          OPENAI_MODEL: "gpt-5.3-codex",
        },
        files: [],
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
          registry: createCompileRegistry(),
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
          registry: createCompileRegistry(),
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
        defaultModel: "gpt-5.3-codex",
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
          registry: createCompileRegistry(),
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
        defaultModel: "gpt-5.3-codex",
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
          registry: createCompileRegistry(),
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
