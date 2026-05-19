import type { AgentPtyLaunchSpec } from "@mistle/integrations-core";

export const PiCliPtySessionId = "cli";
export const PiCliDefaultCols = 120;
export const PiCliDefaultRows = 32;

export const PiPtyLaunchSpec: AgentPtyLaunchSpec = {
  runtimeId: "pi",
  displayName: "Pi",
  newLaunch: {
    ptySessionId: PiCliPtySessionId,
    cols: PiCliDefaultCols,
    rows: PiCliDefaultRows,
    command: "pi",
    args: [],
  },
  resumeLaunch: {
    ptySessionId: PiCliPtySessionId,
    cols: PiCliDefaultCols,
    rows: PiCliDefaultRows,
    command: "pi",
    args: [
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
