import { resolveAgentPtyLaunchTemplate } from "@mistle/integrations-core";
import { CodexAppServerListenUrl } from "@mistle/integrations-definitions/agent-runtimes/codex/app-server";
import { OpenCodePtyLaunchSpec } from "@mistle/integrations-definitions/agent-runtimes/opencode/pty-launch";
import type { SandboxPtyOpenOptions } from "@mistle/sandbox-session-client";

export type SessionCliLaunchTarget =
  | {
      type: "resume";
      threadId: string;
    }
  | {
      type: "start_new";
      shouldClearActiveThreadId: boolean;
    };

export type SessionRuntimeCliLaunchRuntimeId = "codex" | "opencode";

type SessionRuntimeCliPtyOpenInput = {
  sandboxInstanceId: string;
} & SandboxPtyOpenOptions;

export function buildCliPtyOpenInput(input: {
  launchTarget: SessionCliLaunchTarget;
  runtimeId: SessionRuntimeCliLaunchRuntimeId;
  sandboxInstanceId: string;
  selectedRepositoryPath: string | null;
}): SessionRuntimeCliPtyOpenInput {
  if (input.runtimeId === "opencode") {
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
