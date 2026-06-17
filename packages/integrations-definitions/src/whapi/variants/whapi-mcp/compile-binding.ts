import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { WhapiCredentialSecretTypes, WhapiCredentialSlotKeys } from "./auth.js";
import type { WhapiBindingConfig } from "./binding-config-schema.js";
import { WhapiApiBaseUrl, type WhapiTargetConfig } from "./target-config-schema.js";
import type { WhapiTargetSecret } from "./target-secret-schema.js";
import { WhapiToolIds } from "./tool-ids.js";

export type WhapiCompileBindingInput = CompileBindingInput<
  WhapiTargetConfig,
  WhapiBindingConfig,
  WhapiTargetSecret
>;

const WhapiMcpArtifactName = "Whapi MCP";
const WhapiMcpPackageVersion = "0.0.14";
const WhapiMcpPackage = `whapi-mcp@${WhapiMcpPackageVersion}`;
const WhapiMcpNodeTool = "node@24.11.1";
const WhapiMcpInstallDirectoryName = "whapi-mcp";
const WhapiMcpExecutablePath = "node_modules/.bin/mcp-whapi";
const WhapiApiTokenPlaceholder = "mistle-placeholder";
const ArtifactCommandTimeoutMs = 120_000;

export const WhapiMcpWrapperPath = "/usr/local/bin/whapi-mcp";

function resolveWhapiMcpArtifactDirectory(runtimeArtifactDir: string): string {
  return `${runtimeArtifactDir}/${WhapiMcpInstallDirectoryName}`;
}

function renderInstallWhapiMcpScript(input: { artifactDirectory: string }): string {
  const executablePath = `${input.artifactDirectory}/${WhapiMcpExecutablePath}`;

  return [
    `artifact_dir=${JSON.stringify(input.artifactDirectory)}`,
    `package_spec=${JSON.stringify(WhapiMcpPackage)}`,
    "",
    'rm -rf "$artifact_dir"',
    'mkdir -p "$artifact_dir"',
    'cd "$artifact_dir"',
    `mise exec ${WhapiMcpNodeTool} -- npm init -y >/dev/null`,
    `mise exec ${WhapiMcpNodeTool} -- npm install --omit=dev --ignore-scripts --no-audit --no-fund "$package_spec"`,
    `test -x ${JSON.stringify(executablePath)}`,
  ].join("\n");
}

function createWhapiMcpArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: WhapiToolIds.WHAPI_MCP,
    name: WhapiMcpArtifactName,
    lifecycle: {
      install: ({ refs }) => {
        const artifactDirectory = resolveWhapiMcpArtifactDirectory(
          refs.sandboxPaths.runtimeArtifactDir,
        );

        return [
          refs.mise.install({
            tools: [WhapiMcpNodeTool],
            timeoutMs: ArtifactCommandTimeoutMs,
          }),
          refs.command.exec({
            args: [
              "sh",
              "-euc",
              renderInstallWhapiMcpScript({
                artifactDirectory,
              }),
            ],
            timeoutMs: ArtifactCommandTimeoutMs,
          }),
        ];
      },
    },
  };
}

function renderWhapiMcpWrapperScript(input: { artifactDirectory: string }): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    `export API_TOKEN=${JSON.stringify(WhapiApiTokenPlaceholder)}`,
    "",
    `exec ${JSON.stringify(`${input.artifactDirectory}/${WhapiMcpExecutablePath}`)} "$@"`,
  ].join("\n");
}

function createWhapiMcpRuntimeClient(input: {
  artifactDirectory: string;
}): CompileBindingResult["runtimeClients"][number] {
  return {
    clientId: "whapi-mcp-runtime",
    setup: {
      env: {},
      files: [
        {
          fileId: "whapi_mcp_wrapper",
          path: WhapiMcpWrapperPath,
          mode: 0o755,
          content: renderWhapiMcpWrapperScript(input),
        },
      ],
    },
    processes: [],
    endpoints: [],
  };
}

function createWhapiApiRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  const parsedBaseUrl = new URL(WhapiApiBaseUrl);

  return {
    match: {
      hosts: [parsedBaseUrl.host],
    },
    upstream: {
      baseUrl: WhapiApiBaseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: WhapiCredentialSecretTypes.API_TOKEN,
      slotKey: WhapiCredentialSlotKeys.API_TOKEN,
    },
  };
}

export function compileWhapiBinding(input: WhapiCompileBindingInput): CompileBindingResult {
  const includesWhapiMcp = input.binding.config.tools.includes(WhapiToolIds.WHAPI_MCP);
  if (!includesWhapiMcp) {
    return {
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    };
  }

  const artifactDirectory = resolveWhapiMcpArtifactDirectory(
    input.refs.sandboxPaths.runtimeArtifactDir,
  );

  return {
    egressRoutes: [
      createWhapiApiRoute({
        connectionId: input.connection.id,
      }),
    ],
    artifacts: [createWhapiMcpArtifact()],
    runtimeClients: [
      createWhapiMcpRuntimeClient({
        artifactDirectory,
      }),
    ],
  };
}
