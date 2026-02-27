import { asObjectRecord } from "../../core/record.js";
import {
  type PartialDataPlaneWorkerConfigInput,
  PartialDataPlaneWorkerConfigSchema,
} from "./schema.js";

export function loadDataPlaneWorkerFromToml(
  tomlRoot: Record<string, unknown>,
): PartialDataPlaneWorkerConfigInput {
  const apps = asObjectRecord(tomlRoot.apps);
  const dataPlaneWorker = asObjectRecord(apps.data_plane_worker);
  const server = asObjectRecord(dataPlaneWorker.server);
  const database = asObjectRecord(dataPlaneWorker.database);
  const workflow = asObjectRecord(dataPlaneWorker.workflow);
  const sandbox = asObjectRecord(dataPlaneWorker.sandbox);
  const sandboxModal = asObjectRecord(sandbox.modal);

  return PartialDataPlaneWorkerConfigSchema.parse({
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
      runMigrations: workflow.run_migrations,
      concurrency: workflow.concurrency,
    },
    sandbox: {
      provider: sandbox.provider,
      modal: {
        tokenId: sandboxModal.token_id,
        tokenSecret: sandboxModal.token_secret,
        appName: sandboxModal.app_name,
        environmentName: sandboxModal.environment_name,
      },
    },
  });
}
