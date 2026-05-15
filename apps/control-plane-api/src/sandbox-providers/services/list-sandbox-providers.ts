import {
  IntegrationKinds,
  type IntegrationRegistry,
  type SandboxRuntimeResourceCapabilities,
} from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";

import type { ControlPlaneApiSandboxRuntimeConfig } from "../../types.js";
import type { ListSandboxProvidersResponse } from "../schemas.js";

export function listSandboxProviders(ctx: {
  integrationRegistry: IntegrationRegistry;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
}): ListSandboxProvidersResponse {
  const sandboxRuntimeDefinitions = [
    findSandboxRuntimeDefinition(ctx.integrationRegistry, SandboxProvider.E2B),
    findSandboxRuntimeDefinition(ctx.integrationRegistry, SandboxProvider.TENSORLAKE),
  ];

  return {
    items: [
      {
        id: SandboxProvider.DOCKER,
        displayName: "Docker",
        managed: ctx.sandboxConfig.docker?.enabled === true,
        supportsOrganizationConnection: false,
        resourceCapabilities: null,
      },
      ...sandboxRuntimeDefinitions.map((definition) => ({
        id: definition.sandboxRuntime.providerId,
        displayName: definition.sandboxRuntime.displayName,
        managed:
          definition.sandboxRuntime.providerId === SandboxProvider.E2B
            ? ctx.sandboxConfig.e2b?.enabled === true
            : definition.sandboxRuntime.providerId === SandboxProvider.TENSORLAKE
              ? ctx.sandboxConfig.tensorlake?.enabled === true
              : false,
        supportsOrganizationConnection: true,
        resourceCapabilities: definition.sandboxRuntime.resourceCapabilities,
      })),
    ],
  };
}

function findSandboxRuntimeDefinition(
  integrationRegistry: IntegrationRegistry,
  providerId: string,
): {
  sandboxRuntime: {
    providerId: string;
    displayName: string;
    resourceCapabilities: SandboxRuntimeResourceCapabilities;
  };
} {
  const definition = integrationRegistry
    .listDefinitions()
    .find(
      (candidate) =>
        candidate.kind === IntegrationKinds.SANDBOX &&
        candidate.sandboxRuntime?.providerId === providerId,
    );

  if (definition?.sandboxRuntime === undefined) {
    throw new Error(`Sandbox runtime definition for provider '${providerId}' was not found.`);
  }

  return {
    sandboxRuntime: definition.sandboxRuntime,
  };
}
