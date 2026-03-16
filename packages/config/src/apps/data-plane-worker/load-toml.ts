import { coerceConfigObjectNode } from "../../core/config-object-node.js";
import { hasEntries } from "../../core/load-env.js";
import {
  type PartialDataPlaneWorkerConfigInput,
  PartialDataPlaneWorkerConfigSchema,
} from "./schema.js";

export function loadDataPlaneWorkerFromToml(
  tomlRoot: Record<string, unknown>,
): PartialDataPlaneWorkerConfigInput {
  const apps = coerceConfigObjectNode(tomlRoot.apps);
  const dataPlaneWorker = coerceConfigObjectNode(apps.data_plane_worker);
  const server = coerceConfigObjectNode(dataPlaneWorker.server);
  const database = coerceConfigObjectNode(dataPlaneWorker.database);
  const workflow = coerceConfigObjectNode(dataPlaneWorker.workflow);
  const tunnel = coerceConfigObjectNode(dataPlaneWorker.tunnel);
  const reaper = coerceConfigObjectNode(dataPlaneWorker.reaper);
  const sandbox = coerceConfigObjectNode(dataPlaneWorker.sandbox);
  const sandboxModal = coerceConfigObjectNode(sandbox.modal);
  const sandboxDocker = coerceConfigObjectNode(sandbox.docker);

  const sandboxConfig: Record<string, unknown> = {
    tokenizerProxyEgressBaseUrl: sandbox.tokenizer_proxy_egress_base_url,
  };

  if (hasEntries(sandboxModal)) {
    sandboxConfig.modal = {
      tokenId: sandboxModal.token_id,
      tokenSecret: sandboxModal.token_secret,
      appName: sandboxModal.app_name,
      environmentName: sandboxModal.environment_name,
    };
  }
  if (hasEntries(sandboxDocker)) {
    sandboxConfig.docker = {
      socketPath: sandboxDocker.socket_path,
      snapshotRepository: sandboxDocker.snapshot_repository,
      networkName: sandboxDocker.network_name,
      tracesEndpoint: sandboxDocker.traces_endpoint,
    };
  }

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
    tunnel: {
      bootstrapTokenTtlSeconds: tunnel.bootstrap_token_ttl_seconds,
      exchangeTokenTtlSeconds: tunnel.exchange_token_ttl_seconds,
    },
    reaper: {
      pollIntervalSeconds: reaper.poll_interval_seconds,
      webhookIdleTimeoutSeconds: reaper.webhook_idle_timeout_seconds,
      executionLeaseFreshnessSeconds: reaper.execution_lease_freshness_seconds,
      tunnelDisconnectGraceSeconds: reaper.tunnel_disconnect_grace_seconds,
    },
    sandbox: sandboxConfig,
  });
}
