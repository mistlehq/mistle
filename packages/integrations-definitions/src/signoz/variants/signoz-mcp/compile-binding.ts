import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import {
  SignozConnectionConfigSchema,
  SignozCredentialSecretTypes,
  SignozCredentialSlotKeys,
  resolveSignozMcpUrl,
} from "./auth.js";
import type { SignozBindingConfig } from "./binding-config-schema.js";
import type { SignozTargetConfig } from "./target-config-schema.js";
import { SignozToolIds } from "./tool-ids.js";

export type SignozCompileBindingInput = CompileBindingInput<
  SignozTargetConfig,
  SignozBindingConfig
>;

function createSignozMcpRoute(input: {
  connectionId: string;
  region: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: [`mcp.${input.region}.signoz.cloud`],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: resolveSignozMcpUrl(input.region),
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      connectionId: input.connectionId,
      secretType: SignozCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: SignozCredentialSlotKeys.accessToken,
    },
  };
}

export function compileSignozBinding(input: SignozCompileBindingInput): CompileBindingResult {
  const includesSignozMcp = input.binding.config.tools.includes(SignozToolIds.SIGNOZ_MCP);
  const connectionConfig = SignozConnectionConfigSchema.parse(input.connection.config);

  return {
    egressRoutes: includesSignozMcp
      ? [
          createSignozMcpRoute({
            connectionId: input.connection.id,
            region: connectionConfig.region,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
