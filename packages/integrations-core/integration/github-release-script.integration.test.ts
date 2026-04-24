import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AgentRuntimeRegistry } from "../src/agent-runtimes/index.js";
import { compileRuntimePlan } from "../src/compiler/index.js";
import { IntegrationRegistry } from "../src/registry/index.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationDefinition,
  type RuntimeArtifactInstallStep,
} from "../src/types/index.js";

const EmptyTargetConfigSchema = z.object({});
const EmptyTargetSecretsSchema = z.object({});
const EmptyBindingConfigSchema = z.object({});
const LocalDevDockerRegistrySandboxBaseImageRef = getLocalDevDockerRegistrySandboxBaseImageRef();

const InstallPath = "/tmp/jq";
const ApiKeyConnectionMethods = [
  {
    id: IntegrationConnectionMethodIds.API_KEY,
    label: "API key",
    kind: "form",
    secretFields: [
      {
        name: "apiKey",
        label: "API key",
        inputType: "password",
        secretType: "api_key",
        slotKey: "test.github-release.api-key.api-key",
      },
    ],
  },
] as const;

function expectTypedInstallStep(
  entry: RuntimeArtifactInstallStep | undefined,
): RuntimeArtifactInstallStep {
  if (entry === undefined) {
    throw new Error("Expected artifact install step.");
  }

  return entry;
}

function createDefinitionsBundle(registry: IntegrationRegistry) {
  return {
    integrationRegistry: registry,
    agentRuntimeRegistry: new AgentRuntimeRegistry(),
  };
}

function createGithubBinaryInstallDefinition(): IntegrationDefinition<
  typeof EmptyTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof EmptyBindingConfigSchema
> {
  return {
    familyId: "test",
    variantId: "github-releases-install-binary",
    kind: "connector",
    displayName: "Test",
    logoKey: "test",
    targetConfigSchema: EmptyTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: EmptyBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "jq",
          name: "jq",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.install({
                repository: "jqlang/jq",
                release: {
                  kind: "latest",
                },
                asset: {
                  kind: "by_arch",
                  x86_64: {
                    fileName: "jq-linux-amd64",
                    format: "binary",
                  },
                  aarch64: {
                    fileName: "jq-linux-arm64",
                    format: "binary",
                  },
                },
                installPath: InstallPath,
                timeoutMs: 120_000,
              }),
            ],
          },
        },
      ],
      runtimeClients: [],
    }),
  };
}

function createTaggedGithubBinaryInstallDefinition(): IntegrationDefinition<
  typeof EmptyTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof EmptyBindingConfigSchema
> {
  return {
    familyId: "test",
    variantId: "github-releases-install-tagged-binary",
    kind: "connector",
    displayName: "Test",
    logoKey: "test",
    targetConfigSchema: EmptyTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: EmptyBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "jq",
          name: "jq",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.install({
                repository: "jqlang/jq",
                release: {
                  kind: "tag",
                  match: "latest_matching_prefix",
                  prefix: "jq-",
                },
                asset: {
                  kind: "exact",
                  fileName: "jq-linux-amd64",
                  format: "binary",
                },
                installPath: InstallPath,
                timeoutMs: 120_000,
              }),
            ],
          },
        },
      ],
      runtimeClients: [],
    }),
  };
}

describe("github release helper integration", () => {
  it("compiles canonical GitHub release install refs for latest releases into typed artifact ops", () => {
    const registry = new IntegrationRegistry();
    registry.register(createGithubBinaryInstallDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      image: {
        source: "base",
        imageRef: LocalDevDockerRegistrySandboxBaseImageRef,
      },
      definitions: createDefinitionsBundle(registry),
      bindings: [
        {
          targetKey: "test_target",
          target: {
            familyId: "test",
            variantId: "github-releases-install-binary",
            enabled: true,
            config: {},
            secrets: {},
          },
          connection: {
            id: "conn_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_123",
            kind: "connector",
            connectionId: "conn_123",
            config: {},
          },
        },
      ],
    });

    expect(expectTypedInstallStep(runtimePlan.artifacts[0]?.lifecycle.install[0])).toEqual({
      op: "github_release_install",
      repository: "jqlang/jq",
      release: {
        kind: "latest",
      },
      asset: {
        kind: "by_arch",
        x86_64: {
          fileName: "jq-linux-amd64",
          format: "binary",
        },
        aarch64: {
          fileName: "jq-linux-arm64",
          format: "binary",
        },
      },
      installPath: InstallPath,
      timeoutMs: 120_000,
    });
  });

  it("compiles canonical GitHub release install refs for matching tag prefixes into typed artifact ops", () => {
    const registry = new IntegrationRegistry();
    registry.register(createTaggedGithubBinaryInstallDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      image: {
        source: "base",
        imageRef: LocalDevDockerRegistrySandboxBaseImageRef,
      },
      definitions: createDefinitionsBundle(registry),
      bindings: [
        {
          targetKey: "test_target",
          target: {
            familyId: "test",
            variantId: "github-releases-install-tagged-binary",
            enabled: true,
            config: {},
            secrets: {},
          },
          connection: {
            id: "conn_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_123",
            kind: "connector",
            connectionId: "conn_123",
            config: {},
          },
        },
      ],
    });

    expect(expectTypedInstallStep(runtimePlan.artifacts[0]?.lifecycle.install[0])).toEqual({
      op: "github_release_install",
      repository: "jqlang/jq",
      release: {
        kind: "tag",
        match: "latest_matching_prefix",
        prefix: "jq-",
      },
      asset: {
        kind: "exact",
        fileName: "jq-linux-amd64",
        format: "binary",
      },
      installPath: InstallPath,
      timeoutMs: 120_000,
    });
  });
});
