import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  TokenizerProxyControlPlaneApiEnvDescriptors,
  TokenizerProxyServerEnvDescriptors,
} from "./legacy-env-descriptors.js";
import {
  type PartialTokenizerProxyConfigInput,
  PartialTokenizerProxyConfigSchema,
  TokenizerProxyControlPlaneApiConfigSchema,
  TokenizerProxyServerConfigSchema,
} from "./schema.js";

export {
  TokenizerProxyControlPlaneApiEnvDescriptors,
  TokenizerProxyServerEnvDescriptors,
} from "./legacy-env-descriptors.js";

const loadServerEnv = createEnvLoader<typeof TokenizerProxyServerConfigSchema>(
  TokenizerProxyServerEnvDescriptors,
);
const loadControlPlaneApiEnv = createEnvLoader<typeof TokenizerProxyControlPlaneApiConfigSchema>(
  TokenizerProxyControlPlaneApiEnvDescriptors,
);

export function loadTokenizerProxyFromEnv(
  env: NodeJS.ProcessEnv,
): PartialTokenizerProxyConfigInput {
  const partialConfig: PartialTokenizerProxyConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

  const controlPlaneApi = loadControlPlaneApiEnv(env);
  if (hasEntries(controlPlaneApi)) {
    partialConfig.controlPlaneApi = controlPlaneApi;
  }

  return PartialTokenizerProxyConfigSchema.parse(partialConfig);
}
