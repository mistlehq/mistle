import type {
  RuntimeArtifactCommand,
  RuntimeArtifactLifecycleBuilder,
  RuntimeArtifactRefs,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileOpenAiApiKeyBinding } from "./compile-binding.js";

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
      targetKey: "openai_default",
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
      targetKey: "openai_default",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.openai.com/v1",
        },
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
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/v1"],
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
    expect(installCommands?.[0]?.args[1]).toContain('"installPath":"/usr/local/bin/codex"');
    expect(installCommands?.[0]?.timeoutMs).toBe(120_000);

    const updateCommands = resolveArtifactLifecycleHook(codexArtifact?.lifecycle.update);
    expect(updateCommands).toEqual(installCommands);

    expect(resolveArtifactLifecycleHook(codexArtifact?.lifecycle.remove)).toEqual([
      {
        args: ["rm", "-f", "/usr/local/bin/codex"],
      },
    ]);

    expect(compiled.runtimeClientSetups).toHaveLength(1);
    expect(compiled.runtimeClientSetups[0]?.env).toEqual({
      OPENAI_BASE_URL: {
        kind: "egress_url",
        routeId: "route_ibd_123",
      },
      OPENAI_MODEL: "gpt-5.3-codex",
      OPENAI_REASONING_EFFORT: "medium",
    });
    expect(compiled.runtimeClientSetups[0]?.files[0]?.fileId).toBe("codex_config");
    expect(compiled.runtimeClientSetups[0]?.files[0]?.path).toBe("/workspace/.codex/config.toml");
    expect(compiled.runtimeClientSetups[0]?.files[0]?.content).not.toContain("base_url =");
    expect(compiled.runtimeClientSetups[0]?.files[0]?.content).not.toContain(
      "[model_providers.openai]",
    );
  });

  it("uses target base-url host and path for custom upstreams", () => {
    const compiled = compileOpenAiApiKeyBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "openai_proxy",
      target: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://proxy.example.com/openai-v2",
        },
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
          reasoningEffort: "high",
        },
      },
      refs: {
        egressUrl: {
          kind: "egress_url",
          routeId: "route_ibd_123",
        },
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://sandboxd.internal/egress/",
      },
    });

    expect(compiled.egressRoutes[0]?.match.hosts).toEqual(["proxy.example.com"]);
    expect(compiled.egressRoutes[0]?.match.pathPrefixes).toEqual(["/openai-v2"]);
    expect(compiled.runtimeClientSetups[0]?.env.OPENAI_BASE_URL).toEqual({
      kind: "egress_url",
      routeId: "route_ibd_123",
    });
  });
});
