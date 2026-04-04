import { writeFile } from "node:fs/promises";

import { SandboxKeepaliveStateSchema } from "../src/keepalive.js";
import { SandboxRuntimeStateSnapshotSchema } from "../src/runtime-state.js";
import {
  SandboxdStartupApplyRequestSchema,
  SandboxdStartupApplyResponseSchema,
  SandboxdStartupInputSchema,
} from "../src/startup.js";

const StartupJsonSchemaParams = {
  io: "input",
  unrepresentable: "any",
} as const;

const SchemaOutputs = [
  {
    outputPath: new URL("../schemas/sandboxd-startup-input.schema.json", import.meta.url),
    schema: SandboxdStartupInputSchema.toJSONSchema(StartupJsonSchemaParams),
  },
  {
    outputPath: new URL("../schemas/sandboxd-startup-apply-request.schema.json", import.meta.url),
    schema: SandboxdStartupApplyRequestSchema.toJSONSchema(StartupJsonSchemaParams),
  },
  {
    outputPath: new URL("../schemas/sandboxd-startup-apply-response.schema.json", import.meta.url),
    schema: SandboxdStartupApplyResponseSchema.toJSONSchema(StartupJsonSchemaParams),
  },
  {
    outputPath: new URL("../schemas/sandbox-keepalive-state.schema.json", import.meta.url),
    schema: SandboxKeepaliveStateSchema.toJSONSchema(),
  },
  {
    outputPath: new URL("../schemas/sandbox-runtime-state-snapshot.schema.json", import.meta.url),
    schema: SandboxRuntimeStateSnapshotSchema.toJSONSchema(),
  },
] as const;

function isPrimitiveJsonValue(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function formatJsonValue(value: unknown, indentLevel = 0): string {
  if (isPrimitiveJsonValue(value)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (value.every(isPrimitiveJsonValue)) {
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }

    const childIndent = "  ".repeat(indentLevel + 1);
    const currentIndent = "  ".repeat(indentLevel);
    const entries = value.map((item) => `${childIndent}${formatJsonValue(item, indentLevel + 1)}`);

    return `[\n${entries.join(",\n")}\n${currentIndent}]`;
  }

  const currentIndent = "  ".repeat(indentLevel);
  const childIndent = "  ".repeat(indentLevel + 1);
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, entryValue]) =>
      `${childIndent}${JSON.stringify(key)}: ${formatJsonValue(entryValue, indentLevel + 1)}`,
  );

  return `{\n${entries.join(",\n")}\n${currentIndent}}`;
}

await Promise.all(
  SchemaOutputs.map(({ outputPath, schema }) =>
    writeFile(outputPath, `${formatJsonValue(schema)}\n`),
  ),
);
