import { type CompiledRuntimePlan } from "@mistle/integrations-core";

import { type Logger } from "../runtime/logger.js";
import { runRuntimeArtifactCommand } from "./artifact-command.js";
import { errorMessage } from "./error-message.js";
import { applyRuntimeFile, RuntimeFileApplyOutcomes } from "./runtime-file.js";
import { applyWorkspaceSource } from "./workspace-source.js";

type ApplyRuntimePlanInput = {
  runtimePlan: CompiledRuntimePlan;
  logger?: Logger;
};

export async function applyRuntimePlan(input: ApplyRuntimePlanInput): Promise<void> {
  for (const [artifactIndex, artifact] of input.runtimePlan.artifacts.entries()) {
    for (const [commandIndex, command] of artifact.lifecycle.install.entries()) {
      const startedAtMs = Date.now();
      input.logger?.logEvent({
        level: "info",
        event: "sandbox_runtime_plan_artifact_command_started",
        fields: {
          artifactIndex,
          commandIndex,
          artifactKey: artifact.artifactKey,
          executable: command.args[0] ?? "",
          timeoutMs: command.timeoutMs ?? null,
        },
      });
      try {
        await runRuntimeArtifactCommand(command);
        input.logger?.logEvent({
          level: "info",
          event: "sandbox_runtime_plan_artifact_command_completed",
          fields: {
            artifactIndex,
            commandIndex,
            artifactKey: artifact.artifactKey,
            executable: command.args[0] ?? "",
            elapsedMs: Date.now() - startedAtMs,
          },
        });
      } catch (error) {
        input.logger?.logEvent({
          level: "error",
          event: "sandbox_runtime_plan_artifact_command_failed",
          fields: {
            artifactIndex,
            commandIndex,
            artifactKey: artifact.artifactKey,
            executable: command.args[0] ?? "",
            elapsedMs: Date.now() - startedAtMs,
            message: errorMessage(error),
          },
        });
        throw new Error(
          `runtime plan artifacts[${artifactIndex}] lifecycle.install[${commandIndex}] failed (artifactKey=${artifact.artifactKey}): ${errorMessage(error)}`,
        );
      }
    }
  }

  for (const [sourceIndex, workspaceSource] of input.runtimePlan.workspaceSources.entries()) {
    const startedAtMs = Date.now();
    input.logger?.logEvent({
      level: "info",
      event: "sandbox_runtime_plan_workspace_source_started",
      fields: {
        sourceIndex,
        sourceKind: workspaceSource.sourceKind,
        path: workspaceSource.path,
      },
    });
    try {
      await applyWorkspaceSource({
        workspaceSource,
      });
      input.logger?.logEvent({
        level: "info",
        event: "sandbox_runtime_plan_workspace_source_completed",
        fields: {
          sourceIndex,
          sourceKind: workspaceSource.sourceKind,
          path: workspaceSource.path,
          elapsedMs: Date.now() - startedAtMs,
        },
      });
    } catch (error) {
      input.logger?.logEvent({
        level: "error",
        event: "sandbox_runtime_plan_workspace_source_failed",
        fields: {
          sourceIndex,
          sourceKind: workspaceSource.sourceKind,
          path: workspaceSource.path,
          elapsedMs: Date.now() - startedAtMs,
          message: errorMessage(error),
        },
      });
      throw new Error(
        `runtime plan workspaceSources[${sourceIndex}] failed (sourceKind=${workspaceSource.sourceKind} path=${workspaceSource.path}): ${errorMessage(error)}`,
      );
    }
  }

  for (const [clientIndex, runtimeClient] of input.runtimePlan.runtimeClients.entries()) {
    for (const [fileIndex, file] of runtimeClient.setup.files.entries()) {
      const startedAtMs = Date.now();
      input.logger?.logEvent({
        level: "info",
        event: "sandbox_runtime_plan_runtime_file_started",
        fields: {
          clientIndex,
          clientId: runtimeClient.clientId,
          fileIndex,
          fileId: file.fileId,
          path: file.path,
          writeMode: file.writeMode ?? null,
        },
      });
      try {
        const outcome = await applyRuntimeFile(file);
        input.logger?.logEvent({
          level: "info",
          event:
            outcome === RuntimeFileApplyOutcomes.SKIPPED_IF_ABSENT
              ? "sandbox_runtime_plan_runtime_file_skipped"
              : "sandbox_runtime_plan_runtime_file_completed",
          fields: {
            clientIndex,
            clientId: runtimeClient.clientId,
            fileIndex,
            fileId: file.fileId,
            path: file.path,
            writeMode: file.writeMode ?? null,
            elapsedMs: Date.now() - startedAtMs,
          },
        });
      } catch (error) {
        input.logger?.logEvent({
          level: "error",
          event: "sandbox_runtime_plan_runtime_file_failed",
          fields: {
            clientIndex,
            clientId: runtimeClient.clientId,
            fileIndex,
            fileId: file.fileId,
            path: file.path,
            writeMode: file.writeMode ?? null,
            elapsedMs: Date.now() - startedAtMs,
            message: errorMessage(error),
          },
        });
        throw new Error(
          `runtime plan runtimeClients[${clientIndex}].setup.files[${fileIndex}] failed (clientId=${runtimeClient.clientId} fileId=${file.fileId} path=${file.path}): ${errorMessage(error)}`,
        );
      }
    }
  }
}
