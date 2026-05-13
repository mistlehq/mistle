import type { AgentPtyLaunchArgument, AgentPtyLaunchSpec } from "@mistle/integrations-core";

import { OpenCodeServerListenUrl } from "./server.js";

export const OpenCodeCliPtySessionId = "cli";
export const OpenCodeCliDefaultCols = 120;
export const OpenCodeCliDefaultRows = 32;

const OpenCodeCliAttachArgs: readonly AgentPtyLaunchArgument[] = [
  {
    kind: "literal",
    value: "run",
  },
  {
    kind: "literal",
    value: "--interactive",
  },
  {
    kind: "literal",
    value: "--attach",
  },
  {
    kind: "literal",
    value: OpenCodeServerListenUrl,
  },
];

export const OpenCodePtyLaunchSpec: AgentPtyLaunchSpec = {
  runtimeId: "opencode",
  displayName: "OpenCode",
  newLaunch: {
    ptySessionId: OpenCodeCliPtySessionId,
    cols: OpenCodeCliDefaultCols,
    rows: OpenCodeCliDefaultRows,
    command: "opencode",
    args: OpenCodeCliAttachArgs,
  },
  resumeLaunch: {
    ptySessionId: OpenCodeCliPtySessionId,
    cols: OpenCodeCliDefaultCols,
    rows: OpenCodeCliDefaultRows,
    command: "opencode",
    args: [
      ...OpenCodeCliAttachArgs,
      {
        kind: "literal",
        value: "--session",
      },
      {
        kind: "threadId",
      },
    ],
  },
};
