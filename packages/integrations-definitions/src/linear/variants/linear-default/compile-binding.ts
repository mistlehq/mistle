import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { LinearCredentialSlotKeys, resolveLinearCredentialSecretType } from "./auth.js";
import type { LinearBindingConfig } from "./binding-config-schema.js";
import { LinearRequestMiddlewareIds } from "./egress-request-middleware.js";
import type { LinearTargetConfig } from "./target-config-schema.js";
import { LinearToolIds } from "./tool-ids.js";

export type LinearCompileBindingInput = CompileBindingInput<
  LinearTargetConfig,
  LinearBindingConfig
>;

const LinearApiBaseUrl = "https://api.linear.app";
const LinearApiHost = "api.linear.app";
const LinearApiPathPrefix = "/graphql";
const LinearMcpHost = "mcp.linear.app";
const LinearMcpBaseUrl = "https://mcp.linear.app/mcp";

function createLinearMcpRoute(input: {
  connectionId: string;
  credentialSecretType: "api_key";
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: [LinearMcpHost],
    },
    upstream: {
      baseUrl: LinearMcpBaseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      connectionId: input.connectionId,
      secretType: input.credentialSecretType,
      slotKey: LinearCredentialSlotKeys.API_KEY,
    },
    requestMiddleware: [LinearRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MCP_MARKDOWN],
  };
}

export function compileLinearBinding(input: LinearCompileBindingInput): CompileBindingResult {
  const credentialSecretType = resolveLinearCredentialSecretType(input.connection.config);
  const includesLinearMcp = input.binding.config.tools.includes(LinearToolIds.LINEAR_MCP);

  return {
    egressRoutes: [
      {
        match: {
          hosts: [LinearApiHost],
          methods: ["POST"],
          pathPrefixes: [LinearApiPathPrefix],
        },
        upstream: {
          baseUrl: LinearApiBaseUrl,
        },
        authInjection: {
          type: "header",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: input.connection.id,
          secretType: credentialSecretType,
          slotKey: LinearCredentialSlotKeys.API_KEY,
        },
      },
      ...(includesLinearMcp
        ? [
            createLinearMcpRoute({
              connectionId: input.connection.id,
              credentialSecretType,
            }),
          ]
        : []),
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
