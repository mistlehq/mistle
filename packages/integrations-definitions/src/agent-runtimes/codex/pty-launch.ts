import type { AgentPtyLaunchSpec } from "@mistle/integrations-core";

import { OpenAiCodexAppServerListenUrl } from "./app-server.js";

export const CodexCliPtySessionId = "cli";
export const CodexCliDefaultCols = 120;
export const CodexCliDefaultRows = 32;

export const CodexPtyLaunchSpec: AgentPtyLaunchSpec = {
  runtimeId: "codex",
  displayName: "Codex",
  newLaunch: {
    ptySessionId: CodexCliPtySessionId,
    cols: CodexCliDefaultCols,
    rows: CodexCliDefaultRows,
    command: "codex",
    args: [
      {
        kind: "literal",
        value: "--remote",
      },
      {
        kind: "literal",
        value: OpenAiCodexAppServerListenUrl,
      },
    ],
  },
  resumeLaunch: {
    ptySessionId: CodexCliPtySessionId,
    cols: CodexCliDefaultCols,
    rows: CodexCliDefaultRows,
    command: "codex",
    args: [
      {
        kind: "literal",
        value: "resume",
      },
      {
        kind: "literal",
        value: "--remote",
      },
      {
        kind: "literal",
        value: OpenAiCodexAppServerListenUrl,
      },
      {
        kind: "threadId",
      },
    ],
  },
};
