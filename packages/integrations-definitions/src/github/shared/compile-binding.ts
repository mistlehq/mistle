import {
  joinRoutePathPrefixes,
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import { resolveGitHubCredentialSecretType } from "./auth.js";
import type { GitHubBindingConfig } from "./binding-config-schema.js";
import { GitHubApiMethods } from "./constants.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";

export type GitHubCompileBindingInput = CompileBindingInput<
  GitHubTargetConfig,
  GitHubBindingConfig
>;

export function compileGitHubBinding(input: GitHubCompileBindingInput): CompileBindingResult {
  const routeHost = new URL(input.target.config.apiBaseUrl).host;
  const apiPathPrefix = resolveRoutePathPrefixFromBaseUrl(input.target.config.apiBaseUrl);
  const credentialSecretType = resolveGitHubCredentialSecretType(input.connection.config);
  const repositoryPathPrefixes = [...new Set(input.binding.config.repositories)]
    .sort((left, right) => left.localeCompare(right))
    .map((repository) => joinRoutePathPrefixes(apiPathPrefix, `/repos/${repository}`));

  return {
    egressRoutes: [
      {
        match: {
          hosts: [routeHost],
          pathPrefixes: repositoryPathPrefixes,
          methods: GitHubApiMethods,
        },
        upstream: {
          baseUrl: input.target.config.apiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: input.connection.id,
          secretType: credentialSecretType,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
