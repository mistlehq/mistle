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
