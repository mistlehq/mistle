import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import { resolveNotionCredentialSecretType } from "./auth.js";
import type { NotionBindingConfig } from "./binding-config-schema.js";
import type { NotionTargetConfig } from "./target-config-schema.js";

export type NotionCompileBindingInput = CompileBindingInput<
  NotionTargetConfig,
  NotionBindingConfig
>;

export function compileNotionBinding(input: NotionCompileBindingInput): CompileBindingResult {
  const credentialSecretType = resolveNotionCredentialSecretType(input.connection.config);
  const parsedMcpBaseUrl = new URL(input.target.config.mcpBaseUrl);

  return {
    egressRoutes: [
      {
        match: {
          hosts: [parsedMcpBaseUrl.host],
          pathPrefixes: [resolveRoutePathPrefixFromBaseUrl(input.target.config.mcpBaseUrl)],
        },
        upstream: {
          baseUrl: input.target.config.mcpBaseUrl,
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
