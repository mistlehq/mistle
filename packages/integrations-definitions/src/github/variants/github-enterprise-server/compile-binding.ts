import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { GitHubEnterpriseServerCredentialSecretTypes } from "./auth.js";
import type { GitHubEnterpriseServerBindingConfig } from "./binding-config-schema.js";
import type { GitHubEnterpriseServerTargetConfig } from "./target-config-schema.js";

const GitHubApiMethods: ReadonlyArray<string> = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export type GitHubEnterpriseServerCompileBindingInput = CompileBindingInput<
  GitHubEnterpriseServerTargetConfig,
  GitHubEnterpriseServerBindingConfig
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

export function compileGitHubEnterpriseServerBinding(
  input: GitHubEnterpriseServerCompileBindingInput,
): CompileBindingResult {
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
          secretType: GitHubEnterpriseServerCredentialSecretTypes.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClientSetups: [],
  };
}
