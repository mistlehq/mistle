import { coerceConfigObjectNode } from "../../core/config-object-node.js";
import {
  type PartialDataPlaneGatewayConfigInput,
  PartialDataPlaneGatewayConfigSchema,
} from "./schema.js";

export function loadDataPlaneGatewayFromToml(
  tomlRoot: Record<string, unknown>,
): PartialDataPlaneGatewayConfigInput {
  const apps = coerceConfigObjectNode(tomlRoot.apps);
  const dataPlaneGateway = coerceConfigObjectNode(apps.data_plane_gateway);
  const server = coerceConfigObjectNode(dataPlaneGateway.server);
  const database = coerceConfigObjectNode(dataPlaneGateway.database);

  return PartialDataPlaneGatewayConfigSchema.parse({
    server: {
      host: server.host,
      port: server.port,
    },
    database: {
      url: database.url,
    },
  });
}
