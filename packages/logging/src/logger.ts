import pino, { type Logger } from "pino";

export function createLogger(name: string): Logger {
  return pino({
    name,
  });
}
