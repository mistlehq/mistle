import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { KlaviyoCredentialSecretTypes, KlaviyoCredentialSlotKeys, KlaviyoMcpUrl } from "./auth.js";
import type { KlaviyoBindingConfig } from "./binding-config-schema.js";
import { KlaviyoToolIds } from "./tool-ids.js";

export type KlaviyoCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  KlaviyoBindingConfig
>;

function createKlaviyoMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["mcp.klaviyo.com"],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: KlaviyoMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: KlaviyoCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: KlaviyoCredentialSlotKeys.accessToken,
    },
  };
}

export function compileKlaviyoBinding(input: KlaviyoCompileBindingInput): CompileBindingResult {
  const includesKlaviyoMcp = input.binding.config.tools.includes(KlaviyoToolIds.KLAVIYO_MCP);

  return {
    egressRoutes: includesKlaviyoMcp
      ? [
          createKlaviyoMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
