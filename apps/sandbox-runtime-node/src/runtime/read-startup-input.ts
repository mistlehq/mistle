import { type Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "@mistle/integrations-core";

export const DefaultStartupInputMaxBytes = 1024 * 1024;

export type StartupInput = {
  bootstrapToken: string;
  tunnelExchangeToken: string;
  tunnelGatewayWsUrl: string;
  runtimePlan: CompiledRuntimePlan;
};

type ReadStartupInputInput = {
  reader: Readable | null | undefined;
  maxBytes: number;
};

function normalizeRequiredString(value: string, fieldLabel: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`startup input ${fieldLabel} is required`);
  }

  return trimmedValue;
}

function readRequiredStringField(payload: object, fieldName: string): string {
  const fieldValue = Object.getOwnPropertyDescriptor(payload, fieldName)?.value;
  if (typeof fieldValue !== "string") {
    throw new Error(`startup input ${fieldName} is required`);
  }

  return fieldValue;
}

function readRequiredRuntimePlanField(payload: object): CompiledRuntimePlan {
  const runtimePlan = Object.getOwnPropertyDescriptor(payload, "runtimePlan")?.value;
  if (runtimePlan === undefined) {
    throw new Error("startup input runtime plan is required");
  }

  const parsedRuntimePlan = CompiledRuntimePlanSchema.safeParse(runtimePlan);
  if (!parsedRuntimePlan.success) {
    const firstIssue = parsedRuntimePlan.error.issues[0];
    throw new Error(
      `startup input runtime plan is invalid: ${firstIssue?.message ?? "invalid runtime plan"}`,
    );
  }

  return parsedRuntimePlan.data;
}

function validateExpectedFields(payload: object): void {
  const allowedFields = new Set([
    "bootstrapToken",
    "tunnelExchangeToken",
    "tunnelGatewayWsUrl",
    "runtimePlan",
  ]);

  for (const fieldName of Object.keys(payload)) {
    if (!allowedFields.has(fieldName)) {
      throw new Error(`startup input from stdin must be valid json: unexpected field ${fieldName}`);
    }
  }
}

type JsonScanState = {
  started: boolean;
  depth: number;
  inString: boolean;
  escaped: boolean;
};

function updateJsonScanState(state: JsonScanState, value: string): number | undefined {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined) {
      continue;
    }

    if (!state.started) {
      if (/\s/u.test(character)) {
        continue;
      }

      if (character !== "{") {
        return undefined;
      }

      state.started = true;
      state.depth = 1;
      continue;
    }

    if (state.inString) {
      if (state.escaped) {
        state.escaped = false;
        continue;
      }

      if (character === "\\") {
        state.escaped = true;
        continue;
      }

      if (character === '"') {
        state.inString = false;
      }

      continue;
    }

    if (character === '"') {
      state.inString = true;
      continue;
    }

    if (character === "{") {
      state.depth += 1;
      continue;
    }

    if (character === "}") {
      state.depth -= 1;
      if (state.depth === 0) {
        return index + 1;
      }
    }
  }

  return undefined;
}

async function readSingleJsonObjectFromStream(reader: Readable, maxBytes: number): Promise<string> {
  const decoder = new StringDecoder("utf8");
  let rawJson = "";
  let totalBytes = 0;
  const scanState: JsonScanState = {
    started: false,
    depth: 0,
    inString: false,
    escaped: false,
  };

  for await (const chunk of reader.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw new Error(`startup input exceeds max size of ${maxBytes} bytes`);
    }

    const decodedChunk = decoder.write(buffer);
    rawJson += decodedChunk;
    const completeObjectEndInChunk = updateJsonScanState(scanState, decodedChunk);
    if (completeObjectEndInChunk === undefined) {
      continue;
    }

    const completeObjectEnd = rawJson.length - decodedChunk.length + completeObjectEndInChunk;
    const completeJson = rawJson.slice(0, completeObjectEnd);
    const trailingContent = rawJson.slice(completeObjectEnd);
    if (trailingContent.trim().length > 0) {
      throw new Error(
        "startup input from stdin must be valid json: unexpected trailing JSON content",
      );
    }

    return completeJson;
  }

  rawJson += decoder.end();
  if (rawJson.trim().length === 0) {
    throw new Error("startup input from stdin is empty");
  }

  return rawJson;
}

export async function readStartupInput(input: ReadStartupInputInput): Promise<StartupInput> {
  if (input.reader === undefined || input.reader === null) {
    throw new Error("startup input reader is required");
  }

  if (input.maxBytes < 1) {
    throw new Error("startup input max bytes must be at least 1");
  }

  const rawJson = await readSingleJsonObjectFromStream(input.reader, input.maxBytes);
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

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("startup input from stdin must be valid json: expected object");
  }

  validateExpectedFields(payload);

  return {
    bootstrapToken: normalizeRequiredString(
      readRequiredStringField(payload, "bootstrapToken"),
      "bootstrap token",
    ),
    tunnelExchangeToken: normalizeRequiredString(
      readRequiredStringField(payload, "tunnelExchangeToken"),
      "tunnel exchange token",
    ),
    tunnelGatewayWsUrl: normalizeRequiredString(
      readRequiredStringField(payload, "tunnelGatewayWsUrl"),
      "tunnel gateway ws url",
    ),
    runtimePlan: readRequiredRuntimePlanField(payload),
  };
}
