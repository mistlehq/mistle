import { writeFile } from "node:fs/promises";

import { SandboxKeepaliveStateSchema } from "../src/keepalive.js";
import { SandboxRuntimeStateSnapshotSchema } from "../src/runtime-state.js";
import { SandboxdActivationInputSchema, SandboxdActivationResponseSchema } from "../src/startup.js";

const StartupJsonSchemaParams = {
  io: "input",
} as const;

const SchemaOutputs = [
  {
    outputPath: new URL("../schemas/sandboxd-activation-input.schema.json", import.meta.url),
    schema: SandboxdActivationInputSchema.toJSONSchema(StartupJsonSchemaParams),
  },
  {
    outputPath: new URL("../schemas/sandboxd-activation-response.schema.json", import.meta.url),
    schema: SandboxdActivationResponseSchema.toJSONSchema(StartupJsonSchemaParams),
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

await Promise.all(
  SchemaOutputs.map(({ outputPath, schema }) =>
    writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`),
  ),
);
