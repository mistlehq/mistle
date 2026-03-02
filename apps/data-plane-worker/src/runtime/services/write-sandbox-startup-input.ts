import { randomUUID } from "node:crypto";

import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import type { SandboxAdapter, SandboxHandle } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflows/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../../types.js";
import { encodeSandboxStartupInput } from "../sandbox-startup-input.js";

export async function writeSandboxStartupInput(input: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxAdapter: SandboxAdapter;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  sandbox: SandboxHandle;
}): Promise<string> {
  const bootstrapTokenJti = randomUUID();
  const bootstrapToken = await mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: input.config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: input.config.sandbox.bootstrap.tokenAudience,
    },
    jti: bootstrapTokenJti,
    ttlSeconds: input.config.app.tunnel.bootstrapTokenTtlSeconds,
  });

  try {
    await input.sandbox.writeStdin({
      payload: encodeSandboxStartupInput({
        bootstrapToken,
        tunnelGatewayWsUrl: input.config.app.tunnel.gatewayWsUrl,
        runtimePlan: input.runtimePlan,
      }),
    });
    await input.sandbox.closeStdin();

    return bootstrapTokenJti;
  } catch (writeError) {
    try {
      await input.sandboxAdapter.stop({
        sandboxId: input.sandbox.sandboxId,
      });
    } catch (stopError) {
      throw new Error(
        "Failed to write sandbox startup input and failed to stop sandbox after startup write failure.",
        {
          cause: {
            writeError,
            stopError,
          },
        },
      );
    }

    throw new Error("Failed to write sandbox startup input to sandbox stdin.", {
      cause: writeError,
    });
  }
}
