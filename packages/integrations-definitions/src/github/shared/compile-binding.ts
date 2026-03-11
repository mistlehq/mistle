import {
  joinRoutePathPrefixes,
  resolveRoutePathPrefixFromBaseUrl,
  IntegrationSupportedAuthSchemes,
  type RuntimeArtifactCommand,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import { GitHubConnectionConfigSchema, resolveGitHubCredentialSecretType } from "./auth.js";
import type { GitHubBindingConfig } from "./binding-config-schema.js";
import { GitHubApiMethods, GitHubGitHttpMethods } from "./constants.js";
import { GitHubCredentialResolverKeys } from "./credential-resolver.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";

export type GitHubCompileBindingInput = CompileBindingInput<
  GitHubTargetConfig,
  GitHubBindingConfig
>;
type GitHubCompiledRoute = CompileBindingResult["egressRoutes"][number];

const GitHubCliArtifactKey = "gh-cli";
const GitHubCliArtifactName = "GitHub CLI";
const GitHubCliArtifactEnv = {
  GH_TOKEN: "dummy-value",
};
const GitHubCliRepository = "cli/cli";
const ArtifactCommandTimeoutMs = 120_000;

function renderInstallGitHubCliScript(installPath: string): string {
  return [
    'arch="$(uname -m)"',
    'case "$arch" in',
    "  x86_64)",
    '    asset_suffix="linux_amd64"',
    "    ;;",
    "  aarch64|arm64)",
    '    asset_suffix="linux_arm64"',
    "    ;;",
    "  *)",
    '    echo "Unsupported architecture: $arch" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    "",
    `release_url="$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/${GitHubCliRepository}/releases/latest)"`,
    'tag_name="${release_url##*/}"',
    'version="${tag_name#v}"',
    'asset_name="gh_${version}_${asset_suffix}.tar.gz"',
    'archive_root="gh_${version}_${asset_suffix}"',
    `download_url="https://github.com/${GitHubCliRepository}/releases/download/\${tag_name}/\${asset_name}"`,
    `install_path=${JSON.stringify(installPath)}`,
    "",
    'temp_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$temp_dir\"' EXIT",
    "",
    'curl -fsSL "$download_url" -o "$temp_dir/gh.tar.gz"',
    'tar -xzf "$temp_dir/gh.tar.gz" -C "$temp_dir"',
    'install -m 0755 "$temp_dir/$archive_root/bin/gh" "$install_path"',
  ].join("\n");
}

function buildGitHubCliLifecycleCommand(input: { installPath: string }): RuntimeArtifactCommand {
  return {
    args: ["sh", "-euc", renderInstallGitHubCliScript(input.installPath)],
    timeoutMs: ArtifactCommandTimeoutMs,
  };
}

/**
 * Builds the canonical HTTPS origin that should remain visible inside the
 * cloned repository after startup.
 */
function toRepositoryCloneOriginUrl(input: { webBaseUrl: string; repository: string }): string {
  const parsedBaseUrl = new URL(input.webBaseUrl);
  parsedBaseUrl.pathname = joinRoutePathPrefixes(
    parsedBaseUrl.pathname,
    `/${input.repository}.git`,
  );
  parsedBaseUrl.search = "";
  parsedBaseUrl.hash = "";

  return parsedBaseUrl.toString();
}

function toRepositoryWorkspacePath(repository: string): string {
  return `/workspace/repos/${repository}`;
}

function resolveGitHubApiPathPrefixes(apiBaseUrl: string): ReadonlyArray<string> {
  const apiPathPrefix = resolveRoutePathPrefixFromBaseUrl(apiBaseUrl);

  if (!apiPathPrefix.endsWith("/v3")) {
    return [apiPathPrefix];
  }

  return [apiPathPrefix, apiPathPrefix.replace(/\/v3$/, "/graphql")];
}

function resolveGitHubUploadRouteHost(input: GitHubCompileBindingInput): string | undefined {
  if (input.target.variantId !== "github-cloud") {
    return undefined;
  }

  const webHost = new URL(input.target.config.webBaseUrl).host;
  const apiHost = new URL(input.target.config.apiBaseUrl).host;

  if (webHost !== "github.com" || apiHost !== "api.github.com") {
    return undefined;
  }

  return "uploads.github.com";
}

function buildGitHubUploadRoute(input: {
  host: string;
  credentialResolver: GitHubCompiledRoute["credentialResolver"];
}): GitHubCompiledRoute {
  return {
    match: {
      hosts: [input.host],
      pathPrefixes: ["/"],
      methods: GitHubApiMethods,
    },
    upstream: {
      baseUrl: "https://uploads.github.com",
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: input.credentialResolver,
  };
}

/**
 * Compiles GitHub repository selections into one API route, one HTTPS Git route,
 * and one workspace source per selected repository. The Git route uses Basic
 * auth with the fixed username GitHub expects for installation-token Git
 * access, and startup clones canonical origins directly through the sandbox
 * outbound proxy.
 */
export function compileGitHubBinding(input: GitHubCompileBindingInput): CompileBindingResult {
  const repositories = [...new Set(input.binding.config.repositories)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (repositories.length === 0) {
    return {
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
      workspaceSources: [],
    };
  }

  const gitRouteHost = new URL(input.target.config.webBaseUrl).host;
  const gitPathPrefix = resolveRoutePathPrefixFromBaseUrl(input.target.config.webBaseUrl);
  const apiRouteHost = new URL(input.target.config.apiBaseUrl).host;
  const apiPathPrefixes = resolveGitHubApiPathPrefixes(input.target.config.apiBaseUrl);
  const uploadRouteHost = resolveGitHubUploadRouteHost(input);
  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input.connection.config);
  const credentialSecretType = resolveGitHubCredentialSecretType(input.connection.config);
  const gitRepositoryPathPrefixes = repositories.map((repository) =>
    joinRoutePathPrefixes(gitPathPrefix, `/${repository}.git`),
  );
  const credentialResolver = {
    connectionId: input.connection.id,
    secretType: credentialSecretType,
    ...(parsedConnectionConfig.auth_scheme === IntegrationSupportedAuthSchemes.OAUTH
      ? {
          resolverKey: GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN,
        }
      : {}),
  };

  return {
    egressRoutes: [
      {
        match: {
          hosts: [gitRouteHost],
          pathPrefixes: gitRepositoryPathPrefixes,
          methods: GitHubGitHttpMethods,
        },
        upstream: {
          baseUrl: input.target.config.webBaseUrl,
        },
        authInjection: {
          type: "basic",
          target: "authorization",
          username: "x-access-token",
        },
        credentialResolver,
      },
      {
        match: {
          hosts: [apiRouteHost],
          pathPrefixes: apiPathPrefixes,
          methods: GitHubApiMethods,
        },
        upstream: {
          baseUrl: input.target.config.apiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver,
      },
      ...(uploadRouteHost === undefined
        ? []
        : [
            buildGitHubUploadRoute({
              host: uploadRouteHost,
              credentialResolver,
            }),
          ]),
    ],
    artifacts: [
      {
        artifactKey: GitHubCliArtifactKey,
        name: GitHubCliArtifactName,
        env: GitHubCliArtifactEnv,
        lifecycle: {
          install: ({ refs }) => [
            buildGitHubCliLifecycleCommand({
              installPath: refs.artifactBinPath("gh"),
            }),
          ],
          update: ({ refs }) => [
            buildGitHubCliLifecycleCommand({
              installPath: refs.artifactBinPath("gh"),
            }),
          ],
          remove: ({ refs }) => [
            refs.command.exec({
              args: ["rm", "-f", refs.artifactBinPath("gh")],
            }),
          ],
        },
      },
    ],
    runtimeClients: [],
    workspaceSources: repositories.map((repository) => ({
      sourceKind: "git-clone",
      resourceKind: "repository",
      path: toRepositoryWorkspacePath(repository),
      originUrl: toRepositoryCloneOriginUrl({
        webBaseUrl: input.target.config.webBaseUrl,
        repository,
      }),
    })),
  };
}
