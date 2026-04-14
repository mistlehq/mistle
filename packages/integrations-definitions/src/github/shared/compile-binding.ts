import {
  IntegrationConnectionMethodIds,
  joinRoutePathPrefixes,
  resolveRoutePathPrefixFromBaseUrl,
  type RuntimeArtifactInstallStep,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import { GitHubConnectionConfigSchema, resolveGitHubCredentialSecretType } from "./auth.js";
import type { GitHubBindingConfig } from "./binding-config-schema.js";
import { GitHubApiMethods, GitHubGitHttpMethods } from "./constants.js";
import { GitHubCredentialResolverKeys } from "./credential-resolver-keys.js";
import { GitHubRequestMiddlewareIds } from "./egress-request-middleware.js";
import { GitHubCredentialSlotKeys } from "./slot-keys.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import { GitHubToolIds } from "./tool-ids.js";

export type GitHubCompileBindingInput = CompileBindingInput<
  GitHubTargetConfig,
  GitHubBindingConfig
>;
type GitHubCompiledRoute = CompileBindingResult["egressRoutes"][number];

const GitHubCliArtifactKey = "gh-cli";
const GitHubCliArtifactName = "GitHub CLI";
const GitHubCliPlaceholderToken = [
  "g",
  "h",
  "p",
  "_",
  "G7aBNSK9WMQh0rgA",
  "lagCe4a7o75FPgRbQhls",
].join("");
const GitHubCliArtifactEnv = {
  // Keep the placeholder PAT-shaped so agents don't reject the environment
  // before gh reaches the sandbox proxy that injects the real credential.
  GH_TOKEN: GitHubCliPlaceholderToken,
};
const GitHubCliRepository = "cli/cli";
const ArtifactCommandTimeoutMs = 120_000;
const GitHubReleaseRetryAttempts = 3;

function renderRetryShellFunction(input: { contextLabel: string }): string {
  return [
    "run_with_retry() {",
    '  max_attempts="$1"',
    "  shift",
    "  attempt=1",
    "  while :; do",
    '    if "$@"; then',
    "      return 0",
    "    else",
    '      status="$?"',
    "    fi",
    "",
    '    if [ "$attempt" -ge "$max_attempts" ]; then',
    '      return "$status"',
    "    fi",
    "",
    `    echo "Failed to ${input.contextLabel} on attempt $attempt/$max_attempts (exit=$status); retrying." >&2`,
    '    sleep "$attempt"',
    "    attempt=$((attempt + 1))",
    "  done",
    "}",
  ].join("\n");
}

function renderInstallGitHubCliScript(installPath: string): string {
  return [
    'arch="$(uname -m)"',
    renderRetryShellFunction({
      contextLabel: `download GitHub CLI release data for ${GitHubCliRepository}`,
    }),
    "",
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
    `tag_headers_path="$(mktemp)"`,
    `trap 'rm -f "$tag_headers_path"' EXIT`,
    `run_with_retry ${String(GitHubReleaseRetryAttempts)} curl --noproxy '*' -fsSI https://github.com/${GitHubCliRepository}/releases/latest -o "$tag_headers_path"`,
    `tag_name="$(tr -d '\\r' < "$tag_headers_path" | sed -n 's/^[Ll]ocation: .*\\/tag\\/\\([^[:space:]]*\\)$/\\1/p' | tail -n1)"`,
    'if [ -z "$tag_name" ]; then',
    '  echo "Failed to resolve latest gh release tag." >&2',
    "  exit 1",
    "fi",
    'version="${tag_name#v}"',
    'asset_name="gh_${version}_${asset_suffix}.tar.gz"',
    'archive_root="gh_${version}_${asset_suffix}"',
    `download_url="https://github.com/${GitHubCliRepository}/releases/download/\${tag_name}/\${asset_name}"`,
    `install_path=${JSON.stringify(installPath)}`,
    "",
    'temp_dir="$(mktemp -d)"',
    'trap \'rm -rf "$temp_dir" "$tag_headers_path"\' EXIT',
    "",
    `run_with_retry ${String(GitHubReleaseRetryAttempts)} curl --noproxy "*" -fsSL "$download_url" -o "$temp_dir/gh.tar.gz"`,
    'tar -xzf "$temp_dir/gh.tar.gz" -C "$temp_dir"',
    'install -m 0755 "$temp_dir/$archive_root/bin/gh" "$install_path"',
  ].join("\n");
}

function buildGitHubCliLifecycleCommand(input: {
  installPath: string;
}): RuntimeArtifactInstallStep {
  return {
    op: "exec",
    command: {
      args: ["sh", "-euc", renderInstallGitHubCliScript(input.installPath)],
      timeoutMs: ArtifactCommandTimeoutMs,
    },
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

function toRepositoryWorkspacePath(input: {
  workspaceDirectory: string;
  repository: string;
}): string {
  return `${input.workspaceDirectory}/${input.repository}`;
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
  const includesGitHubCli = input.binding.config.tools.includes(GitHubToolIds.GITHUB_CLI);
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
  if (
    parsedConnectionConfig.connection_method ===
      IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION &&
    parsedConnectionConfig.installation_id === undefined
  ) {
    throw new Error("Invalid input: GitHub App installation connections require installation_id.");
  }
  const credentialSecretType = resolveGitHubCredentialSecretType(input.connection.config);
  const gitRepositoryPathPrefixes = repositories.map((repository) =>
    joinRoutePathPrefixes(gitPathPrefix, `/${repository}.git`),
  );
  const credentialResolver = {
    connectionId: input.connection.id,
    secretType: credentialSecretType,
    ...(parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY
      ? {
          slotKey:
            input.target.variantId === "github-cloud"
              ? GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY
              : GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_API_KEY,
        }
      : {}),
    ...(parsedConnectionConfig.connection_method ===
    IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
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
        requestMiddleware: [GitHubRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MARKDOWN],
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
    artifacts: includesGitHubCli
      ? [
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
            },
          },
        ]
      : [],
    runtimeClients: [],
    workspaceSources: repositories.map((repository) => ({
      sourceKind: "git-clone",
      resourceKind: "repository",
      path: toRepositoryWorkspacePath({
        workspaceDirectory: input.refs.sandboxPaths.workspaceDir,
        repository,
      }),
      originUrl: toRepositoryCloneOriginUrl({
        webBaseUrl: input.target.config.webBaseUrl,
        repository,
      }),
    })),
  };
}
