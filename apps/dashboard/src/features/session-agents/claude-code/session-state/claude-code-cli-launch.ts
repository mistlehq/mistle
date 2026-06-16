import { resolveAgentPtyLaunchTemplate } from "@mistle/integrations-core";
import { ClaudeCodePtyLaunchSpec } from "@mistle/integrations-definitions/agent-runtimes/claude-code/pty-launch";

import type {
  SessionRuntimeCliLaunchInput,
  SessionRuntimeCliPtyOpenInput,
} from "../../session-runtime-cli-launch.js";

export function buildClaudeCodeCliPtyOpenInput(
  input: SessionRuntimeCliLaunchInput,
): SessionRuntimeCliPtyOpenInput {
  const launch = resolveAgentPtyLaunchTemplate({
    launch: ClaudeCodePtyLaunchSpec,
    threadId: input.launchTarget.type === "resume" ? input.launchTarget.threadId : null,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    ptySessionId: "cli",
    cols: launch.cols,
    rows: launch.rows,
    command: launch.command,
    args: launch.args,
    ...(input.selectedRepositoryPath === null ? {} : { cwd: input.selectedRepositoryPath }),
  };
}
