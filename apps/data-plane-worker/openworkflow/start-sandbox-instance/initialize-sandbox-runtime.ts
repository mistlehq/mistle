import { randomUUID } from "node:crypto";

import { mintBootstrapToken, mintTunnelExchangeToken } from "@mistle/gateway-tunnel-auth";
import {
  createRuntimeDestinationTransparentProxyExclusions,
  type SandboxAdapter,
  type SandboxRuntimeControl,
} from "@mistle/sandbox";
import {
  SandboxdTransparentProxyBypassKinds,
  type SandboxdTransparentProxyConfiguration,
} from "@mistle/sandbox-runtime-contract";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { DataPlaneWorkerTunnelTokenDurations } from "../core/tunnel-token-durations.js";
import { createEgressGrantByRuleId } from "./egress-grants.js";
import {
  createSandboxTunnelGatewayWsUrl,
  encodeSandboxStartupInput,
  type SandboxStartupInput,
} from "./sandbox-startup-input.js";
import { createSigningGrant } from "./signing-grant.js";
import { createSandboxRuntimeEnv } from "./start-sandbox.js";

const GatewayProxyEnabledEnv = "GATEWAY_PROXY_ENABLED";

export async function createSandboxStartupInput(input: {
  config: DataPlaneWorkerRuntimeConfig;
  organizationId: string;
  sandboxInstanceId: string;
  startupMode: SandboxStartupInput["startupMode"];
  executionMode?: SandboxStartupInput["executionMode"];
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
  gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
  sandboxAdapter?: SandboxAdapter;
  processEnv?: Readonly<Record<string, string | undefined>>;
}): Promise<SandboxStartupInput> {
  const bootstrapTokenJti = randomUUID();
  const tunnelExchangeTokenJti = randomUUID();
  const tunnelGatewayWsUrl = createSandboxTunnelGatewayWsUrl({
    gatewayWebsocketUrl: input.config.sandbox.internalGatewayWsUrl,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const [bootstrapToken, tunnelExchangeToken, egressGrantByRuleId, signingGrant] =
    await Promise.all([
      mintBootstrapToken({
        config: {
          bootstrapTokenSecret: input.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: input.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: input.config.sandbox.bootstrap.tokenAudience,
        },
        jti: bootstrapTokenJti,
        sandboxInstanceId: input.sandboxInstanceId,
        ttlSeconds: DataPlaneWorkerTunnelTokenDurations.BOOTSTRAP_TOKEN_TTL_SECONDS,
      }),
      mintTunnelExchangeToken({
        config: {
          tokenSecret: input.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: input.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: input.config.sandbox.bootstrap.tokenAudience,
        },
        jti: tunnelExchangeTokenJti,
        sandboxInstanceId: input.sandboxInstanceId,
        bootstrapTokenTtlSeconds: DataPlaneWorkerTunnelTokenDurations.BOOTSTRAP_TOKEN_TTL_SECONDS,
        exchangeTokenTtlSeconds: DataPlaneWorkerTunnelTokenDurations.EXCHANGE_TOKEN_TTL_SECONDS,
        ttlSeconds: DataPlaneWorkerTunnelTokenDurations.EXCHANGE_TOKEN_TTL_SECONDS,
      }),
      createEgressGrantByRuleId({
        config: input.config,
        organizationId: input.organizationId,
        sandboxInstanceId: input.sandboxInstanceId,
        runtimePlan: input.runtimePlan,
        ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
      }),
      createSigningGrant({
        config: input.config,
        sandboxInstanceId: input.sandboxInstanceId,
        ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
      }),
    ]);

  let gitIdentity: SandboxStartupInput["gitIdentity"];
  if (input.gitIdentity === undefined) {
    gitIdentity = undefined;
  } else if (input.gitIdentity.signing === undefined) {
    gitIdentity = {
      name: input.gitIdentity.name,
      email: input.gitIdentity.email,
    };
  } else {
    if (signingGrant === undefined) {
      throw new Error("Expected signing grant to be minted when git signing config is present.");
    }

    gitIdentity = {
      name: input.gitIdentity.name,
      email: input.gitIdentity.email,
      signing: {
        ...input.gitIdentity.signing,
        grant: signingGrant,
      },
    };
  }

  const transparentProxy =
    input.sandboxAdapter === undefined
      ? undefined
      : createTransparentProxyStartupConfiguration({
          config: input.config,
          processEnv: input.processEnv ?? process.env,
          sandboxAdapter: input.sandboxAdapter,
          tunnelGatewayWsUrl,
        });
  const gatewayProxyStartupActingUserId =
    transparentProxy === undefined ? undefined : input.actingUserId;

  return {
    startupMode: input.startupMode,
    ...(input.executionMode === undefined ? {} : { executionMode: input.executionMode }),
    bootstrapToken,
    tunnelExchangeToken,
    tunnelGatewayWsUrl,
    runtimePlan: input.runtimePlan,
    ...(gatewayProxyStartupActingUserId === undefined
      ? {}
      : { actingUserId: gatewayProxyStartupActingUserId }),
    egressGrantByRuleId,
    ...(gitIdentity === undefined ? {} : { gitIdentity }),
    ...(transparentProxy === undefined ? {} : { transparentProxy }),
  };
}

export async function initializeSandboxRuntime(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    processEnv: Readonly<Record<string, string | undefined>>;
    sandboxAdapter: SandboxAdapter;
    sandboxRuntimeControl: SandboxRuntimeControl;
  },
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    providerSandboxId: string;
    startupMode: SandboxStartupInput["startupMode"];
    executionMode?: SandboxStartupInput["executionMode"];
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
    actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
    gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
  },
): Promise<void> {
  const startupInput = await createSandboxStartupInput({
    config: ctx.config,
    organizationId: input.organizationId,
    sandboxInstanceId: input.sandboxInstanceId,
    startupMode: input.startupMode,
    ...(input.executionMode === undefined ? {} : { executionMode: input.executionMode }),
    runtimePlan: input.runtimePlan,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
    sandboxAdapter: ctx.sandboxAdapter,
    processEnv: ctx.processEnv,
  });

  await ctx.sandboxRuntimeControl.init({
    id: input.providerSandboxId,
    payload: encodeSandboxStartupInput(startupInput),
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      processEnv: ctx.processEnv,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  });
}

function createTransparentProxyStartupConfiguration(input: {
  config: DataPlaneWorkerRuntimeConfig;
  processEnv: Readonly<Record<string, string | undefined>>;
  sandboxAdapter: SandboxAdapter;
  tunnelGatewayWsUrl: string;
}): SandboxdTransparentProxyConfiguration | undefined {
  if (!readGatewayProxyEnabled(input.processEnv)) {
    return undefined;
  }

  const providerConfiguration = input.sandboxAdapter.getTransparentProxyConfiguration();
  if (!providerConfiguration.supported) {
    throw new Error(
      `Sandbox provider '${providerConfiguration.provider}' does not support transparent proxying.`,
    );
  }

  return {
    passthroughBypass: {
      kind: SandboxdTransparentProxyBypassKinds.SOCKET_MARK,
      mark: providerConfiguration.passthroughBypass.mark,
    },
    exclusions: [
      ...providerConfiguration.exclusions,
      ...createRuntimeDestinationTransparentProxyExclusions({
        dnsServerIps: [],
        gatewayTunnelUrl: input.tunnelGatewayWsUrl,
        tokenizerProxyEgressUrl: input.config.app.sandbox.tokenizerProxyEgressBaseUrl,
      }),
    ],
  };
}

function readGatewayProxyEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env[GatewayProxyEnabledEnv];
  if (value === undefined || value === "") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw new Error(`${GatewayProxyEnabledEnv} must be '1' when set.`);
}
