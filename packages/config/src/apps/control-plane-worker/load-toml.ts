import { coerceConfigObjectNode } from "../../core/config-object-node.js";
import {
  type PartialControlPlaneWorkerConfigInput,
  PartialControlPlaneWorkerConfigSchema,
} from "./schema.js";

export function loadControlPlaneWorkerFromToml(
  tomlRoot: Record<string, unknown>,
): PartialControlPlaneWorkerConfigInput {
  const apps = coerceConfigObjectNode(tomlRoot.apps);
  const controlPlaneWorker = coerceConfigObjectNode(apps.control_plane_worker);
  const server = coerceConfigObjectNode(controlPlaneWorker.server);
  const workflow = coerceConfigObjectNode(controlPlaneWorker.workflow);
  const email = coerceConfigObjectNode(controlPlaneWorker.email);
  const dataPlaneApi = coerceConfigObjectNode(controlPlaneWorker.data_plane_api);
  const controlPlaneApi = coerceConfigObjectNode(controlPlaneWorker.control_plane_api);

  return PartialControlPlaneWorkerConfigSchema.parse({
    server: {
      host: server.host,
      port: server.port,
    },
    workflow: {
      databaseUrl: workflow.database_url,
      namespaceId: workflow.namespace_id,
      runMigrations: workflow.run_migrations,
      concurrency: workflow.concurrency,
    },
    email: {
      fromAddress: email.from_address,
      fromName: email.from_name,
      smtpHost: email.smtp_host,
      smtpPort: email.smtp_port,
      smtpSecure: email.smtp_secure,
      smtpUsername: email.smtp_username,
      smtpPassword: email.smtp_password,
    },
    dataPlaneApi: {
      baseUrl: dataPlaneApi.base_url,
    },
    controlPlaneApi: {
      baseUrl: controlPlaneApi.base_url,
    },
  });
}
