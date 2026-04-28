import { createEnvLoader, hasEntries } from "../core/load-env.js";
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
} from "./legacy-env-descriptors.js";
import {
  PartialGlobalTelemetryConfigSchema,
  PartialGlobalConfigSchema,
  PartialGlobalSandboxConfigSchema,
  PartialGlobalSandboxPublishConfigSchema,
  PartialGlobalSandboxStorageConfigSchema,
  GlobalSandboxTokenConfigSchema,
  GlobalSandboxPublishSessionConfigSchema,
  type PartialGlobalConfigInput,
} from "./schema.js";

export {
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
} from "./legacy-env-descriptors.js";

const loadGlobalEnv = createEnvLoader<typeof PartialGlobalConfigSchema>(GlobalEnvDescriptors);
const loadTelemetryEnv = createEnvLoader<typeof PartialGlobalTelemetryConfigSchema>(
  GlobalTelemetryEnvDescriptors,
);
const loadSandboxBootstrapTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>(
  GlobalSandboxBootstrapTokenEnvDescriptors,
);
const loadSandboxConnectTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>(
  GlobalSandboxConnectTokenEnvDescriptors,
);
const loadSandboxEgressTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>(
  GlobalSandboxEgressTokenEnvDescriptors,
);
const loadSandboxPublishAccessTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>(
  GlobalSandboxPublishAccessTokenEnvDescriptors,
);
const loadSandboxPublishSessionEnv = createEnvLoader<
  typeof GlobalSandboxPublishSessionConfigSchema
>(GlobalSandboxPublishSessionEnvDescriptors);
const loadSandboxPublishEnv = createEnvLoader<typeof PartialGlobalSandboxPublishConfigSchema>(
  GlobalSandboxPublishEnvDescriptors,
);
const loadSandboxEnv = createEnvLoader<typeof PartialGlobalSandboxConfigSchema>(
  GlobalSandboxEnvDescriptors,
);
const loadSandboxStorageEnv = createEnvLoader<typeof PartialGlobalSandboxStorageConfigSchema>(
  GlobalSandboxStorageEnvDescriptors,
);

export function loadGlobalFromEnv(env: NodeJS.ProcessEnv): PartialGlobalConfigInput {
  const partialGlobal = loadGlobalEnv(env);
  const partialTelemetry = loadTelemetryEnv(env);
  const partialSandbox = loadSandboxEnv(env);
  const partialSandboxStorage = loadSandboxStorageEnv(env);
  const partialSandboxBootstrapToken = loadSandboxBootstrapTokenEnv(env);
  const partialSandboxConnectToken = loadSandboxConnectTokenEnv(env);
  const partialSandboxEgressToken = loadSandboxEgressTokenEnv(env);
  const partialSandboxPublish = loadSandboxPublishEnv(env);
  const partialSandboxPublishAccessToken = loadSandboxPublishAccessTokenEnv(env);
  const partialSandboxPublishSession = loadSandboxPublishSessionEnv(env);

  if (hasEntries(partialTelemetry)) {
    partialGlobal.telemetry = partialTelemetry;
  }

  if (
    hasEntries(partialSandbox) ||
    hasEntries(partialSandboxBootstrapToken) ||
    hasEntries(partialSandboxConnectToken) ||
    hasEntries(partialSandboxEgressToken) ||
    hasEntries(partialSandboxStorage) ||
    hasEntries(partialSandboxPublish) ||
    hasEntries(partialSandboxPublishAccessToken) ||
    hasEntries(partialSandboxPublishSession)
  ) {
    const partialExistingSandboxPublish = partialSandbox.publish ?? {};

    partialGlobal.sandbox = {
      ...partialSandbox,
      ...(hasEntries(partialSandboxBootstrapToken)
        ? {
            bootstrap: partialSandboxBootstrapToken,
          }
        : {}),
      ...(hasEntries(partialSandboxConnectToken)
        ? {
            connect: partialSandboxConnectToken,
          }
        : {}),
      ...(hasEntries(partialSandboxEgressToken)
        ? {
            egress: partialSandboxEgressToken,
          }
        : {}),
      ...(hasEntries(partialSandboxStorage)
        ? {
            storage: partialSandboxStorage,
          }
        : {}),
      ...(hasEntries(partialSandboxPublish) ||
      hasEntries(partialSandboxPublishAccessToken) ||
      hasEntries(partialSandboxPublishSession)
        ? {
            publish: {
              ...partialExistingSandboxPublish,
              ...partialSandboxPublish,
              ...(hasEntries(partialSandboxPublishAccessToken)
                ? {
                    access: partialSandboxPublishAccessToken,
                  }
                : {}),
              ...(hasEntries(partialSandboxPublishSession)
                ? {
                    session: partialSandboxPublishSession,
                  }
                : {}),
            },
          }
        : {}),
    };
  }

  return PartialGlobalConfigSchema.parse(partialGlobal);
}
