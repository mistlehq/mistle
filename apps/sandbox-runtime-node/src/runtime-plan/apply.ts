import type { CompiledRuntimePlan, ResolvedSandboxImage } from "@mistle/integrations-core";

import { runRuntimeArtifactCommand } from "./artifact-command.js";
import { errorMessage } from "./error-message.js";
import { applyRuntimeFile } from "./runtime-file.js";
import { applyWorkspaceSource } from "./workspace-source.js";

type ApplyRuntimePlanInput = {
  runtimePlan: CompiledRuntimePlan;
};

type ArtifactLifecycleCommandSet = "install" | "update";

function unsupportedImageSource(source: string): never {
  throw new Error(`runtime plan image source '${source}' is not supported`);
}

function resolveArtifactLifecycleCommandSet(
  source: ResolvedSandboxImage["source"],
): ArtifactLifecycleCommandSet {
  switch (source) {
    case "base":
    case "profile-base":
      return "install";
  }

  const unsupportedSource: never = source;
  return unsupportedImageSource(unsupportedSource);
}

export async function applyRuntimePlan(input: ApplyRuntimePlanInput): Promise<void> {
  const commandSet = resolveArtifactLifecycleCommandSet(input.runtimePlan.image.source);

  for (const [artifactIndex, artifact] of input.runtimePlan.artifacts.entries()) {
    const commands =
      commandSet === "update" ? (artifact.lifecycle.update ?? []) : artifact.lifecycle.install;

    for (const [commandIndex, command] of commands.entries()) {
      try {
        await runRuntimeArtifactCommand(command);
      } catch (error) {
        throw new Error(
          `runtime plan artifacts[${artifactIndex}] lifecycle.${commandSet}[${commandIndex}] failed (artifactKey=${artifact.artifactKey}): ${errorMessage(error)}`,
        );
      }
    }
  }

  for (const [sourceIndex, workspaceSource] of input.runtimePlan.workspaceSources.entries()) {
    try {
      await applyWorkspaceSource(workspaceSource);
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
