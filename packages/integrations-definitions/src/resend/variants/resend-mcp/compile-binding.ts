import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { ResendCredentialSecretTypes, ResendCredentialSlotKeys } from "./auth.js";
import type { ResendBindingConfig } from "./binding-config-schema.js";
import { ResendApiBaseUrl, type ResendTargetConfig } from "./target-config-schema.js";
import type { ResendTargetSecret } from "./target-secret-schema.js";
import { ResendToolIds } from "./tool-ids.js";

export type ResendCompileBindingInput = CompileBindingInput<
  ResendTargetConfig,
  ResendBindingConfig,
  ResendTargetSecret
>;

const ResendMcpArtifactName = "Resend MCP";
const ResendMcpPackageVersion = "2.6.1";
const ResendMcpPackage = `resend-mcp@${ResendMcpPackageVersion}`;
const ResendMcpNodeTool = "node@24.11.1";
const ResendMcpInstallDirectoryName = "resend-mcp";
const ResendMcpExecutablePath = "node_modules/.bin/resend-mcp";
const ResendApiKeyPlaceholder = "mistle-placeholder";
const ArtifactCommandTimeoutMs = 120_000;

export const ResendMcpWrapperPath = "/usr/local/bin/resend-mcp";

function resolveResendMcpArtifactDirectory(runtimeArtifactDir: string): string {
  return `${runtimeArtifactDir}/${ResendMcpInstallDirectoryName}`;
}

function renderInstallResendMcpScript(input: { artifactDirectory: string }): string {
  const executablePath = `${input.artifactDirectory}/${ResendMcpExecutablePath}`;

  return [
    `artifact_dir=${JSON.stringify(input.artifactDirectory)}`,
    `package_spec=${JSON.stringify(ResendMcpPackage)}`,
    "",
    'rm -rf "$artifact_dir"',
    'mkdir -p "$artifact_dir"',
    'cd "$artifact_dir"',
    `mise exec ${ResendMcpNodeTool} -- npm init -y >/dev/null`,
    `mise exec ${ResendMcpNodeTool} -- npm install --omit=dev --ignore-scripts --no-audit --no-fund "$package_spec"`,
    `test -x ${JSON.stringify(executablePath)}`,
  ].join("\n");
}

function createResendMcpArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: ResendToolIds.RESEND_MCP,
    name: ResendMcpArtifactName,
    lifecycle: {
      install: ({ refs }) => {
        const artifactDirectory = resolveResendMcpArtifactDirectory(
          refs.sandboxPaths.runtimeArtifactDir,
        );

        return [
          refs.mise.install({
            tools: [ResendMcpNodeTool],
            timeoutMs: ArtifactCommandTimeoutMs,
          }),
          refs.command.exec({
            args: [
              "sh",
              "-euc",
              renderInstallResendMcpScript({
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

function renderResendMcpWrapperScript(input: {
  artifactDirectory: string;
  senderEmailAddress?: string | undefined;
  replyToEmailAddresses: ReadonlyArray<string>;
}): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    `export RESEND_API_KEY=${JSON.stringify(ResendApiKeyPlaceholder)}`,
    ...(input.senderEmailAddress === undefined
      ? []
      : [`export SENDER_EMAIL_ADDRESS=${JSON.stringify(input.senderEmailAddress)}`]),
    ...(input.replyToEmailAddresses.length === 0
      ? []
      : [
          `export REPLY_TO_EMAIL_ADDRESSES=${JSON.stringify(input.replyToEmailAddresses.join(","))}`,
        ]),
    "",
    `exec ${JSON.stringify(`${input.artifactDirectory}/${ResendMcpExecutablePath}`)} "$@"`,
  ].join("\n");
}

function createResendMcpRuntimeClient(input: {
  artifactDirectory: string;
  senderEmailAddress?: string | undefined;
  replyToEmailAddresses: ReadonlyArray<string>;
}): CompileBindingResult["runtimeClients"][number] {
  return {
    clientId: "resend-mcp-runtime",
    setup: {
      env: {},
      files: [
        {
          fileId: "resend_mcp_wrapper",
          path: ResendMcpWrapperPath,
          mode: 0o755,
          content: renderResendMcpWrapperScript(input),
        },
      ],
    },
    processes: [],
    endpoints: [],
  };
}

function createResendApiRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  const parsedBaseUrl = new URL(ResendApiBaseUrl);

  return {
    match: {
      hosts: [parsedBaseUrl.host],
    },
    upstream: {
      baseUrl: ResendApiBaseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: ResendCredentialSecretTypes.API_KEY,
      slotKey: ResendCredentialSlotKeys.API_KEY,
    },
  };
}

export function compileResendBinding(input: ResendCompileBindingInput): CompileBindingResult {
  const includesResendMcp = input.binding.config.tools.includes(ResendToolIds.RESEND_MCP);
  const artifactDirectory = resolveResendMcpArtifactDirectory(
    input.refs.sandboxPaths.runtimeArtifactDir,
  );

  return {
    egressRoutes: includesResendMcp
      ? [
          createResendApiRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: includesResendMcp ? [createResendMcpArtifact()] : [],
    runtimeClients: includesResendMcp
      ? [
          createResendMcpRuntimeClient({
            artifactDirectory,
            ...(input.binding.config.senderEmailAddress === undefined
              ? {}
              : { senderEmailAddress: input.binding.config.senderEmailAddress }),
            replyToEmailAddresses: input.binding.config.replyToEmailAddresses,
          }),
        ]
      : [],
  };
}
