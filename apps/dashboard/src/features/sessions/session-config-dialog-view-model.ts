import type { CodexSessionConnectionState } from "@mistle/codex-app-server-client";

import type { ConnectedCodexSession } from "../codex-client/codex-session-types.js";

type SessionConfigMetadataEntry = {
  label: string;
  value: string;
  monospace?: boolean;
};

export type SessionConfigDialogViewModel = {
  sessionMetadata: readonly SessionConfigMetadataEntry[];
};

function resolveUnavailableValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) {
    return "Unavailable";
  }

  return value;
}

export function createSessionConfigDialogViewModel(input: {
  sandboxInstanceId: string | null;
  agentConnectionState: CodexSessionConnectionState;
  connectedSession: ConnectedCodexSession | null;
}): SessionConfigDialogViewModel {
  const hasSelectedThread = input.connectedSession?.threadId !== null;

  return {
    sessionMetadata: [
      {
        label: "Sandbox instance",
        value: resolveUnavailableValue(input.sandboxInstanceId),
        monospace: true,
      },
      {
        label: "Transport state",
        value: input.agentConnectionState,
      },
      {
        label: "Thread state",
        value: hasSelectedThread ? "Selected" : "Unavailable",
      },
      {
        label: "Thread id",
        value: resolveUnavailableValue(input.connectedSession?.threadId),
        monospace: true,
      },
      {
        label: "Connected at",
        value: resolveUnavailableValue(input.connectedSession?.connectedAtIso),
        monospace: true,
      },
      {
        label: "Connection expires at",
        value: resolveUnavailableValue(input.connectedSession?.expiresAtIso),
        monospace: true,
      },
    ],
  };
}
