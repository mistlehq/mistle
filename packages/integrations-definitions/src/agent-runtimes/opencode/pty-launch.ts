import type { AgentPtyLaunchSpec } from "@mistle/integrations-core";

import { OpenCodeServerListenUrl } from "./server.js";

export const OpenCodeCliPtySessionId = "cli";
export const OpenCodeCliDefaultCols = 120;
export const OpenCodeCliDefaultRows = 32;

export const OpenCodePtyLaunchSpec: AgentPtyLaunchSpec = {
  runtimeId: "opencode",
  displayName: "OpenCode",
  newLaunch: {
    ptySessionId: OpenCodeCliPtySessionId,
    cols: OpenCodeCliDefaultCols,
    rows: OpenCodeCliDefaultRows,
    command: "opencode",
    args: [
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
    ],
  },
  resumeLaunch: {
    ptySessionId: OpenCodeCliPtySessionId,
    cols: OpenCodeCliDefaultCols,
    rows: OpenCodeCliDefaultRows,
    command: "opencode",
    args: [
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
