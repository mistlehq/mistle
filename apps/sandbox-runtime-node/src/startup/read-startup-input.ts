import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "@mistle/integrations-core";

export const DefaultStartupInputMaxBytes = 1024 * 1024;

export type StartupInput = {
  bootstrapToken: string;
  tunnelExchangeToken: string;
  tunnelGatewayWsUrl: string;
  runtimePlan: CompiledRuntimePlan;
};

type ReadStartupInputInput = {
  reader: NodeJS.ReadableStream | null | undefined;
  maxBytes: number;
};

type StartupInputPayload = {
  bootstrapToken?: unknown;
  tunnelExchangeToken?: unknown;
  tunnelGatewayWsUrl?: unknown;
  runtimePlan?: unknown;
};

function requireStringField(
  payload: StartupInputPayload,
  fieldName: keyof StartupInputPayload,
): string {
  const rawValue = payload[fieldName];
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    throw new Error(`startup input ${fieldName} is required`);
  }

  return rawValue.trim();
}

async function readStreamToString(
  reader: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of reader) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw new Error(`startup input exceeds max size of ${maxBytes} bytes`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function readStartupInput(input: ReadStartupInputInput): Promise<StartupInput> {
  if (input.reader === undefined || input.reader === null) {
    throw new Error("startup input reader is required");
  }

  if (input.maxBytes < 1) {
    throw new Error("startup input max bytes must be at least 1");
  }

  const rawJson = await readStreamToString(input.reader, input.maxBytes);
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

  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("startup input from stdin must be valid json: expected object");
  }

  const payloadKeys = new Set(Object.keys(payload));
  const expectedKeys = [
    "bootstrapToken",
    "tunnelExchangeToken",
    "tunnelGatewayWsUrl",
    "runtimePlan",
  ];
  for (const expectedKey of expectedKeys) {
    payloadKeys.delete(expectedKey);
  }
  if (payloadKeys.size > 0) {
    const [unexpectedKey] = payloadKeys;
    throw new Error(
      `startup input from stdin must be valid json: unexpected field ${unexpectedKey}`,
    );
  }

  if (payload.runtimePlan === undefined) {
    throw new Error("startup input runtime plan is required");
  }

  const parsedRuntimePlan = CompiledRuntimePlanSchema.safeParse(payload.runtimePlan);
  if (!parsedRuntimePlan.success) {
    const firstIssue = parsedRuntimePlan.error.issues[0];
    throw new Error(
      `startup input runtime plan is invalid: ${firstIssue?.message ?? "invalid runtime plan"}`,
    );
  }

  return {
    bootstrapToken: requireStringField(payload, "bootstrapToken"),
    tunnelExchangeToken: requireStringField(payload, "tunnelExchangeToken"),
    tunnelGatewayWsUrl: requireStringField(payload, "tunnelGatewayWsUrl"),
    runtimePlan: parsedRuntimePlan.data,
  };
}
