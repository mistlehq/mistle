import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { RenderCredentialSecretTypes, RenderCredentialSlotKeys } from "./auth.js";
import type { RenderBindingConfig } from "./binding-config-schema.js";
import { RenderMcpBaseUrl, type RenderTargetConfig } from "./target-config-schema.js";
import { RenderToolIds } from "./tool-ids.js";

export type RenderCompileBindingInput = CompileBindingInput<
  RenderTargetConfig,
  RenderBindingConfig
>;

function createRenderMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  const parsedBaseUrl = new URL(RenderMcpBaseUrl);

  return {
    match: {
      hosts: [parsedBaseUrl.host],
      pathPrefixes: [parsedBaseUrl.pathname],
    },
    upstream: {
      baseUrl: RenderMcpBaseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: RenderCredentialSecretTypes.API_KEY,
      slotKey: RenderCredentialSlotKeys.API_KEY,
    },
  };
}

export function compileRenderBinding(input: RenderCompileBindingInput): CompileBindingResult {
  const includesRenderMcp = input.binding.config.tools.includes(RenderToolIds.RENDER_MCP);

  return {
    egressRoutes: includesRenderMcp
      ? [
          createRenderMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
