import { randomUUID } from "node:crypto";

import { mintBootstrapToken, mintTunnelExchangeToken } from "@mistle/gateway-tunnel-auth";
import type { SandboxRuntimeControl } from "@mistle/sandbox";
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

export async function createSandboxStartupInput(input: {
  config: DataPlaneWorkerRuntimeConfig;
  organizationId: string;
  sandboxInstanceId: string;
  startupMode: SandboxStartupInput["startupMode"];
  executionMode?: SandboxStartupInput["executionMode"];
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
  gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
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

  return {
    startupMode: input.startupMode,
    ...(input.executionMode === undefined ? {} : { executionMode: input.executionMode }),
    bootstrapToken,
    tunnelExchangeToken,
    tunnelGatewayWsUrl,
    runtimePlan: input.runtimePlan,
    egressGrantByRuleId,
    ...(gitIdentity === undefined ? {} : { gitIdentity }),
  };
}

export async function initializeSandboxRuntime(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
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
  });

  await ctx.sandboxRuntimeControl.init({
    id: input.providerSandboxId,
    payload: encodeSandboxStartupInput(startupInput),
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  });
}
