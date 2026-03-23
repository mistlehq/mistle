import { asObjectRecord } from "../../core/record.js";
import { type PartialDataPlaneApiConfigInput, PartialDataPlaneApiConfigSchema } from "./schema.js";

export function loadDataPlaneApiFromToml(
  tomlRoot: Record<string, unknown>,
): PartialDataPlaneApiConfigInput {
  const apps = asObjectRecord(tomlRoot.apps);
  const dataPlaneApi = asObjectRecord(apps.data_plane_api);
  const server = asObjectRecord(dataPlaneApi.server);
  const database = asObjectRecord(dataPlaneApi.database);
  const workflow = asObjectRecord(dataPlaneApi.workflow);
  const runtimeState = asObjectRecord(dataPlaneApi.runtime_state);

  return PartialDataPlaneApiConfigSchema.parse({
    server: {
      host: server.host,
      port: server.port,
    },
    database: {
      url: database.url,
    },
    workflow: {
      databaseUrl: workflow.database_url,
      namespaceId: workflow.namespace_id,
    },
    runtimeState: {
      gatewayBaseUrl: runtimeState.gateway_base_url,
    },
  });
}
