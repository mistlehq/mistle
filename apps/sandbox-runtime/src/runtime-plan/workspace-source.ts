import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

import type { CompiledWorkspaceSource, RuntimeArtifactCommand } from "@mistle/integrations-core";

import { runRuntimeArtifactCommand } from "./artifact-command.js";
import { errorMessage } from "./error-message.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runGitCommand(args: ReadonlyArray<string>): Promise<void> {
  const command: RuntimeArtifactCommand = {
    args: ["git", ...args],
    env: {
      GIT_TERMINAL_PROMPT: "0",
    },
  };

  await runRuntimeArtifactCommand(command);
}

async function applyGitCloneWorkspaceSource(
  workspaceSource: CompiledWorkspaceSource,
): Promise<void> {
  if (await pathExists(workspaceSource.path)) {
    throw new Error(`workspace source path '${workspaceSource.path}' already exists`);
  }

  const parentDirectory = dirname(workspaceSource.path);
  try {
    await mkdir(parentDirectory, {
      recursive: true,
      mode: 0o755,
    });
  } catch (error) {
    throw new Error(`failed to create parent directory ${parentDirectory}: ${errorMessage(error)}`);
  }

  try {
    await runGitCommand([
      "clone",
      "--origin",
      "origin",
      workspaceSource.originUrl,
      workspaceSource.path,
    ]);
  } catch (error) {
    throw new Error(`failed to clone repository: ${errorMessage(error)}`);
  }
}

function unsupportedWorkspaceSource(sourceKind: string): never {
  throw new Error(`workspace source kind '${sourceKind}' is not supported`);
}

export async function applyWorkspaceSource(
  workspaceSource: CompiledWorkspaceSource,
): Promise<void> {
  switch (workspaceSource.sourceKind) {
    case "git-clone":
      await applyGitCloneWorkspaceSource(workspaceSource);
      return;
    default:
      unsupportedWorkspaceSource(workspaceSource.sourceKind);
  }
}
