import { resolveAgentPtyLaunchTemplate } from "@mistle/integrations-core";
import { OpenCodePtyLaunchSpec } from "@mistle/integrations-definitions/agent-runtimes/opencode/pty-launch";

import type {
  SessionRuntimeCliLaunchInput,
  SessionRuntimeCliPtyOpenInput,
} from "../../session-runtime-cli-launch.js";

export function buildOpenCodeCliPtyOpenInput(
  input: SessionRuntimeCliLaunchInput,
): SessionRuntimeCliPtyOpenInput {
  const launch = resolveAgentPtyLaunchTemplate({
    launch: OpenCodePtyLaunchSpec,
    threadId: input.launchTarget.type === "resume" ? input.launchTarget.threadId : null,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    ptySessionId: "cli",
    cols: launch.cols,
    rows: launch.rows,
    command: "opencode",
    args:
      input.selectedRepositoryPath === null
        ? launch.args
        : [...launch.args, "--dir", input.selectedRepositoryPath],
    ...(input.selectedRepositoryPath === null ? {} : { cwd: input.selectedRepositoryPath }),
  };
}
