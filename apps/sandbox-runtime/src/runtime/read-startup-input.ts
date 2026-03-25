import { type Readable } from "node:stream";

import { readJsonObjectFromStream } from "../io/read-json-object-from-stream.js";
import { parseStartupInputPayload, type StartupInput } from "./startup-input.js";

export const DefaultStartupInputMaxBytes = 1024 * 1024;

type ReadStartupInputInput = {
  reader: Readable | null | undefined;
  maxBytes: number;
};

export async function readStartupInput(input: ReadStartupInputInput): Promise<StartupInput> {
  if (input.reader === undefined || input.reader === null) {
    throw new Error("startup input reader is required");
  }

  if (input.maxBytes < 1) {
    throw new Error("startup input max bytes must be at least 1");
  }

  const rawJson = await readJsonObjectFromStream({
    reader: input.reader,
    maxBytes: input.maxBytes,
    label: "startup input",
  });
  return parseStartupInputJson(rawJson);
}

function parseStartupInputJson(rawJson: string): StartupInput {
  if (rawJson.trim().length === 0) {
    throw new Error("startup input from stdin is empty");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      `startup input from stdin must be valid json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return parseStartupInputPayload(payload);
}
