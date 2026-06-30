import type { CompiledRuntimePlan } from "@mistle/integrations-core";

import type { DesignerEvalContainerRuntimeClient } from "../docker/designer-eval-container.ts";

export function resolveDesignerEvalCodexRuntimeClient(
  runtimePlan: CompiledRuntimePlan,
): DesignerEvalContainerRuntimeClient {
  const codexClient = runtimePlan.runtimeClients.find(
    (runtimeClient) => runtimeClient.clientId === "codex-cli",
  );
  if (codexClient === undefined) {
    throw new Error("Designer runtime plan did not include the codex-cli runtime client.");
  }
  const codexProcess = codexClient.processes.find(
    (process) => process.processKey === "codex-app-server",
  );
  if (codexProcess === undefined) {
    throw new Error("Designer runtime plan did not include the codex-app-server process.");
  }
  if (runtimePlan.image.source !== "base") {
    throw new Error("Designer eval Docker runtime requires a base image runtime plan.");
  }

  return {
    imageRef: runtimePlan.image.imageRef,
    command: codexProcess.command.args,
  };
}
