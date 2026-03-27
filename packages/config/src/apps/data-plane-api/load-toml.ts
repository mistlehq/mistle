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
  const sandbox = asObjectRecord(dataPlaneApi.sandbox);
  const sandboxDocker = asObjectRecord(sandbox.docker);
  const sandboxE2B = asObjectRecord(sandbox.e2b);

  return PartialDataPlaneApiConfigSchema.parse({
    server: {
      host: server.host,
      port: server.port,
    },
    database: {
      url: database.url,
      migrationUrl: database.migration_url,
    },
    workflow: {
      databaseUrl: workflow.database_url,
      namespaceId: workflow.namespace_id,
    },
    runtimeState: {
      gatewayBaseUrl: runtimeState.gateway_base_url,
    },
    sandbox: {
      docker: {
        socketPath: sandboxDocker.socket_path,
      },
      e2b: {
        apiKey: sandboxE2B.api_key,
        domain: sandboxE2B.domain,
      },
    },
  });
}
