import { createRequire } from "node:module";

import type pinoFactory from "pino";
import type { Logger } from "pino";

export type MistleLogger = Logger;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPinoFactory(value: unknown): value is typeof pinoFactory {
  return typeof value === "function";
}

function loadPinoFactory(): typeof pinoFactory {
  const require = createRequire(import.meta.url);
  const loadedModule: unknown = require("pino");

  if (isPinoFactory(loadedModule)) {
    return loadedModule;
  }

  if (isRecord(loadedModule) && isPinoFactory(loadedModule.default)) {
    return loadedModule.default;
  }

  throw new Error("Failed to load pino module.");
}

const pino = loadPinoFactory();

export function createLogger(name: string): MistleLogger {
  return pino({
    name,
  });
}
