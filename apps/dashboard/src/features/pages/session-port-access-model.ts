import type { ProcessEntry, ProcessListener } from "@mistle/sandbox-session-protocol";

export function resolvePrimaryProcessListener(process: ProcessEntry): ProcessListener | null {
  return process.listeners[0] ?? null;
}

export function createProcessKey(process: ProcessEntry): string {
  const primaryListener = resolvePrimaryProcessListener(process);
  return primaryListener === null
    ? `pid:${String(process.pid)}`
    : `pid:${String(process.pid)}:port:${String(primaryListener.port)}`;
}

export function createProcessLabel(process: ProcessEntry): string {
  const command = process.command?.trim();
  if (command !== undefined && command.length > 0) {
    return command;
  }

  return `PID ${String(process.pid)}`;
}
