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
} from "./apps/control-plane-api/load-env.js";
import {
  ControlPlaneWorkerControlPlaneApiEnvDescriptors,
  ControlPlaneWorkerDataPlaneApiEnvDescriptors,
  ControlPlaneWorkerEmailEnvDescriptors,
  ControlPlaneWorkerWorkflowEnvDescriptors,
} from "./apps/control-plane-worker/load-env.js";
import {
  DataPlaneApiControlPlaneApiEnvDescriptors,
  DataPlaneApiDatabaseEnvDescriptors,
  DataPlaneApiRuntimeStateEnvDescriptors,
  DataPlaneApiSandboxDockerEnvDescriptors,
  DataPlaneApiSandboxE2BEnvDescriptors,
  DataPlaneApiServerEnvDescriptors,
  DataPlaneApiWorkflowEnvDescriptors,
} from "./apps/data-plane-api/load-env.js";
import {
  DataPlaneGatewayControlPlaneApiEnvDescriptors,
  DataPlaneGatewayDatabaseEnvDescriptors,
  DataPlaneGatewayDataPlaneApiEnvDescriptors,
  DataPlaneGatewayRuntimeStateEnvDescriptors,
  DataPlaneGatewayRuntimeStateValkeyEnvDescriptors,
  DataPlaneGatewayServerEnvDescriptors,
} from "./apps/data-plane-gateway/load-env.js";
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
} from "./apps/data-plane-worker/load-env.js";
import {
  TokenizerProxyControlPlaneApiEnvDescriptors,
  TokenizerProxyServerEnvDescriptors,
} from "./apps/tokenizer-proxy/load-env.js";
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
} from "./global/load-env.js";
import type { LoadConfigResult } from "./loader.js";
import { AppIds, type AppConfigModuleKey } from "./modules.js";

export type RuntimeEnvValueFormat = EnvValueFormat;

export type RuntimeEnvProjectionEntry = {
  name: string;
  value: unknown;
  valueFormat?: RuntimeEnvValueFormat;
};

type EnvProjectionSourceDescriptor = {
  key: string;
  envVar: string;
  valueFormat?: RuntimeEnvValueFormat;
  projectionPath?: readonly string[];
};

type RuntimeEnvProjectionDescriptor = {
  path: readonly string[];
  envVar: string;
  valueFormat?: RuntimeEnvValueFormat;
};

export type RuntimeEnvProjectionInput<TApp extends AppConfigModuleKey = AppConfigModuleKey> = {
  app: TApp;
  config: LoadConfigResult<TApp>;
};

function projectEnvDescriptors(
  prefix: readonly string[],
  descriptors: readonly EnvProjectionSourceDescriptor[],
): RuntimeEnvProjectionDescriptor[] {
  return descriptors.map((descriptor) => ({
    path: [...prefix, ...(descriptor.projectionPath ?? [descriptor.key])],
    envVar: descriptor.envVar,
    ...(descriptor.valueFormat === undefined ? {} : { valueFormat: descriptor.valueFormat }),
  }));
}

const GlobalRuntimeEnvProjections: readonly RuntimeEnvProjectionDescriptor[] = [
  ...projectEnvDescriptors([], GlobalEnvDescriptors),
  ...projectEnvDescriptors(["telemetry"], GlobalTelemetryEnvDescriptors),
  ...projectEnvDescriptors(["sandbox"], GlobalSandboxEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "storage"], GlobalSandboxStorageEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "bootstrap"], GlobalSandboxBootstrapTokenEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "connect"], GlobalSandboxConnectTokenEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "egress"], GlobalSandboxEgressTokenEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "publish"], GlobalSandboxPublishEnvDescriptors),
  ...projectEnvDescriptors(
    ["sandbox", "publish", "access"],
    GlobalSandboxPublishAccessTokenEnvDescriptors,
  ),
  ...projectEnvDescriptors(
    ["sandbox", "publish", "session"],
    GlobalSandboxPublishSessionEnvDescriptors,
  ),
];

const ControlPlaneApiRuntimeEnvProjections: readonly RuntimeEnvProjectionDescriptor[] = [
  ...projectEnvDescriptors(["server"], ControlPlaneApiServerEnvDescriptors),
  ...projectEnvDescriptors(["database"], ControlPlaneApiDatabaseEnvDescriptors),
  ...projectEnvDescriptors(["objectStore"], ControlPlaneApiObjectStoreEnvDescriptors),
  ...projectEnvDescriptors(["auth"], ControlPlaneApiAuthEnvDescriptors),
  ...projectEnvDescriptors(["auth", "google"], ControlPlaneApiAuthGoogleEnvDescriptors),
  ...projectEnvDescriptors(["dashboard"], ControlPlaneApiDashboardEnvDescriptors),
  ...projectEnvDescriptors(["workflow"], ControlPlaneApiWorkflowEnvDescriptors),
  ...projectEnvDescriptors(["dataPlaneApi"], ControlPlaneApiDataPlaneApiEnvDescriptors),
  ...projectEnvDescriptors(["commitSign"], ControlPlaneApiCommitSignEnvDescriptors),
  ...projectEnvDescriptors(["integrations"], ControlPlaneApiIntegrationsEnvDescriptors),
];

const ControlPlaneWorkerRuntimeEnvProjections: readonly RuntimeEnvProjectionDescriptor[] = [
  ...projectEnvDescriptors(["workflow"], ControlPlaneWorkerWorkflowEnvDescriptors),
  ...projectEnvDescriptors(["email"], ControlPlaneWorkerEmailEnvDescriptors),
  ...projectEnvDescriptors(["dataPlaneApi"], ControlPlaneWorkerDataPlaneApiEnvDescriptors),
  ...projectEnvDescriptors(["controlPlaneApi"], ControlPlaneWorkerControlPlaneApiEnvDescriptors),
];

const DataPlaneApiRuntimeEnvProjections: readonly RuntimeEnvProjectionDescriptor[] = [
  ...projectEnvDescriptors(["server"], DataPlaneApiServerEnvDescriptors),
  ...projectEnvDescriptors(["database"], DataPlaneApiDatabaseEnvDescriptors),
  ...projectEnvDescriptors(["workflow"], DataPlaneApiWorkflowEnvDescriptors),
  ...projectEnvDescriptors(["runtimeState"], DataPlaneApiRuntimeStateEnvDescriptors),
  ...projectEnvDescriptors(["controlPlaneApi"], DataPlaneApiControlPlaneApiEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "docker"], DataPlaneApiSandboxDockerEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "e2b"], DataPlaneApiSandboxE2BEnvDescriptors),
];

const DataPlaneGatewayRuntimeEnvProjections: readonly RuntimeEnvProjectionDescriptor[] = [
  ...projectEnvDescriptors(["server"], DataPlaneGatewayServerEnvDescriptors),
  ...projectEnvDescriptors(["database"], DataPlaneGatewayDatabaseEnvDescriptors),
  ...projectEnvDescriptors(["runtimeState"], DataPlaneGatewayRuntimeStateEnvDescriptors),
  ...projectEnvDescriptors(
    ["runtimeState", "valkey"],
    DataPlaneGatewayRuntimeStateValkeyEnvDescriptors,
  ),
  ...projectEnvDescriptors(["dataPlaneApi"], DataPlaneGatewayDataPlaneApiEnvDescriptors),
  ...projectEnvDescriptors(["controlPlaneApi"], DataPlaneGatewayControlPlaneApiEnvDescriptors),
];

const DataPlaneWorkerRuntimeEnvProjections: readonly RuntimeEnvProjectionDescriptor[] = [
  ...projectEnvDescriptors(["database"], DataPlaneWorkerDatabaseEnvDescriptors),
  ...projectEnvDescriptors(["workflow"], DataPlaneWorkerWorkflowEnvDescriptors),
  ...projectEnvDescriptors(["runtimeState"], DataPlaneWorkerRuntimeStateEnvDescriptors),
  ...projectEnvDescriptors(["controlPlaneApi"], DataPlaneWorkerControlPlaneApiEnvDescriptors),
  ...projectEnvDescriptors(["sandbox"], DataPlaneWorkerSandboxEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "docker"], DataPlaneWorkerSandboxDockerEnvDescriptors),
  ...projectEnvDescriptors(["sandbox", "e2b"], DataPlaneWorkerSandboxE2BEnvDescriptors),
  ...projectEnvDescriptors(
    ["sandboxStorage", "archil"],
    DataPlaneWorkerSandboxStorageArchilEnvDescriptors,
  ),
  ...projectEnvDescriptors(
    ["sandboxStorage", "dockerVolume"],
    DataPlaneWorkerSandboxStorageDockerVolumeEnvDescriptors,
  ),
];

const TokenizerProxyRuntimeEnvProjections: readonly RuntimeEnvProjectionDescriptor[] = [
  ...projectEnvDescriptors(["server"], TokenizerProxyServerEnvDescriptors),
  ...projectEnvDescriptors(["controlPlaneApi"], TokenizerProxyControlPlaneApiEnvDescriptors),
];

function getAppRuntimeEnvProjections(
  app: AppConfigModuleKey,
): readonly RuntimeEnvProjectionDescriptor[] {
  if (app === AppIds.CONTROL_PLANE_API) {
    return ControlPlaneApiRuntimeEnvProjections;
  }

  if (app === AppIds.CONTROL_PLANE_WORKER) {
    return ControlPlaneWorkerRuntimeEnvProjections;
  }

  if (app === AppIds.DATA_PLANE_API) {
    return DataPlaneApiRuntimeEnvProjections;
  }

  if (app === AppIds.DATA_PLANE_GATEWAY) {
    return DataPlaneGatewayRuntimeEnvProjections;
  }

  if (app === AppIds.DATA_PLANE_WORKER) {
    return DataPlaneWorkerRuntimeEnvProjections;
  }

  if (app === AppIds.TOKENIZER_PROXY) {
    return TokenizerProxyRuntimeEnvProjections;
  }

  throw new Error("Unsupported app id.");
}

function projectDescriptor(
  root: unknown,
  descriptor: RuntimeEnvProjectionDescriptor,
): RuntimeEnvProjectionEntry | undefined {
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

export function projectServiceConfigToEnv<TApp extends AppConfigModuleKey>(
  input: RuntimeEnvProjectionInput<TApp>,
): RuntimeEnvProjectionEntry[] {
  if (input.config.global === undefined) {
    throw new Error(
      "Runtime env projection requires loadConfig output that includes global config.",
    );
  }

  const entries: RuntimeEnvProjectionEntry[] = [];

  for (const descriptor of GlobalRuntimeEnvProjections) {
    const entry = projectDescriptor(input.config.global, descriptor);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }

  for (const descriptor of getAppRuntimeEnvProjections(input.app)) {
    const entry = projectDescriptor(input.config.app, descriptor);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }

  return entries;
}
