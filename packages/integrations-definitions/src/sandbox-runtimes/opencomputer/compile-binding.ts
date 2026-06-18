import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import {
  OpenComputerSandboxRuntimeCredentialSecretTypes,
  OpenComputerSandboxRuntimeCredentialSlotKeys,
  OpenComputerToolIds,
} from "./constants.js";
import type {
  OpenComputerSandboxRuntimeBindingConfig,
  OpenComputerSandboxRuntimeTargetConfig,
} from "./schemas.js";

type OpenComputerCompileBindingInput = CompileBindingInput<
  OpenComputerSandboxRuntimeTargetConfig,
  OpenComputerSandboxRuntimeBindingConfig
>;
type OpenComputerCompiledRoute = NonNullable<CompileBindingResult["egressRoutes"][number]>;

const OpenComputerDefaultApiBaseUrl = "https://app.opencomputer.dev";
const OpenComputerSessionsApiBaseUrl = "https://api.opencomputer.dev";
const OpenComputerCliArtifactKey = "opencomputer-cli";
const OpenComputerCliArtifactName = "OpenComputer CLI";
const OpenComputerGitHubRepository = "diggerhq/opencomputer";
const OpenComputerCliReleaseTag = "v0.5.0.139";
const OpenComputerCliPlaceholderApiKey = "mistle-placeholder-opencomputer-api-key";
const ArtifactCommandTimeoutMs = 180_000;

function createCredentialResolver(
  input: OpenComputerCompileBindingInput,
): OpenComputerCompiledRoute["credentialResolver"] {
  return {
    kind: "integration_connection",
    connectionId: input.connection.id,
    secretType: OpenComputerSandboxRuntimeCredentialSecretTypes.API_KEY,
    slotKey: OpenComputerSandboxRuntimeCredentialSlotKeys.API_KEY,
  };
}

function resolveOpenComputerApiBaseUrl(input: OpenComputerCompileBindingInput): string {
  return input.target.config.apiBaseUrl ?? OpenComputerDefaultApiBaseUrl;
}

function resolveRouteBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const pathPrefix = resolveRoutePathPrefixFromBaseUrl(baseUrl);

  if (pathPrefix === "/") {
    return parsed.origin;
  }

  return `${parsed.origin}${pathPrefix}`;
}

function createOpenComputerEgressRoutes(
  input: OpenComputerCompileBindingInput,
): CompileBindingResult["egressRoutes"] {
  const credentialResolver = createCredentialResolver(input);
  const apiRouteBaseUrl = resolveRouteBaseUrl(resolveOpenComputerApiBaseUrl(input));
  const sessionsApiRouteBaseUrl = resolveRouteBaseUrl(OpenComputerSessionsApiBaseUrl);
  const routes = new Map<string, OpenComputerCompiledRoute>();

  for (const baseUrl of [apiRouteBaseUrl, sessionsApiRouteBaseUrl]) {
    const host = new URL(baseUrl).host;
    const pathPrefix = resolveRoutePathPrefixFromBaseUrl(baseUrl);
    routes.set(`${host}${pathPrefix}`, {
      match: {
        hosts: [host],
        pathPrefixes: [pathPrefix],
      },
      upstream: {
        baseUrl,
      },
      authInjection: {
        type: "header",
        target: "X-API-Key",
      },
      credentialResolver,
    });
  }

  return [...routes.values()];
}

function createOpenComputerCliArtifact(
  apiBaseUrl: string,
): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: OpenComputerCliArtifactKey,
    name: OpenComputerCliArtifactName,
    env: {
      OPENCOMPUTER_API_KEY: OpenComputerCliPlaceholderApiKey,
      OPENCOMPUTER_API_URL: apiBaseUrl,
      SESSIONS_API_URL: OpenComputerSessionsApiBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: OpenComputerGitHubRepository,
          release: {
            kind: "tag",
            match: "exact",
            tag: OpenComputerCliReleaseTag,
          },
          asset: {
            kind: "by_arch",
            x86_64: {
              fileName: "oc-linux-amd64",
              format: "binary",
              sha256: "aae9b4787bf975e41b38c7d671ab242570de85a8f87873c2300bb9c11b148ce1",
            },
            aarch64: {
              fileName: "oc-linux-arm64",
              format: "binary",
              sha256: "53ee578a1804e48b043bcae6a28ee7382cd06c097f5af4d4d3f15c18d4012eb4",
            },
          },
          installPath: refs.artifactBinPath("oc"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

export function compileOpenComputerBinding(
  input: OpenComputerCompileBindingInput,
): CompileBindingResult {
  const includesOpenComputerCli = input.binding.config.tools.includes(
    OpenComputerToolIds.OPENCOMPUTER_CLI,
  );
  const apiBaseUrl = resolveOpenComputerApiBaseUrl(input);

  return {
    egressRoutes: includesOpenComputerCli ? createOpenComputerEgressRoutes(input) : [],
    artifacts: includesOpenComputerCli ? [createOpenComputerCliArtifact(apiBaseUrl)] : [],
    runtimeClients: [],
  };
}
