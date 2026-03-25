import { hasEntries } from "../../core/load-env.js";
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
  const database = asObjectRecord(dataPlaneWorker.database);
  const workflow = asObjectRecord(dataPlaneWorker.workflow);
  const tunnel = asObjectRecord(dataPlaneWorker.tunnel);
  const runtimeState = asObjectRecord(dataPlaneWorker.runtime_state);
  const sandbox = asObjectRecord(dataPlaneWorker.sandbox);
  const sandboxDocker = asObjectRecord(sandbox.docker);

  const sandboxConfig: Record<string, unknown> = {
    tokenizerProxyEgressBaseUrl: sandbox.tokenizer_proxy_egress_base_url,
  };

  if (hasEntries(sandboxDocker)) {
    sandboxConfig.docker = {
      socketPath: sandboxDocker.socket_path,
      networkName: sandboxDocker.network_name,
      tracesEndpoint: sandboxDocker.traces_endpoint,
    };
  }

  return PartialDataPlaneWorkerConfigSchema.parse({
    database: {
      url: database.url,
    },
    workflow: {
      databaseUrl: workflow.database_url,
      namespaceId: workflow.namespace_id,
      runMigrations: workflow.run_migrations,
      concurrency: workflow.concurrency,
    },
    tunnel: {
      bootstrapTokenTtlSeconds: tunnel.bootstrap_token_ttl_seconds,
      exchangeTokenTtlSeconds: tunnel.exchange_token_ttl_seconds,
    },
    runtimeState: {
      gatewayBaseUrl: runtimeState.gateway_base_url,
    },
    sandbox: sandboxConfig,
  });
}
