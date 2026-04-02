export type LogLevel = "info" | "warn" | "error";

export type LogValue = string | number | boolean | null;

export type LogFields = Readonly<Record<string, LogValue>>;

export type LogLineListener = (line: string) => void;
export type LogEventInput = {
  level: LogLevel;
  event: string;
  fields?: LogFields;
};
export type Logger = {
  addLogLineListener: (listener: LogLineListener) => () => void;
  logEvent: (input: LogEventInput) => void;
};

const MaxBufferedLogLines = 512;

export function formatLogLine(input: {
  timestamp: Date;
  level: LogLevel;
  event: string;
  fields?: LogFields;
}): string {
  const payload: Record<string, LogValue> = {
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

export class BufferedLogger implements Logger {
  readonly #bufferedLogLines: string[] = [];
  readonly #logLineListeners = new Set<LogLineListener>();

  public addLogLineListener(listener: LogLineListener): () => void {
    for (const line of this.#bufferedLogLines) {
      listener(line);
    }

    this.#logLineListeners.add(listener);

    return () => {
      this.#logLineListeners.delete(listener);
    };
  }

  public logEvent(input: LogEventInput): void {
    const line = formatLogLine({
      timestamp: new Date(),
      level: input.level,
      event: input.event,
      ...(input.fields === undefined ? {} : { fields: input.fields }),
    });

    process.stderr.write(line);
    this.#bufferedLogLines.push(line);
    if (this.#bufferedLogLines.length > MaxBufferedLogLines) {
      this.#bufferedLogLines.splice(0, this.#bufferedLogLines.length - MaxBufferedLogLines);
    }
    for (const listener of this.#logLineListeners) {
      listener(line);
    }
  }
}
