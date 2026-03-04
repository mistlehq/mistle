import { createEnvLoader, hasEntries } from "../core/load-env.js";
import {
  PartialGlobalConfigSchema,
  PartialGlobalSandboxConfigSchema,
  GlobalSandboxTokenConfigSchema,
  type PartialGlobalConfigInput,
} from "./schema.js";

const loadGlobalEnv = createEnvLoader<typeof PartialGlobalConfigSchema>([
  {
    key: "env",
    envVar: "NODE_ENV",
    parse: (value) => (value === "production" ? "production" : "development"),
  },
  {
    key: "internalAuth",
    envVar: "MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
    parse: (value) => ({
      serviceToken: value,
    }),
  },
]);

const loadSandboxBootstrapTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>([
  {
    key: "tokenSecret",
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET",
  },
  {
    key: "tokenIssuer",
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER",
  },
  {
    key: "tokenAudience",
    envVar: "MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE",
  },
]);

const loadSandboxConnectTokenEnv = createEnvLoader<typeof GlobalSandboxTokenConfigSchema>([
  {
    key: "tokenSecret",
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET",
  },
  {
    key: "tokenIssuer",
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER",
  },
  {
    key: "tokenAudience",
    envVar: "MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE",
  },
]);

const loadSandboxEnv = createEnvLoader<typeof PartialGlobalSandboxConfigSchema>([
  {
    key: "defaultBaseImage",
    envVar: "MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE",
  },
  {
    key: "gatewayWsUrl",
    envVar: "MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL",
  },
]);

export function loadGlobalFromEnv(env: NodeJS.ProcessEnv): PartialGlobalConfigInput {
  const partialGlobal = loadGlobalEnv(env);
  const partialSandbox = loadSandboxEnv(env);
  const partialSandboxBootstrapToken = loadSandboxBootstrapTokenEnv(env);
  const partialSandboxConnectToken = loadSandboxConnectTokenEnv(env);

  if (
    hasEntries(partialSandbox) ||
    hasEntries(partialSandboxBootstrapToken) ||
    hasEntries(partialSandboxConnectToken)
  ) {
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
    };
  }

  return PartialGlobalConfigSchema.parse(partialGlobal);
}
