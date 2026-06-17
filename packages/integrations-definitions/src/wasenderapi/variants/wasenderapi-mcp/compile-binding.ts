import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { WasenderApiCredentialSecretTypes, WasenderApiCredentialSlotKeys } from "./auth.js";
import type { WasenderApiBindingConfig } from "./binding-config-schema.js";
import { WasenderApiMcpBaseUrl, type WasenderApiTargetConfig } from "./target-config-schema.js";
import { WasenderApiToolIds } from "./tool-ids.js";

export type WasenderApiCompileBindingInput = CompileBindingInput<
  WasenderApiTargetConfig,
  WasenderApiBindingConfig
>;

function createWasenderApiMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  const parsedBaseUrl = new URL(WasenderApiMcpBaseUrl);

  return {
    match: {
      hosts: [parsedBaseUrl.host],
      pathPrefixes: [parsedBaseUrl.pathname],
    },
    upstream: {
      baseUrl: WasenderApiMcpBaseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: WasenderApiCredentialSecretTypes.PERSONAL_ACCESS_TOKEN,
      slotKey: WasenderApiCredentialSlotKeys.PERSONAL_ACCESS_TOKEN,
    },
  };
}

export function compileWasenderApiBinding(
  input: WasenderApiCompileBindingInput,
): CompileBindingResult {
  const includesWasenderApiMcp = input.binding.config.tools.includes(
    WasenderApiToolIds.WASENDERAPI_MCP,
  );

  return {
    egressRoutes: includesWasenderApiMcp
      ? [
          createWasenderApiMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
