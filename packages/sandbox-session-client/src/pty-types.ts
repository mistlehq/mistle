import type { SandboxSessionRuntime } from "./runtime.js";

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
  cols: number;
  rows: number;
  cwd?: string;
};

export type SandboxPtyExitInfo = {
  exitCode: number;
};

export type SandboxPtyResetInfo = {
  code: string;
  message: string;
};

export type SandboxPtyClientInput = {
  connectionUrl: string;
  runtime: SandboxSessionRuntime;
  connectTimeoutMs?: number;
  closeTimeoutMs?: number;
};
