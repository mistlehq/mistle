import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { PlanetScaleCredentialSecretTypes, PlanetScaleCredentialSlotKeys } from "./auth.js";
import type { PlanetScaleBindingConfig } from "./binding-config-schema.js";
import type { PlanetScaleTargetConfig } from "./target-config-schema.js";
import { PlanetScaleToolIds } from "./tool-ids.js";

export type PlanetScaleCompileBindingInput = CompileBindingInput<
  PlanetScaleTargetConfig,
  PlanetScaleBindingConfig
>;

const PlanetScaleMcpHost = "mcp.pscale.dev";
const PlanetScaleMcpBaseUrl = "https://mcp.pscale.dev/mcp/planetscale";
const PlanetScaleInsightsMcpBaseUrl = "https://mcp.pscale.dev/mcp/planetscale-insights-only";

function createPlanetScaleMcpRoute(input: {
  connectionId: string;
  baseUrl: string;
  pathPrefix: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: [PlanetScaleMcpHost],
      pathPrefixes: [input.pathPrefix],
    },
    upstream: {
      baseUrl: input.baseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: PlanetScaleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: PlanetScaleCredentialSlotKeys.accessToken,
    },
  };
}

export function compilePlanetScaleBinding(
  input: PlanetScaleCompileBindingInput,
): CompileBindingResult {
  const includesPlanetScaleMcp = input.binding.config.tools.includes(
    PlanetScaleToolIds.PLANETSCALE_MCP,
  );
  const includesPlanetScaleInsightsMcp = input.binding.config.tools.includes(
    PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
  );

  return {
    egressRoutes: [
      ...(includesPlanetScaleMcp
        ? [
            createPlanetScaleMcpRoute({
              connectionId: input.connection.id,
              baseUrl: PlanetScaleMcpBaseUrl,
              pathPrefix: "/mcp/planetscale",
            }),
          ]
        : []),
      ...(includesPlanetScaleInsightsMcp
        ? [
            createPlanetScaleMcpRoute({
              connectionId: input.connection.id,
              baseUrl: PlanetScaleInsightsMcpBaseUrl,
              pathPrefix: "/mcp/planetscale-insights-only",
            }),
          ]
        : []),
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
