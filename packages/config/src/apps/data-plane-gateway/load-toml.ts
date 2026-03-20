import { asObjectRecord } from "../../core/record.js";
import {
  type PartialDataPlaneGatewayConfigInput,
  PartialDataPlaneGatewayConfigSchema,
} from "./schema.js";

export function loadDataPlaneGatewayFromToml(
  tomlRoot: Record<string, unknown>,
): PartialDataPlaneGatewayConfigInput {
  const apps = asObjectRecord(tomlRoot.apps);
  const dataPlaneGateway = asObjectRecord(apps.data_plane_gateway);
  const server = asObjectRecord(dataPlaneGateway.server);
  const database = asObjectRecord(dataPlaneGateway.database);
  const runtimeState = asObjectRecord(dataPlaneGateway.runtime_state);
  const runtimeStateValkey = asObjectRecord(runtimeState.valkey);
  const dataPlaneApi = asObjectRecord(dataPlaneGateway.data_plane_api);

  return PartialDataPlaneGatewayConfigSchema.parse({
    server: {
      host: server.host,
      port: server.port,
    },
    database: {
      url: database.url,
    },
    runtimeState: {
      backend: runtimeState.backend,
      ...(Object.keys(runtimeStateValkey).length > 0
        ? {
            valkey: {
              url: runtimeStateValkey.url,
              keyPrefix: runtimeStateValkey.key_prefix,
            },
          }
        : {}),
    },
    dataPlaneApi: {
      baseUrl: dataPlaneApi.base_url,
    },
  });
}
