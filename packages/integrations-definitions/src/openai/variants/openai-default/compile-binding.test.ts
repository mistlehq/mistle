import type {
  RuntimeArtifactCommand,
  RuntimeArtifactLifecycleBuilder,
  RuntimeArtifactRefs,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileOpenAiApiKeyBinding } from "./compile-binding.js";
import { createOpenAiRawBindingCapabilities } from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

const OpenAiApiKeyConnectionMethod = "api-key" as const;
const RuntimeArtifactBinDirectory = "/var/lib/mistle/bin";
const SandboxPaths = {
  userHomeDir: "/home/sandbox",
  userProjectsDir: "/home/sandbox/projects",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: RuntimeArtifactBinDirectory,
} as const;

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
    sandboxPaths: SandboxPaths,
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
          connection_method: OpenAiApiKeyConnectionMethod,
        },
      },
      binding: {
        id: "ibd_123",
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.4",
          reasoningEffort: "medium",
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST"],
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
    expect(installCommands?.[0]?.args[1]).toContain('"installPath":"/var/lib/mistle/bin/codex"');
    expect(installCommands?.[0]?.timeoutMs).toBe(120_000);

    const updateCommands = resolveArtifactLifecycleHook(codexArtifact?.lifecycle.update);
    expect(updateCommands).toEqual(installCommands);

    expect(resolveArtifactLifecycleHook(codexArtifact?.lifecycle.remove)).toEqual([
      {
        args: ["rm", "-f", "/var/lib/mistle/bin/codex"],
      },
    ]);

    expect(compiled.runtimeClients).toHaveLength(1);
    expect(compiled.runtimeClients[0]?.setup.env).toEqual({
      OPENAI_MODEL: "gpt-5.4",
      OPENAI_REASONING_EFFORT: "medium",
    });
    expect(compiled.runtimeClients[0]?.setup.files).toHaveLength(1);
    expect(compiled.runtimeClients[0]?.setup.files[0]).toMatchObject({
      fileId: "codex_config",
      path: "/etc/codex/config.toml",
      mode: 384,
    });
    const configContent = compiled.runtimeClients[0]?.setup.files[0]?.content;
    expect(configContent).toContain('model = "gpt-5.4"');
    expect(configContent).toContain('model_provider = "proxy"');
    expect(configContent).toContain('model_reasoning_effort = "medium"');
    expect(configContent).toContain('approval_policy = "never"');
    expect(configContent).toContain('sandbox_mode = "danger-full-access"');
    expect(configContent).toContain("[model_providers.proxy]");
    expect(configContent).toContain('name = "Proxy"');
    expect(configContent).toContain('base_url = "https://api.openai.com/v1"');
    expect(configContent).toContain('wire_api = "responses"');
    expect(configContent).toContain("requires_openai_auth = false");
    expect(configContent).toContain("supports_websockets = false");
    expect(configContent).toContain('trust_level = "trusted"');
    expect(configContent).not.toContain("developer_instructions");
    expect(configContent).not.toContain("openai_base_url");
    expect(compiled.runtimeClients[0]?.processes).toEqual([
      {
        processKey: "codex-app-server",
        command: {
          args: ["/var/lib/mistle/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4500"],
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
        adapterKey: "openai-codex",
      },
    ]);
  });

  it("renders additional instructions into codex developer_instructions", () => {
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
          connection_method: OpenAiApiKeyConnectionMethod,
        },
      },
      binding: {
        id: "ibd_123",
        kind: "agent",
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-5.3-codex",
          reasoningEffort: "medium",
          additionalInstructions: "Prefer concise answers.\nAlways explain tradeoffs.",
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    const configContent = compiled.runtimeClients[0]?.setup.files[0]?.content;
    expect(configContent).toContain("developer_instructions");
    expect(configContent).toContain("Prefer concise answers.");
    expect(configContent).toContain("Always explain tradeoffs.");
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
          connection_method: OpenAiApiKeyConnectionMethod,
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
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes[0]?.match.hosts).toEqual(["proxy.example.com"]);
    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/"]);
    expect(compiled.egressRoutes[0]?.match.methods).toEqual(["GET", "POST"]);
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain(
      'base_url = "https://proxy.example.com/openai-v2"',
    );
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
          connection_method: OpenAiApiKeyConnectionMethod,
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
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/"]);
  });

  it("fails fast when connection connection_method is missing", () => {
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
          sandboxPaths: SandboxPaths,
          artifactBinPath,
        },
      }),
    ).toThrow();
  });
});
