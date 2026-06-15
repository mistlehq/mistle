import type { AgentPtyLaunchSpec } from "@mistle/integrations-core";

import { ClaudeCodeRuntimeId } from "./server.js";

export const ClaudeCodePtyLaunchSpec: AgentPtyLaunchSpec = {
  runtimeId: ClaudeCodeRuntimeId,
  displayName: "Claude Code",
  newLaunch: {
    ptySessionId: "claude-code",
    cols: 120,
    rows: 30,
    command: "claude",
    args: [],
  },
  resumeLaunch: {
    ptySessionId: "claude-code",
    cols: 120,
    rows: 30,
    command: "claude",
    args: [{ kind: "literal", value: "--resume" }, { kind: "threadId" }],
  },
};
