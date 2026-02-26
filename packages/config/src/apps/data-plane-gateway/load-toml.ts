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

  return PartialDataPlaneGatewayConfigSchema.parse({
    server: {
      host: server.host,
      port: server.port,
    },
  });
}
