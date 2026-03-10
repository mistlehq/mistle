import {
  joinRoutePathPrefixes,
  resolveRoutePathPrefixFromBaseUrl,
  IntegrationSupportedAuthSchemes,
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

/**
 * Builds the canonical HTTPS origin that should remain visible inside the
 * cloned repository after startup. Startup traffic initially goes through the
 * sandbox route URL, but git config is rewritten back to this URL so users keep
 * working with normal GitHub remotes.
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

/**
 * Compiles GitHub repository selections into one API route, one HTTPS Git route,
 * and one workspace source per selected repository. The Git route uses Basic
 * auth with the fixed username GitHub expects for installation-token Git
 * access, while workspace sources point startup at the same route so initial
 * clone and later in-sandbox git commands share one auth path.
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
  const apiPathPrefix = resolveRoutePathPrefixFromBaseUrl(input.target.config.apiBaseUrl);
  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input.connection.config);
  const credentialSecretType = resolveGitHubCredentialSecretType(input.connection.config);
  const apiRepositoryPathPrefixes = repositories.map((repository) =>
    joinRoutePathPrefixes(apiPathPrefix, `/repos/${repository}`),
  );
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
          pathPrefixes: apiRepositoryPathPrefixes,
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
    ],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: repositories.map((repository) => ({
      sourceKind: "git-clone",
      resourceKind: "repository",
      path: toRepositoryWorkspacePath(repository),
      originUrl: toRepositoryCloneOriginUrl({
        webBaseUrl: input.target.config.webBaseUrl,
        repository,
      }),
      routeId: input.refs.egressUrl,
    })),
  };
}
