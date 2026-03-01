import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { GitHubCredentialSecretTypes } from "./auth.js";
import type { GitHubBindingConfig } from "./binding-config-schema.js";
import { GitHubApiMethods } from "./constants.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";

export type GitHubCompileBindingInput = CompileBindingInput<
  GitHubTargetConfig,
  GitHubBindingConfig
>;

function resolveApiPathPrefix(baseUrl: string): string {
  const pathname = new URL(baseUrl).pathname;

  if (pathname === "/") {
    return "";
  }

  if (pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function createRepositoryPathPrefix(input: { apiPathPrefix: string; repository: string }): string {
  return `${input.apiPathPrefix}/repos/${input.repository}`;
}

export function compileGitHubApiKeyBinding(input: GitHubCompileBindingInput): CompileBindingResult {
  const routeHost = new URL(input.target.config.apiBaseUrl).host;
  const apiPathPrefix = resolveApiPathPrefix(input.target.config.apiBaseUrl);
  const repositoryPathPrefixes = [...new Set(input.binding.config.repositories)]
    .sort((left, right) => left.localeCompare(right))
    .map((repository) =>
      createRepositoryPathPrefix({
        apiPathPrefix,
        repository,
      }),
    );

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
          secretType: GitHubCredentialSecretTypes.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClientSetups: [],
  };
}
