import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import {
  E2BSandboxRuntimeCredentialSecretTypes,
  E2BSandboxRuntimeCredentialSlotKeys,
  E2BToolIds,
} from "./constants.js";
import type { E2BSandboxRuntimeBindingConfig, E2BSandboxRuntimeTargetConfig } from "./schemas.js";

type E2BCompileBindingInput = CompileBindingInput<
  E2BSandboxRuntimeTargetConfig,
  E2BSandboxRuntimeBindingConfig
>;
type E2BCompiledRoute = NonNullable<CompileBindingResult["egressRoutes"][number]>;

const E2BCliArtifactKey = "e2b-cli";
const E2BCliArtifactName = "E2B CLI";
const E2BCliPackageVersion = "2.12.0";
const E2BCliPackage = `@e2b/cli@${E2BCliPackageVersion}`;
const E2BCliNodeTool = "node@24.11.1";
const E2BCliInstallDirectoryName = "e2b-cli";
const E2BCliExecutablePath = "node_modules/.bin/e2b";
const E2BCliPlaceholderApiKey = "e2b_0000000000000000000000000000000000000000";
const E2BCliWrapperPath = "/usr/local/bin/e2b";
const ArtifactCommandTimeoutMs = 180_000;

function createCredentialResolver(
  input: E2BCompileBindingInput,
): E2BCompiledRoute["credentialResolver"] {
  return {
    kind: "integration_connection",
    connectionId: input.connection.id,
    secretType: E2BSandboxRuntimeCredentialSecretTypes.API_KEY,
    slotKey: E2BSandboxRuntimeCredentialSlotKeys.API_KEY,
  };
}

function resolveE2BApiBaseUrl(domain: string): string {
  return `https://api.${domain}`;
}

function resolveE2BSandboxBaseUrl(domain: string): string {
  return `https://sandbox.${domain}`;
}

function createE2BEgressRoutes(
  input: E2BCompileBindingInput,
): CompileBindingResult["egressRoutes"] {
  const credentialResolver = createCredentialResolver(input);
  const apiBaseUrl = resolveE2BApiBaseUrl(input.target.config.domain);
  const sandboxBaseUrl = resolveE2BSandboxBaseUrl(input.target.config.domain);

  return [
    {
      match: {
        hosts: [new URL(apiBaseUrl).host],
        pathPrefixes: ["/"],
      },
      upstream: {
        baseUrl: apiBaseUrl,
      },
      authInjection: {
        type: "header",
        target: "X-API-KEY",
      },
      credentialResolver,
    },
    {
      match: {
        hosts: [new URL(sandboxBaseUrl).host],
        pathPrefixes: ["/"],
      },
      upstream: {
        baseUrl: sandboxBaseUrl,
      },
      authInjection: {
        type: "header",
        target: "X-API-KEY",
      },
      credentialResolver,
    },
  ];
}

function resolveE2BCliArtifactDirectory(runtimeArtifactDir: string): string {
  return `${runtimeArtifactDir}/${E2BCliInstallDirectoryName}`;
}

function renderInstallE2BCliScript(input: { artifactDirectory: string }): string {
  const executablePath = `${input.artifactDirectory}/${E2BCliExecutablePath}`;

  return [
    `artifact_dir=${JSON.stringify(input.artifactDirectory)}`,
    `package_spec=${JSON.stringify(E2BCliPackage)}`,
    "",
    'rm -rf "$artifact_dir"',
    'mkdir -p "$artifact_dir"',
    'cd "$artifact_dir"',
    `mise exec ${E2BCliNodeTool} -- npm init -y >/dev/null`,
    `mise exec ${E2BCliNodeTool} -- npm install --omit=dev --ignore-scripts --no-audit --no-fund "$package_spec"`,
    `test -x ${JSON.stringify(executablePath)}`,
  ].join("\n");
}

function renderE2BCliWrapperScript(input: {
  artifactDirectory: string;
  apiBaseUrl: string;
  sandboxBaseUrl: string;
  domain: string;
}): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    `export E2B_API_KEY=${JSON.stringify(E2BCliPlaceholderApiKey)}`,
    `export E2B_DOMAIN=${JSON.stringify(input.domain)}`,
    `export E2B_API_URL=${JSON.stringify(input.apiBaseUrl)}`,
    `export E2B_SANDBOX_URL=${JSON.stringify(input.sandboxBaseUrl)}`,
    "",
    `exec ${JSON.stringify(`${input.artifactDirectory}/${E2BCliExecutablePath}`)} "$@"`,
  ].join("\n");
}

function createE2BCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: E2BCliArtifactKey,
    name: E2BCliArtifactName,
    lifecycle: {
      install: ({ refs }) => {
        const artifactDirectory = resolveE2BCliArtifactDirectory(
          refs.sandboxPaths.runtimeArtifactDir,
        );

        return [
          refs.mise.install({
            tools: [E2BCliNodeTool],
            timeoutMs: ArtifactCommandTimeoutMs,
          }),
          refs.command.exec({
            args: [
              "sh",
              "-euc",
              renderInstallE2BCliScript({
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

function createE2BCliRuntimeClient(input: {
  artifactDirectory: string;
  apiBaseUrl: string;
  sandboxBaseUrl: string;
  domain: string;
}): CompileBindingResult["runtimeClients"][number] {
  return {
    clientId: "e2b-cli-runtime",
    setup: {
      env: {},
      files: [
        {
          fileId: "e2b_cli_wrapper",
          path: E2BCliWrapperPath,
          mode: 0o755,
          content: renderE2BCliWrapperScript(input),
        },
      ],
    },
    processes: [],
    endpoints: [],
  };
}

export function compileE2BBinding(input: E2BCompileBindingInput): CompileBindingResult {
  const includesE2BCli = input.binding.config.tools.includes(E2BToolIds.E2B_CLI);
  const artifactDirectory = resolveE2BCliArtifactDirectory(
    input.refs.sandboxPaths.runtimeArtifactDir,
  );
  const apiBaseUrl = resolveE2BApiBaseUrl(input.target.config.domain);
  const sandboxBaseUrl = resolveE2BSandboxBaseUrl(input.target.config.domain);

  return {
    egressRoutes: includesE2BCli ? createE2BEgressRoutes(input) : [],
    artifacts: includesE2BCli ? [createE2BCliArtifact()] : [],
    runtimeClients: includesE2BCli
      ? [
          createE2BCliRuntimeClient({
            artifactDirectory,
            apiBaseUrl,
            sandboxBaseUrl,
            domain: input.target.config.domain,
          }),
        ]
      : [],
  };
}
