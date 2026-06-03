import { randomUUID } from "node:crypto";

import { mintBootstrapToken, mintTunnelExchangeToken } from "@mistle/gateway-tunnel-auth";
import type { MistleLogger } from "@mistle/logging";
import { type SandboxAdapter, type SandboxRuntimeControl } from "@mistle/sandbox";
import {
  SandboxdTransparentProxyBypassKinds,
  type SandboxdTransparentProxyConfiguration,
} from "@mistle/sandbox-runtime-contract";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import type { SandboxdArtifactResolver } from "../core/sandboxd-artifact-resolver.js";
import { DataPlaneWorkerTunnelTokenDurations } from "../core/tunnel-token-durations.js";
import {
  createSandboxTunnelGatewayWsUrl,
  encodeSandboxActivationInput,
  type SandboxActivationInput,
} from "./sandbox-startup-input.js";
import { createSigningGrant } from "./signing-grant.js";
import { createSandboxRuntimeEnv } from "./start-sandbox.js";

type SandboxRuntimeSessionInputFields = Omit<SandboxActivationInput, "operationKind"> & {
  operationKind: SandboxActivationInput["operationKind"];
};

type CreateSandboxRuntimeSessionInputFieldsRequest = {
  config: DataPlaneWorkerRuntimeConfig;
  organizationId: string;
  operationId: string;
  operationKind: SandboxActivationInput["operationKind"];
  sandboxInstanceId: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
  gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
  sandboxAdapter?: SandboxAdapter;
  processEnv?: Readonly<Record<string, string | undefined>>;
};

export async function createSandboxActivationInput(
  input: Omit<CreateSandboxRuntimeSessionInputFieldsRequest, "operationKind"> & {
    operationKind: SandboxActivationInput["operationKind"];
  },
): Promise<SandboxActivationInput> {
  const sessionInputFields = await createSandboxRuntimeSessionInputFields(input);

  return {
    ...sessionInputFields,
    operationKind: input.operationKind,
  };
}

async function createSandboxRuntimeSessionInputFields(
  input: CreateSandboxRuntimeSessionInputFieldsRequest,
): Promise<SandboxRuntimeSessionInputFields> {
  const bootstrapTokenJti = randomUUID();
  const tunnelExchangeTokenJti = randomUUID();
  const tunnelGatewayWsUrl = createSandboxTunnelGatewayWsUrl({
    gatewayWebsocketUrl: input.config.sandbox.internalGatewayWsUrl,
    operationId: input.operationId,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const [bootstrapToken, tunnelExchangeToken, signingGrant] = await Promise.all([
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
    createSigningGrant({
      config: input.config,
      sandboxInstanceId: input.sandboxInstanceId,
      ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
    }),
  ]);

  let gitIdentity: SandboxActivationInput["gitIdentity"];
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
      : createTransparentProxyActivationConfiguration({
          sandboxAdapter: input.sandboxAdapter,
        });
  const startupActingUserId = transparentProxy === undefined ? undefined : input.actingUserId;

  return {
    operationKind: input.operationKind,
    bootstrapToken,
    tunnelExchangeToken,
    tunnelGatewayWsUrl,
    runtimePlan: input.runtimePlan,
    ...(startupActingUserId === undefined ? {} : { actingUserId: startupActingUserId }),
    ...(gitIdentity === undefined ? {} : { gitIdentity }),
    ...(transparentProxy === undefined ? {} : { transparentProxy }),
  };
}

export async function activateSandboxRuntime(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    logger: MistleLogger;
    processEnv: Readonly<Record<string, string | undefined>>;
    sandboxAdapter: SandboxAdapter;
    sandboxdArtifactResolver: SandboxdArtifactResolver | undefined;
    sandboxRuntimeControl: SandboxRuntimeControl;
  },
  input: {
    organizationId: string;
    operationId: string;
    operationKind: SandboxActivationInput["operationKind"];
    sandboxInstanceId: string;
    providerSandboxId: string;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
    actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
    gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
  },
): Promise<void> {
  const runtimeEnv = createSandboxRuntimeEnv({
    config: ctx.config,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const sandboxdArtifact = await ctx.sandboxdArtifactResolver?.resolve();
  if (sandboxdArtifact !== undefined) {
    await ctx.sandboxRuntimeControl.ensureSandboxd({
      id: input.providerSandboxId,
      artifact: sandboxdArtifact,
      env: runtimeEnv,
    });
    ctx.logger.info(
      {
        providerSandboxId: input.providerSandboxId,
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxdVersion: sandboxdArtifact.version,
      },
      "Ensured sandboxd artifact before runtime activation.",
    );
  }

  const sandboxdVersion = await ctx.sandboxRuntimeControl.readSandboxdVersion({
    id: input.providerSandboxId,
    env: runtimeEnv,
  });
  ctx.logger.info(
    {
      providerSandboxId: input.providerSandboxId,
      sandboxInstanceId: input.sandboxInstanceId,
      sandboxdVersion,
    },
    "Read sandboxd version before runtime activation.",
  );

  const activationInput = await createSandboxActivationInput({
    config: ctx.config,
    organizationId: input.organizationId,
    operationId: input.operationId,
    operationKind: input.operationKind,
    sandboxInstanceId: input.sandboxInstanceId,
    runtimePlan: input.runtimePlan,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
    sandboxAdapter: ctx.sandboxAdapter,
    processEnv: ctx.processEnv,
  });

  await ctx.sandboxRuntimeControl.activate({
    id: input.providerSandboxId,
    payload: encodeSandboxActivationInput(activationInput),
    env: runtimeEnv,
  });
}

function createTransparentProxyActivationConfiguration(input: {
  sandboxAdapter: SandboxAdapter;
}): SandboxdTransparentProxyConfiguration | undefined {
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
    exclusions: [...providerConfiguration.exclusions],
  };
}
