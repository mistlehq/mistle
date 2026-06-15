import {
  applyMcpConfigToRuntimeClients,
  type AnyAgentRuntimeDefinition,
  type CompileAgentRuntimeResult,
  type EgressCredentialRoute,
  type ResolvedIntegrationMcpServer,
  type RuntimeClient,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createAgentRuntimeServerRegistry } from "../registry/agent-runtimes.server.js";

function createMistleMcpServer(): ResolvedIntegrationMcpServer {
  return {
    source: {
      kind: "mistle",
    },
    server: {
      serverId: "mistle",
      serverName: "mistle",
      transport: "streamable-http",
      url: "https://mcp.example.test/mcp",
    },
  };
}

function createIntegrationMcpServer(): ResolvedIntegrationMcpServer {
  return {
    source: {
      kind: "integration",
      bindingId: "bind_remote",
      connectionId: "conn_remote",
      targetKey: "remote",
      familyId: "remote",
      variantId: "remote",
    },
    server: {
      serverId: "remote",
      serverName: "remote-http",
      transport: "streamable-http",
      url: "https://remote-mcp.example.test/mcp",
      httpHeaders: {
        Authorization: "Bearer mistle-managed-credential",
      },
    },
  };
}

function createAnthropicRoute(): EgressCredentialRoute {
  return {
    egressRuleId: "egr_anthropic",
    bindingId: "bnd_anthropic",
    familyId: "anthropic",
    variantId: "anthropic-default",
    match: {
      hosts: ["api.anthropic.com"],
      methods: ["GET", "POST"],
      pathPrefixes: ["/v1"],
    },
    upstream: {
      baseUrl: "https://api.anthropic.com",
    },
    authInjection: {
      type: "header",
      target: "x-api-key",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: "conn_anthropic",
      secretType: "api_key",
    },
  };
}

function createRuntimeEgressRoutes(): ReadonlyArray<EgressCredentialRoute> {
  return [createAnthropicRoute()];
}

function compileRuntime(
  runtimeDefinition: AnyAgentRuntimeDefinition,
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>,
): CompileAgentRuntimeResult {
  return runtimeDefinition.compileRuntime({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    runtimeId: runtimeDefinition.runtimeId,
    runtimeConfig: runtimeDefinition.configSchema.parse({}),
    mcpServers,
    refs: {
      sandboxPaths: {
        userHomeDir: "/root",
        workspaceDir: "/root",
        runtimeDataDir: "/var/lib/mistle",
        runtimeArtifactDir: "/var/lib/mistle/artifacts",
        runtimeArtifactBinDir: "/usr/local/bin",
      },
      artifactBinPath: (artifactName) => `/usr/local/bin/${artifactName}`,
    },
  });
}

function renderRuntimeClients(compiled: CompileAgentRuntimeResult): ReadonlyArray<RuntimeClient> {
  if (compiled.renderRuntimeClients !== undefined) {
    return compiled.renderRuntimeClients({
      egressRoutes: createRuntimeEgressRoutes(),
    });
  }

  if (compiled.runtimeClients === undefined) {
    throw new Error("Expected runtime clients or runtime client renderer.");
  }

  return compiled.runtimeClients;
}

function materializeRuntimeClients(input: {
  runtimeDefinition: AnyAgentRuntimeDefinition;
  runtimeClients: ReadonlyArray<RuntimeClient>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<RuntimeClient> {
  let runtimeClients = input.runtimeClients;

  for (const mcpConfig of input.runtimeDefinition.materializeMcpConfig?.() ?? []) {
    runtimeClients = applyMcpConfigToRuntimeClients({
      runtimeClients,
      mcpConfig,
      mcpServers: input.mcpServers,
    });
  }

  return runtimeClients;
}

function expectRuntimeSetupContainsMcpServer(input: {
  runtimeDefinition: AnyAgentRuntimeDefinition;
  mcpServer: ResolvedIntegrationMcpServer;
}): void {
  const compiled = compileRuntime(input.runtimeDefinition, [input.mcpServer]);
  const renderedClients = renderRuntimeClients(compiled);
  const runtimeClients = materializeRuntimeClients({
    runtimeDefinition: input.runtimeDefinition,
    runtimeClients: renderedClients,
    mcpServers: [input.mcpServer],
  });
  const setupContent = runtimeClients
    .flatMap((runtimeClient) => runtimeClient.setup.files)
    .map((file) => file.content)
    .join("\n");

  expect(setupContent).toContain(input.mcpServer.server.serverName);
  expect(setupContent).toContain(input.mcpServer.server.url);
}

describe("agent runtime MCP compatibility", () => {
  const runtimeDefinitions = createAgentRuntimeServerRegistry().listRuntimes();

  it.each(runtimeDefinitions)("compiles $runtimeId with no MCP servers", (runtimeDefinition) => {
    const compiled = compileRuntime(runtimeDefinition, []);
    const runtimeClients = renderRuntimeClients(compiled);

    expect(runtimeClients.length).toBeGreaterThan(0);
  });

  it.each(runtimeDefinitions)("wires Mistle MCP into $runtimeId setup", (runtimeDefinition) => {
    expectRuntimeSetupContainsMcpServer({
      runtimeDefinition,
      mcpServer: createMistleMcpServer(),
    });
  });

  it.each(runtimeDefinitions)("wires provider MCP into $runtimeId setup", (runtimeDefinition) => {
    expectRuntimeSetupContainsMcpServer({
      runtimeDefinition,
      mcpServer: createIntegrationMcpServer(),
    });
  });
});
