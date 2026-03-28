import type { DockerSandboxInspectResult } from "./providers/docker/types.js";
import type { E2BSandboxInspectResult } from "./providers/e2b/types.js";
import { SandboxProvider, type SandboxInspectResult } from "./types.js";

export type SandboxInspectProviderState = "active" | "resumable_stopped" | "terminal_stopped";

function isDockerSandboxInspectResult(
  input: SandboxInspectResult,
): input is DockerSandboxInspectResult {
  return input.provider === SandboxProvider.DOCKER;
}

function isE2BSandboxInspectResult(input: SandboxInspectResult): input is E2BSandboxInspectResult {
  return input.provider === SandboxProvider.E2B;
}

function classifyDockerState(state: string): SandboxInspectProviderState {
  switch (state) {
    case "running":
    case "restarting":
      return "active";
    case "paused":
    case "exited":
      return "resumable_stopped";
    case "dead":
    case "removing":
      return "terminal_stopped";
    case "created":
      throw new Error("Sandbox inspect provider state does not support Docker created containers.");
    default:
      throw new Error(`Sandbox inspect provider state does not support Docker state '${state}'.`);
  }
}

function classifyE2BState(state: string): SandboxInspectProviderState {
  switch (state) {
    case "running":
      return "active";
    case "paused":
      return "resumable_stopped";
    default:
      throw new Error(`Sandbox inspect provider state does not support E2B state '${state}'.`);
  }
}

export function classifySandboxInspectProviderState(
  input: SandboxInspectResult,
): SandboxInspectProviderState {
  if (isDockerSandboxInspectResult(input)) {
    return classifyDockerState(input.raw.State.Status);
  }

  if (isE2BSandboxInspectResult(input)) {
    return classifyE2BState(input.raw.state);
  }

  throw new Error(`Sandbox inspect provider state does not support provider '${input.provider}'.`);
}
