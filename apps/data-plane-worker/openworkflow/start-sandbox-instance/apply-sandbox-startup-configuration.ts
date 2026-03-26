import { randomUUID } from "node:crypto";

import { mintBootstrapToken, mintTunnelExchangeToken } from "@mistle/gateway-tunnel-auth";
import type { SandboxRuntimeControl } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { createEgressGrantByRuleId } from "./egress-grants.js";
import {
  createSandboxTunnelGatewayWsUrl,
  encodeSandboxStartupInput,
  type SandboxStartupInput,
} from "./sandbox-startup-input.js";

async function createSandboxStartupInput(input: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxInstanceId: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
}): Promise<SandboxStartupInput> {
  const bootstrapTokenJti = randomUUID();
  const tunnelExchangeTokenJti = randomUUID();
  const tunnelGatewayWsUrl = createSandboxTunnelGatewayWsUrl({
    gatewayWebsocketUrl: input.config.sandbox.internalGatewayWsUrl,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const [bootstrapToken, tunnelExchangeToken, egressGrantByRuleId] = await Promise.all([
    mintBootstrapToken({
      config: {
        bootstrapTokenSecret: input.config.sandbox.bootstrap.tokenSecret,
        tokenIssuer: input.config.sandbox.bootstrap.tokenIssuer,
        tokenAudience: input.config.sandbox.bootstrap.tokenAudience,
      },
      jti: bootstrapTokenJti,
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: input.config.app.tunnel.bootstrapTokenTtlSeconds,
    }),
    mintTunnelExchangeToken({
      config: {
        tokenSecret: input.config.sandbox.bootstrap.tokenSecret,
        tokenIssuer: input.config.sandbox.bootstrap.tokenIssuer,
        tokenAudience: input.config.sandbox.bootstrap.tokenAudience,
      },
      jti: tunnelExchangeTokenJti,
      sandboxInstanceId: input.sandboxInstanceId,
      bootstrapTokenTtlSeconds: input.config.app.tunnel.bootstrapTokenTtlSeconds,
      exchangeTokenTtlSeconds: input.config.app.tunnel.exchangeTokenTtlSeconds,
      ttlSeconds: input.config.app.tunnel.exchangeTokenTtlSeconds,
    }),
    createEgressGrantByRuleId({
      config: input.config,
      sandboxInstanceId: input.sandboxInstanceId,
      runtimePlan: input.runtimePlan,
    }),
  ]);

  return {
    bootstrapToken,
    tunnelExchangeToken,
    tunnelGatewayWsUrl,
    runtimePlan: input.runtimePlan,
    egressGrantByRuleId,
  };
}

export async function applySandboxStartupConfiguration(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxRuntimeControl: SandboxRuntimeControl;
  },
  input: {
    sandboxInstanceId: string;
    providerSandboxId: string;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  },
): Promise<void> {
  const startupInput = await createSandboxStartupInput({
    config: ctx.config,
    sandboxInstanceId: input.sandboxInstanceId,
    runtimePlan: input.runtimePlan,
  });

  await ctx.sandboxRuntimeControl.applyStartup({
    id: input.providerSandboxId,
    payload: encodeSandboxStartupInput(startupInput),
  });
}
