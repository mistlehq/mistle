import { coerceConfigObjectNode } from "../../core/config-object-node.js";
import { type PartialDataPlaneApiConfigInput, PartialDataPlaneApiConfigSchema } from "./schema.js";

export function loadDataPlaneApiFromToml(
  tomlRoot: Record<string, unknown>,
): PartialDataPlaneApiConfigInput {
  const apps = coerceConfigObjectNode(tomlRoot.apps);
  const dataPlaneApi = coerceConfigObjectNode(apps.data_plane_api);
  const server = coerceConfigObjectNode(dataPlaneApi.server);
  const database = coerceConfigObjectNode(dataPlaneApi.database);
  const workflow = coerceConfigObjectNode(dataPlaneApi.workflow);

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
  });
}
