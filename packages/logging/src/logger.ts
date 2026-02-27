import pino, { type Logger } from "pino";

export type MistleLogger = Logger;

export function createLogger(name: string): MistleLogger {
  return pino({
    name,
  });
}
