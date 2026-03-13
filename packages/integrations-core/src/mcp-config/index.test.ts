import { describe, expect, it } from "vitest";

import { IntegrationCompilerError } from "../errors/index.js";
import type { CompiledRuntimeClient, ResolvedIntegrationMcpServer } from "../types/index.js";
import { applyMcpConfigToRuntimeClients } from "./index.js";

function createRuntimeClient(input: {
  clientId: string;
  fileId: string;
  path: string;
  content: string;
}): CompiledRuntimeClient {
  return {
    clientId: input.clientId,
    setup: {
      env: {},
      files: [
        {
          fileId: input.fileId,
          path: input.path,
          mode: 384,
          content: input.content,
        },
      ],
    },
    processes: [],
    endpoints: [],
  };
}

function createLinearMcpServer(): ResolvedIntegrationMcpServer {
  return {
    source: {
      bindingId: "bind_linear_connector",
      connectionId: "conn_linear_org_123",
      targetKey: "linear-default",
      familyId: "linear",
      variantId: "linear-default",
    },
    server: {
      serverId: "linear-default",
      serverName: "linear",
      transport: "streamable-http",
      url: "https://mcp.linear.app/mcp",
      httpHeaders: {
        Authorization: "Bearer test-token",
      },
    },
  };
}

describe("applyMcpConfigToRuntimeClients", () => {
  it("replaces the configured toml path with generated MCP config", () => {
    const runtimeClients = applyMcpConfigToRuntimeClients({
      runtimeClients: [
        createRuntimeClient({
          clientId: "codex-cli",
          fileId: "codex_config",
          path: "/etc/codex/config.toml",
          content: `model = "gpt-5-codex"

[projects."/"]
trust_level = "trusted"
`,
        }),
      ],
      mcpConfig: {
        clientId: "codex-cli",
        fileId: "codex_config",
        format: "toml",
        path: ["mcp_servers"],
      },
      mcpServers: [createLinearMcpServer()],
    });

    expect(runtimeClients[0]?.setup.files[0]?.content).toContain("[mcp_servers.linear]");
    expect(runtimeClients[0]?.setup.files[0]?.content).toContain(
      'url = "https://mcp.linear.app/mcp"',
    );
    expect(runtimeClients[0]?.setup.files[0]?.content).toContain(
      "[mcp_servers.linear.http_headers]",
    );
  });

  it("replaces the configured json path with generated MCP config", () => {
    const runtimeClients = applyMcpConfigToRuntimeClients({
      runtimeClients: [
        createRuntimeClient({
          clientId: "claude-code",
          fileId: "claude_config",
          path: "/home/sandbox/.claude/settings.json",
          content: `{
  "theme": "dark"
}
`,
        }),
      ],
      mcpConfig: {
        clientId: "claude-code",
        fileId: "claude_config",
        format: "json",
        path: ["mcpServers"],
      },
      mcpServers: [createLinearMcpServer()],
    });

    expect(runtimeClients[0]?.setup.files[0]?.content).toContain('"theme": "dark"');
    expect(runtimeClients[0]?.setup.files[0]?.content).toContain('"mcpServers"');
    expect(runtimeClients[0]?.setup.files[0]?.content).toContain('"httpHeaders"');
  });

  it("fails when the configured target file is missing", () => {
    expect(() =>
      applyMcpConfigToRuntimeClients({
        runtimeClients: [
          createRuntimeClient({
            clientId: "codex-cli",
            fileId: "different_file",
            path: "/etc/codex/config.toml",
            content: 'model = "gpt-5-codex"\n',
          }),
        ],
        mcpConfig: {
          clientId: "codex-cli",
          fileId: "codex_config",
          format: "toml",
          path: ["mcp_servers"],
        },
        mcpServers: [createLinearMcpServer()],
      }),
    ).toThrowError(IntegrationCompilerError);
  });
});
