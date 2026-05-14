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

export type SessionRuntimeCliPtyOpenInput = {
  sandboxInstanceId: string;
} & SandboxPtyOpenOptions;

export type SessionRuntimeCliLaunchInput = {
  launchTarget: SessionCliLaunchTarget;
  sandboxInstanceId: string;
  selectedRepositoryPath: string | null;
};

export type SessionRuntimeCliLaunchBuilder = (
  input: SessionRuntimeCliLaunchInput,
) => SessionRuntimeCliPtyOpenInput;
