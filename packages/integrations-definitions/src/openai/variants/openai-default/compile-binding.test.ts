import type {
  IntegrationSupportedAuthScheme,
  RuntimeArtifactCommand,
  RuntimeArtifactLifecycleBuilder,
  RuntimeArtifactRefs,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileOpenAiApiKeyBinding } from "./compile-binding.js";
import { createOpenAiRawBindingCapabilities } from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

const OpenAiApiKeyAuthScheme: IntegrationSupportedAuthScheme = "api-key";
const RuntimeArtifactBinDirectory = "/workspace/.mistle/bin";

function artifactBinPath(name: string): string {
  return `${RuntimeArtifactBinDirectory}/${name}`;
}

function createOpenAiTargetConfig(apiBaseUrl: string) {
  return OpenAiApiKeyTargetConfigSchema.parse({
    api_base_url: apiBaseUrl,
    binding_capabilities: createOpenAiRawBindingCapabilities(),
  });
}

function createRuntimeArtifactRefs(): RuntimeArtifactRefs {
  const exec = (input: RuntimeArtifactCommand): RuntimeArtifactCommand => ({
    args: [...input.args],
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });

  return {
    command: {
      exec,
    },
    artifactBinPath,
    mise: {
      install: (input) =>
        exec({
          args: ["mise", "install", ...(input.force === true ? ["--force"] : []), ...input.tools],
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        }),
    },
    githubReleases: {
      installLatestBinary: (input) =>
        exec({
          args: ["github-releases.installLatestBinary", JSON.stringify(input)],
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        }),
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai-default",
      bindingId: "ibd_123",
    },
  };
}

function resolveArtifactLifecycleHook(
  hook: ReadonlyArray<RuntimeArtifactCommand> | RuntimeArtifactLifecycleBuilder | undefined,
): ReadonlyArray<RuntimeArtifactCommand> | undefined {
  if (hook === undefined) {
    return undefined;
  }

  if (typeof hook === "function") {
    return hook({ refs: createRuntimeArtifactRefs() });
  }

  return hook;
}

describe("compileOpenAiApiKeyBinding", () => {
  it("builds expected egress route and codex runtime setup", () => {
    const compiled = compileOpenAiApiKeyBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai-default",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        secrets: {},
        config: createOpenAiTargetConfig("https://api.openai.com/v1"),
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          auth_scheme: OpenAiApiKeyAuthScheme,
        },
      },
      binding: {
        id: "ibd_123",
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "medium",
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
        artifactBinPath,
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/"],
          methods: ["POST"],
        },
        upstream: {
          baseUrl: "https://api.openai.com/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "api_key",
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const codexArtifact = compiled.artifacts[0];
    expect(codexArtifact?.artifactKey).toBe("codex-cli");
    expect(codexArtifact?.name).toBe("Codex CLI");
    const installCommands = resolveArtifactLifecycleHook(codexArtifact?.lifecycle.install);
    expect(installCommands).toHaveLength(1);
    expect(installCommands?.[0]?.args[0]).toBe("github-releases.installLatestBinary");
    expect(installCommands?.[0]?.args[1]).toContain('"repository":"openai/codex"');
    expect(installCommands?.[0]?.args[1]).toContain(
      '"fileName":"codex-x86_64-unknown-linux-musl.tar.gz"',
    );
    expect(installCommands?.[0]?.args[1]).toContain(
      '"fileName":"codex-aarch64-unknown-linux-musl.tar.gz"',
    );
    expect(installCommands?.[0]?.args[1]).toContain('"installPath":"/workspace/.mistle/bin/codex"');
    expect(installCommands?.[0]?.timeoutMs).toBe(120_000);

    const updateCommands = resolveArtifactLifecycleHook(codexArtifact?.lifecycle.update);
    expect(updateCommands).toEqual(installCommands);

    expect(resolveArtifactLifecycleHook(codexArtifact?.lifecycle.remove)).toEqual([
      {
        args: ["rm", "-f", "/workspace/.mistle/bin/codex"],
      },
    ]);

    expect(compiled.runtimeClients).toHaveLength(1);
    expect(compiled.runtimeClients[0]?.setup.env).toEqual({
      OPENAI_BASE_URL: {
        kind: "egress_url",
        routeId: "route_ibd_123",
      },
      OPENAI_MODEL: "gpt-5.3-codex",
      OPENAI_REASONING_EFFORT: "medium",
    });
    expect(compiled.runtimeClients[0]?.setup.files).toEqual([
      {
        fileId: "codex_config",
        path: "/home/sandbox/.codex/config.toml",
        mode: 384,
        content: `model = "gpt-5.3-codex"
model_reasoning_effort = "medium"

[projects."/"]
trust_level = "trusted"
`,
      },
    ]);
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).not.toContain("base_url =");
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).not.toContain(
      "[model_providers.openai]",
    );
    expect(compiled.runtimeClients[0]?.processes).toEqual([
      {
        processKey: "codex-app-server",
        command: {
          args: ["/workspace/.mistle/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4500"],
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
    ]);
    expect(compiled.runtimeClients[0]?.endpoints).toEqual([
      {
        endpointKey: "app-server",
        processKey: "codex-app-server",
        transport: {
          type: "ws",
          url: "ws://127.0.0.1:4500",
        },
        connectionMode: "dedicated",
      },
    ]);
    expect(compiled.agentRuntimes).toEqual([
      {
        runtimeKey: "codex-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server",
      },
    ]);
  });

  it("uses target base-url host and path for custom upstreams", () => {
    const compiled = compileOpenAiApiKeyBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai-proxy",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        secrets: {},
        config: createOpenAiTargetConfig("https://proxy.example.com/openai-v2"),
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          auth_scheme: OpenAiApiKeyAuthScheme,
        },
      },
      binding: {
        id: "ibd_123",
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "high",
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
        artifactBinPath,
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress/",
      },
    });

    expect(compiled.egressRoutes[0]?.match.hosts).toEqual(["proxy.example.com"]);
    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/"]);
    expect(compiled.runtimeClients[0]?.setup.env.OPENAI_BASE_URL).toEqual({
      kind: "egress_url",
      routeId: "route_ibd_123",
    });
    expect(compiled.runtimeClients[0]?.processes).toHaveLength(1);
    expect(compiled.runtimeClients[0]?.processes[0]?.processKey).toBe("codex-app-server");
  });

  it("uses '/' as the route path prefix for root API base urls", () => {
    const compiled = compileOpenAiApiKeyBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai-default",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        secrets: {},
        config: createOpenAiTargetConfig("https://api.openai.com"),
      },
      connection: {
        id: "icn_123",
        status: "active",
        config: {
          auth_scheme: OpenAiApiKeyAuthScheme,
        },
      },
      binding: {
        id: "ibd_123",
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "medium",
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
        artifactBinPath,
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/"]);
  });

  it("fails fast when connection auth_scheme is missing", () => {
    expect(() =>
      compileOpenAiApiKeyBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "openai-default",
        target: {
          familyId: "openai",
          variantId: "openai-default",
          enabled: true,
          secrets: {},
          config: createOpenAiTargetConfig("https://api.openai.com/v1"),
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {},
        },
        binding: {
          id: "ibd_123",
          kind: "agent",
          config: {
            runtime: "codex-cli",
            defaultModel: "gpt-5.3-codex",
            reasoningEffort: "medium",
          },
        },
        refs: {
          egressUrl: {
            kind: "egress_url",
            routeId: "route_ibd_123",
          },
          artifactBinPath,
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
        },
      }),
    ).toThrowError();
  });
});
