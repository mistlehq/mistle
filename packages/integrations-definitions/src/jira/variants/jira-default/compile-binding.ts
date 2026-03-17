import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { resolveJiraCredentialSecretType } from "./auth.js";
import type { JiraBindingConfig } from "./binding-config-schema.js";
import type { JiraTargetConfig } from "./target-config-schema.js";

export type JiraCompileBindingInput = CompileBindingInput<JiraTargetConfig, JiraBindingConfig>;

const JiraMcpBaseUrl = "https://mcp.atlassian.com/v1/mcp";
const JiraMcpHost = "mcp.atlassian.com";

export function compileJiraBinding(input: JiraCompileBindingInput): CompileBindingResult {
  const credentialSecretType = resolveJiraCredentialSecretType(input.connection.config);

  return {
    egressRoutes: [
      {
        match: {
          hosts: [JiraMcpHost],
          pathPrefixes: ["/v1/mcp"],
        },
        upstream: {
          baseUrl: JiraMcpBaseUrl,
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
