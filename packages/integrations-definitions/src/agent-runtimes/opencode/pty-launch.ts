import type { AgentPtyLaunchSpec } from "@mistle/integrations-core";

import { OpencodeServerBaseUrl } from "./server.js";

export const OpencodeCliPtySessionId = "cli";
export const OpencodeCliDefaultCols = 120;
export const OpencodeCliDefaultRows = 32;

export const OpencodePtyLaunchSpec: AgentPtyLaunchSpec = {
  runtimeId: "opencode",
  displayName: "OpenCode",
  logoKey: "opencode",
  newLaunch: {
    ptySessionId: OpencodeCliPtySessionId,
    cols: OpencodeCliDefaultCols,
    rows: OpencodeCliDefaultRows,
    command: "opencode",
    args: [
      {
        kind: "literal",
        value: "attach",
      },
      {
        kind: "literal",
        value: OpencodeServerBaseUrl,
      },
    ],
  },
  resumeLaunch: {
    ptySessionId: OpencodeCliPtySessionId,
    cols: OpencodeCliDefaultCols,
    rows: OpencodeCliDefaultRows,
    command: "opencode",
    args: [
      {
        kind: "literal",
        value: "attach",
      },
      {
        kind: "literal",
        value: OpencodeServerBaseUrl,
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
