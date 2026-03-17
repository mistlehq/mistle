import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { resolveAtlassianCredentialSecretType } from "./auth.js";
import type { AtlassianBindingConfig } from "./binding-config-schema.js";
import type { AtlassianTargetConfig } from "./target-config-schema.js";

export type AtlassianCompileBindingInput = CompileBindingInput<
  AtlassianTargetConfig,
  AtlassianBindingConfig
>;

const AtlassianMcpBaseUrl = "https://mcp.atlassian.com/v1/mcp";
const AtlassianMcpHost = "mcp.atlassian.com";

export function compileAtlassianBinding(input: AtlassianCompileBindingInput): CompileBindingResult {
  const credentialSecretType = resolveAtlassianCredentialSecretType(input.connection.config);

  return {
    egressRoutes: [
      {
        match: {
          hosts: [AtlassianMcpHost],
          pathPrefixes: ["/v1/mcp"],
        },
        upstream: {
          baseUrl: AtlassianMcpBaseUrl,
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
