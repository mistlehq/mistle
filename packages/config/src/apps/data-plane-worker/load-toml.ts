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
  const controlPlaneApi = asObjectRecord(dataPlaneWorker.control_plane_api);
  const sandbox = asObjectRecord(dataPlaneWorker.sandbox);
  const sandboxDocker = asObjectRecord(sandbox.docker);
  const sandboxE2B = asObjectRecord(sandbox.e2b);
  const sandboxStorage = asObjectRecord(dataPlaneWorker.sandbox_storage);
  const sandboxStorageArchil = asObjectRecord(sandboxStorage.archil);

  let sandboxStorageArchilMounts: Array<Record<string, unknown>> | undefined;
  if (Array.isArray(sandboxStorageArchil.mounts)) {
    sandboxStorageArchilMounts = sandboxStorageArchil.mounts.map((item) => {
      const mount = asObjectRecord(item);

      return {
        type: mount.type,
        bucket: mount.bucket,
        endpoint: mount.endpoint,
        accessKeyId: mount.access_key_id,
        secretAccessKey: mount.secret_access_key,
      };
    });
  }

  const sandboxConfig: Record<string, unknown> = {
    tokenizerProxyEgressBaseUrl: sandbox.tokenizer_proxy_egress_base_url,
  };

  if (typeof sandbox.sandboxd_test_faults_enabled === "boolean") {
    sandboxConfig.sandboxdTestFaultsEnabled = sandbox.sandboxd_test_faults_enabled;
  }

  const sandboxStorageConfig: Record<string, unknown> = {};

  if (hasEntries(sandboxDocker)) {
    sandboxConfig.docker = {
      socketPath: sandboxDocker.socket_path,
      networkName: sandboxDocker.network_name,
    };
  }

  if (hasEntries(sandboxE2B)) {
    sandboxConfig.e2b = {
      apiKey: sandboxE2B.api_key,
      domain: sandboxE2B.domain,
      cpuCount: sandboxE2B.cpu_count,
      memoryMb: sandboxE2B.memory_mb,
    };
  }

  if (
    typeof sandboxStorageArchil.api_key === "string" ||
    typeof sandboxStorageArchil.region === "string" ||
    typeof sandboxStorageArchil.name_prefix === "string" ||
    sandboxStorageArchilMounts !== undefined
  ) {
    sandboxStorageConfig.archil = {
      apiKey: sandboxStorageArchil.api_key,
      region: sandboxStorageArchil.region,
      namePrefix: sandboxStorageArchil.name_prefix,
      mounts: sandboxStorageArchilMounts,
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
    ...(typeof controlPlaneApi.base_url === "string"
      ? {
          controlPlaneApi: {
            baseUrl: controlPlaneApi.base_url,
          },
        }
      : {}),
    sandbox: sandboxConfig,
    sandboxStorage: sandboxStorageConfig,
  });
}
