import { requestControlPlane } from "../api/request-control-plane.js";
import {
  type IntegrationConnection,
  type IntegrationTarget,
  IntegrationConnectionsPageSchema,
  IntegrationTargetsPageSchema,
  readJsonWithSchema,
  wrapIntegrationsApiError,
} from "./integrations-service-shared.js";

const INTEGRATIONS_PAGE_LIMIT = 100;

async function listAllIntegrationTargets(input: {
  signal?: AbortSignal;
}): Promise<readonly IntegrationTarget[]> {
  const items: IntegrationTarget[] = [];
  let after: string | null = null;

  for (;;) {
    const response = await requestControlPlane({
      operation: "listIntegrationTargets",
      method: "GET",
      pathname: "/v1/integration/targets",
      query: {
        limit: INTEGRATIONS_PAGE_LIMIT,
        ...(after === null ? {} : { after }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load integration targets.",
    });

    const data = await readJsonWithSchema({
      response,
      schema: IntegrationTargetsPageSchema,
      operation: "listIntegrationTargets",
    });

    items.push(...data.items);
    if (data.nextPage === null) {
      return items;
    }

    after = data.nextPage.after;
  }
}

async function listAllIntegrationConnections(input: {
  signal?: AbortSignal;
}): Promise<readonly IntegrationConnection[]> {
  const items: IntegrationConnection[] = [];
  let after: string | null = null;

  for (;;) {
    const response = await requestControlPlane({
      operation: "listIntegrationConnections",
      method: "GET",
      pathname: "/v1/integration/connections",
      query: {
        limit: INTEGRATIONS_PAGE_LIMIT,
        ...(after === null ? {} : { after }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load integration connections.",
    });

    const data = await readJsonWithSchema({
      response,
      schema: IntegrationConnectionsPageSchema,
      operation: "listIntegrationConnections",
    });

    items.push(...data.items);
    if (data.nextPage === null) {
      return items;
    }

    after = data.nextPage.after;
  }
}

export async function listIntegrationDirectory(input: { signal?: AbortSignal }): Promise<{
  targets: readonly IntegrationTarget[];
  connections: readonly IntegrationConnection[];
}> {
  try {
    const [targets, connections] = await Promise.all([
      listAllIntegrationTargets(input.signal === undefined ? {} : { signal: input.signal }),
      listAllIntegrationConnections(input.signal === undefined ? {} : { signal: input.signal }),
    ]);

    return {
      targets,
      connections,
    };
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "listIntegrationDirectory",
      error,
      fallbackMessage: "Could not load integrations.",
    });
  }
}
