import { requestControlPlane } from "../api/request-control-plane.js";
import {
  type IntegrationConnectionResource,
  type IntegrationConnectionResources,
  type RefreshedIntegrationConnectionResources,
  IntegrationConnectionResourcesPageSchema,
  RefreshedIntegrationConnectionResourcesSchema,
  readJsonWithSchema,
  wrapIntegrationsApiError,
} from "./integrations-service-shared.js";

const INTEGRATION_CONNECTION_RESOURCES_PAGE_LIMIT = 100;

export async function listIntegrationConnectionResources(input: {
  connectionId: string;
  kind: string;
  search?: string;
  signal?: AbortSignal;
}): Promise<IntegrationConnectionResources> {
  try {
    const items: IntegrationConnectionResource[] = [];
    let after: string | null = null;
    let responseMetadata: Omit<IntegrationConnectionResources, "items"> | null = null;

    for (;;) {
      const response = await requestControlPlane({
        operation: "listIntegrationConnectionResources",
        method: "GET",
        pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/resources`,
        query: {
          kind: input.kind,
          limit: INTEGRATION_CONNECTION_RESOURCES_PAGE_LIMIT,
          ...(input.search === undefined || input.search.length === 0
            ? {}
            : { search: input.search }),
          ...(after === null ? {} : { after }),
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        fallbackMessage: "Could not load integration connection resources.",
      });

      const data = await readJsonWithSchema({
        response,
        schema: IntegrationConnectionResourcesPageSchema,
        operation: "listIntegrationConnectionResources",
      });

      items.push(...data.items);
      responseMetadata = {
        connectionId: data.connectionId,
        familyId: data.familyId,
        kind: data.kind,
        syncState: data.syncState,
        ...(data.lastSyncedAt === undefined ? {} : { lastSyncedAt: data.lastSyncedAt }),
        ...(data.lastErrorCode === undefined ? {} : { lastErrorCode: data.lastErrorCode }),
        ...(data.lastErrorMessage === undefined ? {} : { lastErrorMessage: data.lastErrorMessage }),
      };

      if (data.page.nextCursor === null) {
        if (responseMetadata === null) {
          throw new Error("Expected integration connection resources metadata to be present.");
        }

        return {
          ...responseMetadata,
          items,
        };
      }

      after = data.page.nextCursor;
    }
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "listIntegrationConnectionResources",
      error,
      fallbackMessage: "Could not load integration connection resources.",
    });
  }
}

export async function refreshIntegrationConnectionResources(input: {
  connectionId: string;
  kind: string;
}): Promise<RefreshedIntegrationConnectionResources> {
  try {
    const response = await requestControlPlane({
      operation: "refreshIntegrationConnectionResources",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/resources/${encodeURIComponent(input.kind)}/refresh`,
      fallbackMessage: "Could not refresh integration connection resources.",
    });

    return readJsonWithSchema({
      response,
      schema: RefreshedIntegrationConnectionResourcesSchema,
      operation: "refreshIntegrationConnectionResources",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "refreshIntegrationConnectionResources",
      error,
      fallbackMessage: "Could not refresh integration connection resources.",
    });
  }
}
