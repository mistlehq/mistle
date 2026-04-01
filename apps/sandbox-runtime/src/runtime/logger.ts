export type SandboxRuntimeLogLevel = "info" | "warn" | "error";

export type SandboxRuntimeLogValue = string | number | boolean | null;

export type SandboxRuntimeLogFields = Readonly<Record<string, SandboxRuntimeLogValue>>;

export type SandboxRuntimeLogLineListener = (line: string) => void;

const logLineListeners = new Set<SandboxRuntimeLogLineListener>();

export function formatSandboxRuntimeLogLine(input: {
  timestamp: Date;
  level: SandboxRuntimeLogLevel;
  event: string;
  fields?: SandboxRuntimeLogFields;
}): string {
  const payload: Record<string, SandboxRuntimeLogValue> = {
    timestamp: input.timestamp.toISOString(),
    level: input.level,
    event: input.event,
  };

  if (input.fields !== undefined) {
    for (const [key, value] of Object.entries(input.fields)) {
      payload[key] = value;
    }
  }

  return `${JSON.stringify(payload)}\n`;
}

export function addSandboxRuntimeLogLineListener(
  listener: SandboxRuntimeLogLineListener,
): () => void {
  logLineListeners.add(listener);

  return () => {
    logLineListeners.delete(listener);
  };
}

export function logSandboxRuntimeEvent(input: {
  level: SandboxRuntimeLogLevel;
  event: string;
  fields?: SandboxRuntimeLogFields;
}): void {
  const line = formatSandboxRuntimeLogLine({
    timestamp: new Date(),
    level: input.level,
    event: input.event,
    ...(input.fields === undefined ? {} : { fields: input.fields }),
  });

  process.stderr.write(line);
  for (const listener of logLineListeners) {
    listener(line);
  }
}
