import { type CompiledRuntimePlan } from "@mistle/integrations-core";

import { runRuntimeArtifactCommand } from "./artifact-command.js";
import { errorMessage } from "./error-message.js";
import { applyRuntimeFile } from "./runtime-file.js";
import { applyWorkspaceSource } from "./workspace-source.js";

type ApplyRuntimePlanInput = {
  runtimePlan: CompiledRuntimePlan;
};

export async function applyRuntimePlan(input: ApplyRuntimePlanInput): Promise<void> {
  for (const [artifactIndex, artifact] of input.runtimePlan.artifacts.entries()) {
    for (const [commandIndex, command] of artifact.lifecycle.install.entries()) {
      try {
        await runRuntimeArtifactCommand(command);
      } catch (error) {
        throw new Error(
          `runtime plan artifacts[${artifactIndex}] lifecycle.install[${commandIndex}] failed (artifactKey=${artifact.artifactKey}): ${errorMessage(error)}`,
        );
      }
    }
  }

  for (const [sourceIndex, workspaceSource] of input.runtimePlan.workspaceSources.entries()) {
    try {
      await applyWorkspaceSource({
        workspaceSource,
      });
    } catch (error) {
      throw new Error(
        `runtime plan workspaceSources[${sourceIndex}] failed (sourceKind=${workspaceSource.sourceKind} path=${workspaceSource.path}): ${errorMessage(error)}`,
      );
    }
  }

  for (const [clientIndex, runtimeClient] of input.runtimePlan.runtimeClients.entries()) {
    for (const [fileIndex, file] of runtimeClient.setup.files.entries()) {
      try {
        await applyRuntimeFile(file);
      } catch (error) {
        throw new Error(
          `runtime plan runtimeClients[${clientIndex}].setup.files[${fileIndex}] failed (clientId=${runtimeClient.clientId} fileId=${file.fileId} path=${file.path}): ${errorMessage(error)}`,
        );
      }
    }
  }
}
