import { requestIntegrationConnectionResourceRefresh } from "./request-resource-refresh.js";
import type {
  CreateIntegrationConnectionsServiceInput,
  IntegrationConnectionsService,
} from "./types.js";

export type {
  CreateIntegrationConnectionsServiceInput,
  IntegrationConnectionsService,
} from "./types.js";

export function createIntegrationConnectionsService(
  input: CreateIntegrationConnectionsServiceInput,
): IntegrationConnectionsService {
  const integrationConnectionsService = {
    requestResourceRefresh: (serviceInput) =>
      requestIntegrationConnectionResourceRefresh(
        input.db,
        input.integrationRegistry,
        input.openWorkflow,
        serviceInput,
      ),
  } satisfies IntegrationConnectionsService;

  return integrationConnectionsService;
}
