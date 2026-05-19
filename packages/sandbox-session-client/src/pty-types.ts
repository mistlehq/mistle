export const SandboxPtyStates = {
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  OPENING: "opening",
  OPEN: "open",
  CLOSING: "closing",
  CLOSED: "closed",
  ERROR: "error",
  EXITED: "exited",
} as const;

export type SandboxPtyState = (typeof SandboxPtyStates)[keyof typeof SandboxPtyStates];

export type SandboxPtyOpenOptions = {
  ptySessionId: string;
  cols: number;
  rows: number;
  cwd?: string;
  command?: string;
  args?: string[];
};

export type SandboxPtyExitInfo = {
  exitCode: number;
};

export type SandboxPtyResetInfo = {
  code: string;
  message: string;
};
