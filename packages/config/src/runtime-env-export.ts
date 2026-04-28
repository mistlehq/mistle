import {
  ControlPlaneApiAuthEnvDescriptors,
  ControlPlaneApiAuthGoogleEnvDescriptors,
  ControlPlaneApiCommitSignEnvDescriptors,
  ControlPlaneApiDashboardEnvDescriptors,
  ControlPlaneApiDatabaseEnvDescriptors,
  ControlPlaneApiDataPlaneApiEnvDescriptors,
  ControlPlaneApiIntegrationsEnvDescriptors,
  ControlPlaneApiObjectStoreEnvDescriptors,
  ControlPlaneApiServerEnvDescriptors,
  ControlPlaneApiWorkflowEnvDescriptors,
} from "./apps/control-plane-api/legacy-env-descriptors.js";
import {
  ControlPlaneWorkerControlPlaneApiEnvDescriptors,
  ControlPlaneWorkerDataPlaneApiEnvDescriptors,
  ControlPlaneWorkerEmailEnvDescriptors,
  ControlPlaneWorkerWorkflowEnvDescriptors,
} from "./apps/control-plane-worker/legacy-env-descriptors.js";
import {
  DataPlaneApiControlPlaneApiEnvDescriptors,
  DataPlaneApiDatabaseEnvDescriptors,
  DataPlaneApiRuntimeStateEnvDescriptors,
  DataPlaneApiSandboxDockerEnvDescriptors,
  DataPlaneApiSandboxE2BEnvDescriptors,
  DataPlaneApiServerEnvDescriptors,
  DataPlaneApiWorkflowEnvDescriptors,
} from "./apps/data-plane-api/legacy-env-descriptors.js";
import {
  DataPlaneGatewayControlPlaneApiEnvDescriptors,
  DataPlaneGatewayDatabaseEnvDescriptors,
  DataPlaneGatewayDataPlaneApiEnvDescriptors,
  DataPlaneGatewayRuntimeStateEnvDescriptors,
  DataPlaneGatewayRuntimeStateValkeyEnvDescriptors,
  DataPlaneGatewayServerEnvDescriptors,
} from "./apps/data-plane-gateway/legacy-env-descriptors.js";
import {
  DataPlaneWorkerControlPlaneApiEnvDescriptors,
  DataPlaneWorkerDatabaseEnvDescriptors,
  DataPlaneWorkerRuntimeStateEnvDescriptors,
  DataPlaneWorkerSandboxDockerEnvDescriptors,
  DataPlaneWorkerSandboxE2BEnvDescriptors,
  DataPlaneWorkerSandboxEnvDescriptors,
  DataPlaneWorkerSandboxStorageArchilEnvDescriptors,
  DataPlaneWorkerSandboxStorageDockerVolumeEnvDescriptors,
  DataPlaneWorkerWorkflowEnvDescriptors,
} from "./apps/data-plane-worker/legacy-env-descriptors.js";
import {
  TokenizerProxyControlPlaneApiEnvDescriptors,
  TokenizerProxyServerEnvDescriptors,
} from "./apps/tokenizer-proxy/legacy-env-descriptors.js";
import type { EnvValueFormat } from "./core/load-env.js";
import { getValueAtPath } from "./core/record.js";
import {
  GlobalEnvDescriptors,
  GlobalSandboxBootstrapTokenEnvDescriptors,
  GlobalSandboxConnectTokenEnvDescriptors,
  GlobalSandboxEgressTokenEnvDescriptors,
  GlobalSandboxEnvDescriptors,
  GlobalSandboxPublishAccessTokenEnvDescriptors,
  GlobalSandboxPublishEnvDescriptors,
  GlobalSandboxPublishSessionEnvDescriptors,
  GlobalSandboxStorageEnvDescriptors,
  GlobalTelemetryEnvDescriptors,
} from "./global/legacy-env-descriptors.js";
import type { LoadConfigResult } from "./loader.js";
import { AppIds, type AppConfigModuleKey } from "./modules.js";

export type RuntimeEnvExportValueFormat = EnvValueFormat;

export type RuntimeEnvExportEntry = {
  name: string;
  value: unknown;
  valueFormat?: RuntimeEnvExportValueFormat;
};

type LegacyEnvSurfaceDescriptor = {
  key: string;
  envVar: string;
  valueFormat?: RuntimeEnvExportValueFormat;
  projectionPath?: readonly string[];
};

type RuntimeEnvExportDescriptor = {
  path: readonly string[];
  envVar: string;
  valueFormat?: RuntimeEnvExportValueFormat;
};

export type RuntimeEnvExportInput<TApp extends AppConfigModuleKey = AppConfigModuleKey> = {
  app: TApp;
  config: LoadConfigResult<TApp>;
};

export type RuntimeEnvValueFormat = RuntimeEnvExportValueFormat;
export type RuntimeEnvProjectionEntry = RuntimeEnvExportEntry;
export type RuntimeEnvProjectionInput<TApp extends AppConfigModuleKey = AppConfigModuleKey> =
  RuntimeEnvExportInput<TApp>;

function exportEnvDescriptors(
  prefix: readonly string[],
  descriptors: readonly LegacyEnvSurfaceDescriptor[],
): RuntimeEnvExportDescriptor[] {
  return descriptors.map((descriptor) => ({
    path: [...prefix, ...(descriptor.projectionPath ?? [descriptor.key])],
    envVar: descriptor.envVar,
    ...(descriptor.valueFormat === undefined ? {} : { valueFormat: descriptor.valueFormat }),
  }));
}

const GlobalRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  ...exportEnvDescriptors([], GlobalEnvDescriptors),
  ...exportEnvDescriptors(["telemetry"], GlobalTelemetryEnvDescriptors),
  ...exportEnvDescriptors(["sandbox"], GlobalSandboxEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "storage"], GlobalSandboxStorageEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "bootstrap"], GlobalSandboxBootstrapTokenEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "connect"], GlobalSandboxConnectTokenEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "egress"], GlobalSandboxEgressTokenEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "publish"], GlobalSandboxPublishEnvDescriptors),
  ...exportEnvDescriptors(
    ["sandbox", "publish", "access"],
    GlobalSandboxPublishAccessTokenEnvDescriptors,
  ),
  ...exportEnvDescriptors(
    ["sandbox", "publish", "session"],
    GlobalSandboxPublishSessionEnvDescriptors,
  ),
];

const ControlPlaneApiRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  ...exportEnvDescriptors(["server"], ControlPlaneApiServerEnvDescriptors),
  ...exportEnvDescriptors(["database"], ControlPlaneApiDatabaseEnvDescriptors),
  ...exportEnvDescriptors(["objectStore"], ControlPlaneApiObjectStoreEnvDescriptors),
  ...exportEnvDescriptors(["auth"], ControlPlaneApiAuthEnvDescriptors),
  ...exportEnvDescriptors(["auth", "google"], ControlPlaneApiAuthGoogleEnvDescriptors),
  ...exportEnvDescriptors(["dashboard"], ControlPlaneApiDashboardEnvDescriptors),
  ...exportEnvDescriptors(["workflow"], ControlPlaneApiWorkflowEnvDescriptors),
  ...exportEnvDescriptors(["dataPlaneApi"], ControlPlaneApiDataPlaneApiEnvDescriptors),
  ...exportEnvDescriptors(["commitSign"], ControlPlaneApiCommitSignEnvDescriptors),
  ...exportEnvDescriptors(["integrations"], ControlPlaneApiIntegrationsEnvDescriptors),
];

const ControlPlaneWorkerRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  ...exportEnvDescriptors(["workflow"], ControlPlaneWorkerWorkflowEnvDescriptors),
  ...exportEnvDescriptors(["email"], ControlPlaneWorkerEmailEnvDescriptors),
  ...exportEnvDescriptors(["dataPlaneApi"], ControlPlaneWorkerDataPlaneApiEnvDescriptors),
  ...exportEnvDescriptors(["controlPlaneApi"], ControlPlaneWorkerControlPlaneApiEnvDescriptors),
];

const DataPlaneApiRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  ...exportEnvDescriptors(["server"], DataPlaneApiServerEnvDescriptors),
  ...exportEnvDescriptors(["database"], DataPlaneApiDatabaseEnvDescriptors),
  ...exportEnvDescriptors(["workflow"], DataPlaneApiWorkflowEnvDescriptors),
  ...exportEnvDescriptors(["runtimeState"], DataPlaneApiRuntimeStateEnvDescriptors),
  ...exportEnvDescriptors(["controlPlaneApi"], DataPlaneApiControlPlaneApiEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "docker"], DataPlaneApiSandboxDockerEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "e2b"], DataPlaneApiSandboxE2BEnvDescriptors),
];

const DataPlaneGatewayRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  ...exportEnvDescriptors(["server"], DataPlaneGatewayServerEnvDescriptors),
  ...exportEnvDescriptors(["database"], DataPlaneGatewayDatabaseEnvDescriptors),
  ...exportEnvDescriptors(["runtimeState"], DataPlaneGatewayRuntimeStateEnvDescriptors),
  ...exportEnvDescriptors(
    ["runtimeState", "valkey"],
    DataPlaneGatewayRuntimeStateValkeyEnvDescriptors,
  ),
  ...exportEnvDescriptors(["dataPlaneApi"], DataPlaneGatewayDataPlaneApiEnvDescriptors),
  ...exportEnvDescriptors(["controlPlaneApi"], DataPlaneGatewayControlPlaneApiEnvDescriptors),
];

const DataPlaneWorkerRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  ...exportEnvDescriptors(["database"], DataPlaneWorkerDatabaseEnvDescriptors),
  ...exportEnvDescriptors(["workflow"], DataPlaneWorkerWorkflowEnvDescriptors),
  ...exportEnvDescriptors(["runtimeState"], DataPlaneWorkerRuntimeStateEnvDescriptors),
  ...exportEnvDescriptors(["controlPlaneApi"], DataPlaneWorkerControlPlaneApiEnvDescriptors),
  ...exportEnvDescriptors(["sandbox"], DataPlaneWorkerSandboxEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "docker"], DataPlaneWorkerSandboxDockerEnvDescriptors),
  ...exportEnvDescriptors(["sandbox", "e2b"], DataPlaneWorkerSandboxE2BEnvDescriptors),
  ...exportEnvDescriptors(
    ["sandboxStorage", "archil"],
    DataPlaneWorkerSandboxStorageArchilEnvDescriptors,
  ),
  ...exportEnvDescriptors(
    ["sandboxStorage", "dockerVolume"],
    DataPlaneWorkerSandboxStorageDockerVolumeEnvDescriptors,
  ),
];

const TokenizerProxyRuntimeEnvExports: readonly RuntimeEnvExportDescriptor[] = [
  ...exportEnvDescriptors(["server"], TokenizerProxyServerEnvDescriptors),
  ...exportEnvDescriptors(["controlPlaneApi"], TokenizerProxyControlPlaneApiEnvDescriptors),
];

function getAppRuntimeEnvExports(app: AppConfigModuleKey): readonly RuntimeEnvExportDescriptor[] {
  if (app === AppIds.CONTROL_PLANE_API) {
    return ControlPlaneApiRuntimeEnvExports;
  }

  if (app === AppIds.CONTROL_PLANE_WORKER) {
    return ControlPlaneWorkerRuntimeEnvExports;
  }

  if (app === AppIds.DATA_PLANE_API) {
    return DataPlaneApiRuntimeEnvExports;
  }

  if (app === AppIds.DATA_PLANE_GATEWAY) {
    return DataPlaneGatewayRuntimeEnvExports;
  }

  if (app === AppIds.DATA_PLANE_WORKER) {
    return DataPlaneWorkerRuntimeEnvExports;
  }

  if (app === AppIds.TOKENIZER_PROXY) {
    return TokenizerProxyRuntimeEnvExports;
  }

  throw new Error("Unsupported app id.");
}

function exportDescriptor(
  root: unknown,
  descriptor: RuntimeEnvExportDescriptor,
): RuntimeEnvExportEntry | undefined {
  const value = getValueAtPath(root, descriptor.path);

  if (value === undefined) {
    return undefined;
  }

  return {
    name: descriptor.envVar,
    value,
    ...(descriptor.valueFormat === undefined ? {} : { valueFormat: descriptor.valueFormat }),
  };
}

export function exportServiceConfigToEnv<TApp extends AppConfigModuleKey>(
  input: RuntimeEnvExportInput<TApp>,
): RuntimeEnvExportEntry[] {
  if (input.config.global === undefined) {
    throw new Error("Runtime env export requires loadConfig output that includes global config.");
  }

  const entries: RuntimeEnvExportEntry[] = [];

  for (const descriptor of GlobalRuntimeEnvExports) {
    const entry = exportDescriptor(input.config.global, descriptor);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }

  for (const descriptor of getAppRuntimeEnvExports(input.app)) {
    const entry = exportDescriptor(input.config.app, descriptor);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }

  return entries;
}

export const projectServiceConfigToEnv = exportServiceConfigToEnv;
