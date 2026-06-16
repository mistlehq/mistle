import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { StripeCredentialSecretTypes, StripeCredentialSlotKeys, StripeMcpUrl } from "./auth.js";
import { type StripeBindingConfig } from "./binding-config-schema.js";
import { StripeToolIds } from "./tool-ids.js";

export type StripeCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  StripeBindingConfig
>;

function createStripeMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["mcp.stripe.com"],
      pathPrefixes: ["/"],
    },
    upstream: {
      baseUrl: StripeMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: StripeCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: StripeCredentialSlotKeys.accessToken,
    },
  };
}

export function compileStripeBinding(input: StripeCompileBindingInput): CompileBindingResult {
  const includesStripeMcp = input.binding.config.tools.includes(StripeToolIds.STRIPE_MCP);

  return {
    egressRoutes: includesStripeMcp
      ? [
          createStripeMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
