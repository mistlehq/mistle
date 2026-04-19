import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { DatadogCredentialSecretTypes, DatadogCredentialSlotKeys } from "./auth.js";
import type { DatadogBindingConfig } from "./binding-config-schema.js";
import { DatadogMcpBaseUrl, type DatadogTargetConfig } from "./target-config-schema.js";
import { DatadogToolIds } from "./tool-ids.js";

export type DatadogCompileBindingInput = CompileBindingInput<
  DatadogTargetConfig,
  DatadogBindingConfig
>;

const DatadogHeaderNames = {
  API_KEY: "dd_api_key",
  APPLICATION_KEY: "dd_application_key",
} as const;

function createDatadogMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  const parsedBaseUrl = new URL(DatadogMcpBaseUrl);

  return {
    match: {
      hosts: [parsedBaseUrl.host],
      pathPrefixes: [parsedBaseUrl.pathname],
    },
    upstream: {
      baseUrl: DatadogMcpBaseUrl,
    },
    authInjection: {
      type: "header",
      target: DatadogHeaderNames.API_KEY,
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: DatadogCredentialSecretTypes.API_KEY,
      slotKey: DatadogCredentialSlotKeys.API_KEY,
    },
    additionalCredentialHeaders: [
      {
        header: DatadogHeaderNames.APPLICATION_KEY,
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connectionId,
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.APPLICATION_KEY,
        },
      },
    ],
  };
}

export function compileDatadogBinding(input: DatadogCompileBindingInput): CompileBindingResult {
  const includesDatadogMcp = input.binding.config.tools.includes(DatadogToolIds.DATADOG_MCP);

  return {
    egressRoutes: includesDatadogMcp
      ? [
          createDatadogMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
