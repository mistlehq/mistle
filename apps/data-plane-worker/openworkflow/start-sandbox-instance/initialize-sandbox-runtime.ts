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
  encodeSandboxStartupInput,
  type SandboxActivationInput,
  type SandboxStartupInput,
} from "./sandbox-startup-input.js";
import { createSigningGrant } from "./signing-grant.js";
import { createSandboxRuntimeEnv } from "./start-sandbox.js";

type SandboxRuntimeSessionInputFields = Omit<SandboxActivationInput, "operationKind"> & {
  operationKind: SandboxStartupInput["operationKind"];
};

type CreateSandboxRuntimeSessionInputFieldsRequest = {
  config: DataPlaneWorkerRuntimeConfig;
  organizationId: string;
  operationId: string;
  operationKind: SandboxStartupInput["operationKind"];
  sandboxInstanceId: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
  gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
  sandboxAdapter?: SandboxAdapter;
  processEnv?: Readonly<Record<string, string | undefined>>;
};

export async function createSandboxStartupInput(
  input: CreateSandboxRuntimeSessionInputFieldsRequest & {
    startupMode: SandboxStartupInput["startupMode"];
    executionMode?: SandboxStartupInput["executionMode"];
  },
): Promise<SandboxStartupInput> {
  const sessionInputFields = await createSandboxRuntimeSessionInputFields(input);

  return {
    startupMode: input.startupMode,
    ...(input.executionMode === undefined ? {} : { executionMode: input.executionMode }),
    ...sessionInputFields,
  };
}

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

export async function initializeSandboxRuntime(
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
    operationKind: SandboxStartupInput["operationKind"];
    sandboxInstanceId: string;
    providerSandboxId: string;
    startupMode: SandboxStartupInput["startupMode"];
    executionMode?: SandboxStartupInput["executionMode"];
    waitForCompletion?: boolean;
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
      "Ensured sandboxd artifact before runtime initialization.",
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
    "Read sandboxd version before runtime initialization.",
  );

  const startupInput = await createSandboxStartupInput({
    config: ctx.config,
    organizationId: input.organizationId,
    operationId: input.operationId,
    operationKind: input.operationKind,
    sandboxInstanceId: input.sandboxInstanceId,
    startupMode: input.startupMode,
    ...(input.executionMode === undefined ? {} : { executionMode: input.executionMode }),
    runtimePlan: input.runtimePlan,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
    sandboxAdapter: ctx.sandboxAdapter,
    processEnv: ctx.processEnv,
  });

  const initRequest = {
    id: input.providerSandboxId,
    payload: encodeSandboxStartupInput(startupInput),
    env: runtimeEnv,
  };
  try {
    await ctx.sandboxRuntimeControl.beginInit(initRequest);
  } catch (error) {
    if (!isSandboxdAlreadySubmittedError(error)) {
      throw error;
    }

    ctx.logger.info(
      {
        providerSandboxId: input.providerSandboxId,
        sandboxInstanceId: input.sandboxInstanceId,
      },
      "Sandboxd initialization was already submitted before retry.",
    );
  }

  if (input.waitForCompletion !== false) {
    await ctx.sandboxRuntimeControl.waitInit({
      id: input.providerSandboxId,
      env: runtimeEnv,
    });
  }
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

function isSandboxdAlreadySubmittedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("sandboxd has already completed initialization") ||
      error.message.includes("sandboxd is already initializing") ||
      error.message.includes("sandboxd init worker is already running"))
  );
}

function createTransparentProxyStartupConfiguration(input: {
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
