import { asObjectRecord } from "../../core/record.js";
import {
  type PartialControlPlaneWorkerConfigInput,
  PartialControlPlaneWorkerConfigSchema,
} from "./schema.js";

export function loadControlPlaneWorkerFromToml(
  tomlRoot: Record<string, unknown>,
): PartialControlPlaneWorkerConfigInput {
  const apps = asObjectRecord(tomlRoot.apps);
  const controlPlaneWorker = asObjectRecord(apps.control_plane_worker);
  const server = asObjectRecord(controlPlaneWorker.server);
  const workflow = asObjectRecord(controlPlaneWorker.workflow);
  const email = asObjectRecord(controlPlaneWorker.email);
  const dataPlaneApi = asObjectRecord(controlPlaneWorker.data_plane_api);

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
  });
}
