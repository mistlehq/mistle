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
  const e2bDefinition = findSandboxRuntimeDefinition(ctx.integrationRegistry, SandboxProvider.E2B);

  return {
    items: [
      {
        id: SandboxProvider.DOCKER,
        displayName: "Docker",
        managed: ctx.sandboxConfig.docker?.enabled === true,
        supportsOrganizationConnection: false,
        resourceCapabilities: null,
      },
      {
        id: e2bDefinition.sandboxRuntime.providerId,
        displayName: e2bDefinition.sandboxRuntime.displayName,
        managed: ctx.sandboxConfig.e2b?.enabled === true,
        supportsOrganizationConnection: true,
        resourceCapabilities: e2bDefinition.sandboxRuntime.resourceCapabilities,
      },
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
