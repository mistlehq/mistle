import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompiledRuntimeClient,
  IntegrationMcpConfig,
  ResolvedIntegrationMcpServer,
} from "../types/index.js";

type McpConfigObject = {
  [key: string]: unknown;
};

function isMcpConfigObject(input: unknown): input is McpConfigObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function assertMcpConfigObject(input: unknown, message: string): McpConfigObject {
  if (!isMcpConfigObject(input)) {
    throw new IntegrationCompilerError(CompilerErrorCodes.MCP_CONFLICT, message);
  }

  return input;
}

function setObjectValueAtPath(input: {
  root: McpConfigObject;
  path: ReadonlyArray<string>;
  value: unknown;
  invalidPathMessage: string;
}): void {
  const [firstKey, ...remainingPath] = input.path;
  if (firstKey === undefined) {
    throw new IntegrationCompilerError(CompilerErrorCodes.MCP_CONFLICT, input.invalidPathMessage);
  }

  if (remainingPath.length === 0) {
    input.root[firstKey] = input.value;
    return;
  }

  const existingValue = input.root[firstKey];
  if (existingValue === undefined) {
    const nextValue: McpConfigObject = {};
    input.root[firstKey] = nextValue;
    setObjectValueAtPath({
      root: nextValue,
      path: remainingPath,
      value: input.value,
      invalidPathMessage: input.invalidPathMessage,
    });
    return;
  }

  if (!isMcpConfigObject(existingValue)) {
    throw new IntegrationCompilerError(CompilerErrorCodes.MCP_CONFLICT, input.invalidPathMessage);
  }

  setObjectValueAtPath({
    root: existingValue,
    path: remainingPath,
    value: input.value,
    invalidPathMessage: input.invalidPathMessage,
  });
}

function createMcpServerConfig(input: {
  server: ResolvedIntegrationMcpServer["server"];
  format: IntegrationMcpConfig["format"];
}): McpConfigObject {
  if (input.server.transport === "stdio") {
    const config: McpConfigObject = {};

    if (input.server.command !== undefined) {
      config.command = input.server.command;
    }

    if (input.server.args !== undefined) {
      config.args = [...input.server.args];
    }

    if (input.server.env !== undefined) {
      config.env = { ...input.server.env };
    }

    return config;
  }

  const config: McpConfigObject = {};

  if (input.server.url !== undefined) {
    config.url = input.server.url;
  }

  if (input.server.httpHeaders !== undefined) {
    config[input.format === "toml" ? "http_headers" : "httpHeaders"] = {
      ...input.server.httpHeaders,
    };
  }

  return config;
}

function createMcpConfigValue(input: {
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
  format: IntegrationMcpConfig["format"];
}): McpConfigObject {
  const mcpConfigValue: McpConfigObject = {};

  for (const mcpServer of input.mcpServers) {
    mcpConfigValue[mcpServer.server.serverName] = createMcpServerConfig({
      server: mcpServer.server,
      format: input.format,
    });
  }

  return mcpConfigValue;
}

function replaceJsonMcpConfig(input: {
  content: string;
  mcpConfig: IntegrationMcpConfig;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(input.content);
  } catch (error) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.MCP_CONFLICT,
      `MCP config target '${input.mcpConfig.fileId}' contains invalid JSON.`,
      { cause: error },
    );
  }

  const root = assertMcpConfigObject(
    parsedContent,
    `MCP config target '${input.mcpConfig.fileId}' must contain a JSON object.`,
  );

  setObjectValueAtPath({
    root,
    path: input.mcpConfig.path,
    value: createMcpConfigValue({
      mcpServers: input.mcpServers,
      format: input.mcpConfig.format,
    }),
    invalidPathMessage: `MCP config path '${input.mcpConfig.path.join(".")}' is not writable in '${input.mcpConfig.fileId}'.`,
  });

  return `${JSON.stringify(root, null, 2)}\n`;
}

function replaceTomlMcpConfig(input: {
  content: string;
  mcpConfig: IntegrationMcpConfig;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  let parsedContent: unknown;
  try {
    parsedContent = parseToml(input.content);
  } catch (error) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.MCP_CONFLICT,
      `MCP config target '${input.mcpConfig.fileId}' contains invalid TOML.`,
      { cause: error },
    );
  }

  const root = assertMcpConfigObject(
    parsedContent,
    `MCP config target '${input.mcpConfig.fileId}' must contain a TOML table.`,
  );

  setObjectValueAtPath({
    root,
    path: input.mcpConfig.path,
    value: createMcpConfigValue({
      mcpServers: input.mcpServers,
      format: input.mcpConfig.format,
    }),
    invalidPathMessage: `MCP config path '${input.mcpConfig.path.join(".")}' is not writable in '${input.mcpConfig.fileId}'.`,
  });

  return stringifyToml(root);
}

function replaceMcpConfigContent(input: {
  content: string;
  mcpConfig: IntegrationMcpConfig;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  if (input.mcpConfig.path.length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.MCP_CONFLICT,
      `MCP config for file '${input.mcpConfig.fileId}' must define a non-empty path.`,
    );
  }

  if (input.mcpConfig.format === "json") {
    return replaceJsonMcpConfig(input);
  }

  return replaceTomlMcpConfig(input);
}

export function applyMcpConfigToRuntimeClients(input: {
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  mcpConfig: IntegrationMcpConfig;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<CompiledRuntimeClient> {
  if (input.mcpServers.length === 0) {
    return input.runtimeClients;
  }

  let foundClient = false;
  let foundFile = false;

  const runtimeClients = input.runtimeClients.map((runtimeClient) => {
    if (runtimeClient.clientId !== input.mcpConfig.clientId) {
      return runtimeClient;
    }

    foundClient = true;

    return {
      ...runtimeClient,
      setup: {
        ...runtimeClient.setup,
        files: runtimeClient.setup.files.map((file) => {
          if (file.fileId !== input.mcpConfig.fileId) {
            return file;
          }

          foundFile = true;

          return {
            ...file,
            content: replaceMcpConfigContent({
              content: file.content,
              mcpConfig: input.mcpConfig,
              mcpServers: input.mcpServers,
            }),
          };
        }),
      },
    };
  });

  if (!foundClient) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.MCP_CONFLICT,
      `MCP config target client '${input.mcpConfig.clientId}' was not found.`,
    );
  }

  if (!foundFile) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.MCP_CONFLICT,
      `MCP config target file '${input.mcpConfig.fileId}' was not found on client '${input.mcpConfig.clientId}'.`,
    );
  }

  return runtimeClients;
}
