import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { SentryCredentialSecretTypes, SentryCredentialSlotKeys, SentryMcpUrl } from "./auth.js";
import { type SentryBindingConfig } from "./binding-config-schema.js";
import { SentryToolIds } from "./tool-ids.js";

export type SentryCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  SentryBindingConfig
>;

function createSentryMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["mcp.sentry.dev"],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: SentryMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: SentryCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: SentryCredentialSlotKeys.accessToken,
    },
  };
}

export function compileSentryBinding(input: SentryCompileBindingInput): CompileBindingResult {
  const includesSentryMcp = input.binding.config.tools.includes(SentryToolIds.SENTRY_MCP);

  return {
    egressRoutes: includesSentryMcp
      ? [
          createSentryMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
