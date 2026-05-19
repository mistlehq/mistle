import { resolveAgentPtyLaunchTemplate } from "@mistle/integrations-core";
import { PiPtyLaunchSpec } from "@mistle/integrations-definitions/agent-runtimes/pi/pty-launch";

import type {
  SessionRuntimeCliLaunchInput,
  SessionRuntimeCliPtyOpenInput,
} from "../../session-runtime-cli-launch.js";

export function buildPiCliPtyOpenInput(
  input: SessionRuntimeCliLaunchInput,
): SessionRuntimeCliPtyOpenInput {
  const launch = resolveAgentPtyLaunchTemplate({
    launch: PiPtyLaunchSpec,
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
