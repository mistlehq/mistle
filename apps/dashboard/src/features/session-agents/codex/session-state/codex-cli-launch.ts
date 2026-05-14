import { CodexAppServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/codex/app-server";

import type {
  SessionRuntimeCliLaunchInput,
  SessionRuntimeCliPtyOpenInput,
} from "../../session-runtime-cli-launch.js";

export function buildCodexCliPtyOpenInput(
  input: SessionRuntimeCliLaunchInput,
): SessionRuntimeCliPtyOpenInput {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    ptySessionId: "cli",
    cols: 120,
    rows: 32,
    command: "codex",
    args:
      input.launchTarget.type === "resume"
        ? ["resume", "--remote", CodexAppServerListenUrl, input.launchTarget.threadId]
        : ["--remote", CodexAppServerListenUrl],
    ...(input.selectedRepositoryPath === null ? {} : { cwd: input.selectedRepositoryPath }),
  };
}
