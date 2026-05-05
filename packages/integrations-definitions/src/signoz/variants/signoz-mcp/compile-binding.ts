import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import {
  SignozConnectionConfigSchema,
  SignozCredentialSecretTypes,
  SignozCredentialSlotKeys,
  resolveSignozMcpUrl,
} from "./auth.js";
import type { SignozBindingConfig } from "./binding-config-schema.js";
import { SignozTargetConfigSchema, type SignozTargetConfig } from "./target-config-schema.js";
import { SignozToolIds } from "./tool-ids.js";

export type SignozCompileBindingInput = CompileBindingInput<
  SignozTargetConfig,
  SignozBindingConfig
>;

function createSignozMcpRoute(input: {
  connectionId: string;
  region: string;
  issuerBaseUrl?: string | undefined;
}): CompileBindingResult["egressRoutes"][number] {
  const upstreamUrl = new URL(
    resolveSignozMcpUrl({
      region: input.region,
      issuerBaseUrl: input.issuerBaseUrl,
    }),
  );

  return {
    match: {
      hosts: [upstreamUrl.host],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: upstreamUrl.toString(),
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: SignozCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: SignozCredentialSlotKeys.accessToken,
    },
  };
}

export function compileSignozBinding(input: SignozCompileBindingInput): CompileBindingResult {
  const includesSignozMcp = input.binding.config.tools.includes(SignozToolIds.SIGNOZ_MCP);
  const connectionConfig = SignozConnectionConfigSchema.parse(input.connection.config);
  const targetConfig = SignozTargetConfigSchema.parse(input.target.config);

  return {
    egressRoutes: includesSignozMcp
      ? [
          createSignozMcpRoute({
            connectionId: input.connection.id,
            region: connectionConfig.region,
            issuerBaseUrl: targetConfig.issuer_base_url,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
