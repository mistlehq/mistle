import type { SandboxAdapter, SandboxProvider, SandboxRuntimeControl } from "@mistle/sandbox";

import { logger } from "../../logger.js";

export async function stopSandbox(
  ctx: {
    sandboxAdapter: SandboxAdapter;
    sandboxRuntimeControl: SandboxRuntimeControl;
  },
  input: {
    runtimeProvider: SandboxProvider;
    providerSandboxId: string;
    sandboxInstanceId: string;
  },
): Promise<void> {
  await emitBootstrapTunnelOperationLog({
    sandboxRuntimeControl: ctx.sandboxRuntimeControl,
    runtimeProvider: input.runtimeProvider,
    providerSandboxId: input.providerSandboxId,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  await ctx.sandboxRuntimeControl.shutdown({
    id: input.providerSandboxId,
  });
  await ctx.sandboxAdapter.stop({
    id: input.providerSandboxId,
  });
}

export async function emitBootstrapTunnelOperationLog(input: {
  sandboxRuntimeControl: SandboxRuntimeControl;
  runtimeProvider: SandboxProvider;
  providerSandboxId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  const attributes = {
    eventName: "worker.sandbox.bootstrap_tunnel.operation_log",
    runtimeProvider: input.runtimeProvider,
    providerSandboxId: input.providerSandboxId,
    sandboxInstanceId: input.sandboxInstanceId,
  };

  try {
    const operationLogText = await input.sandboxRuntimeControl.readOperationLog({
      id: input.providerSandboxId,
      operation: "bootstrap_tunnel",
    });

    if (operationLogText === null || operationLogText.length === 0) {
      logger.info(
        {
          ...attributes,
          operationLogAvailable: false,
        },
        "Sandbox bootstrap tunnel diagnostic log was unavailable before provider stop.",
      );
      return;
    }

    logger.info(
      {
        ...attributes,
        operationLogAvailable: true,
        operationLogText,
      },
      "Read sandbox bootstrap tunnel diagnostic log before provider stop.",
    );
  } catch (error) {
    logger.warn(
      {
        ...attributes,
        err: error,
      },
      "Failed to read sandbox bootstrap tunnel diagnostic log before provider stop.",
    );
  }
}
